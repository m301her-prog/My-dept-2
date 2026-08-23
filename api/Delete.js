import pg from 'pg';

const baseConnectionString = process.env.DATABASE_URL;
let pool;

if (baseConnectionString) {
    const separator = baseConnectionString.includes('?') ? '&' : '?';
    const finalConnectionString = `${baseConnectionString}${separator}sslmode=verify-full`;

    pool = new pg.Pool({
        connectionString: finalConnectionString,
        ssl: { rejectUnauthorized: false },
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000
    });
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-tenant-schema, x-user-id'
    );

    if (req.method === 'OPTIONS') return res.status(200).end();

    if (!pool) {
        return res.status(500).json({ success: false, error: 'DATABASE_URL غير معرف في متغيرات البيئة' });
    }

    const client = await pool.connect();

    try {
        let body = req.body || {};
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (e) {}
        }

        const d = body.debtData || body.debt || body.updates || body.data || body;
        
        // تحديد نوع العملية سواء أُرسلت في req.method أو داخل body.action
        let action = (body.action || d.action || req.method).toString().toUpperCase().trim();
        if (req.method === 'DELETE') action = 'DELETE';

        // 1. استخراج المعرفات المباشرة بدون توليد تلقائي
        const targetId = body.id || body.debtId || d.id || d._id || null;
        const personName = body.personName || body.person_name || d.personName || d.person_name || null;

        // 2. تحديد وتوحيد السكيمّا المستهدفة
        let userId = body.userId || body.user_id || d.userId || d.user_id || req.headers['x-user-id'] || null;
        const finalCompanyName = body.companyName || body.company_name || body.company || d.companyName || d.company_name || d.company;

        let targetSchema = req.headers['x-tenant-schema'];

        if (!targetSchema || targetSchema.trim() === '') {
            if (finalCompanyName && finalCompanyName.toString().trim() !== '') {
                const sanitizedCompany = finalCompanyName.toString().trim().replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
                targetSchema = sanitizedCompany ? `schema_${sanitizedCompany}` : null;
            }
            if (!targetSchema && userId) {
                const cleanUser = userId.toString().trim().replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
                targetSchema = `schema_user_${cleanUser.replace('usr_', '')}`;
            }
            if (!targetSchema) targetSchema = 'public';
        }

        const cleanSchema = targetSchema.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();

        // 3. ضبط المسار للسكيمّا المعنية
        await client.query(`CREATE SCHEMA IF NOT EXISTS "${cleanSchema}";`);
        await client.query(`SET search_path TO "${cleanSchema}";`);

        // ==========================================
        // تنفيذ عملية الحذف الجذرية (DELETE)
        // ==========================================
        if (['DELETE', 'DELETE_DEBT', 'REMOVE'].includes(action)) {
            
            if (!targetId && !personName) {
                return res.status(400).json({
                    success: false,
                    error: 'يجب إرسال (id) أو (person_name) على الأقل لإجراء الحذف'
                });
            }

            // محاولة الحذف المباشر بـ ID أولاً ثم الاسم داخل السكيمّا المحددة
            let deleteQuery = `DELETE FROM debts WHERE id = $1 RETURNING *;`;
            let result = await client.query(deleteQuery, [targetId]);

            // في حال عدم وجود الـ ID أو فشل المطابقة به، يتم الحذف باسم الشخص
            if (result.rowCount === 0 && personName) {
                deleteQuery = `DELETE FROM debts WHERE LOWER(TRIM(person_name)) = LOWER(TRIM($1)) RETURNING *;`;
                result = await client.query(deleteQuery, [personName]);
            }

            // خيار الأمان التجريفي: البحث والحذف في باقي السكيمات لضمان التطهير في حال التخزين الخاطئ سابقاً
            if (result.rowCount === 0) {
                const schemasResult = await client.query(`
                    SELECT schema_name FROM information_schema.schemata 
                    WHERE schema_name LIKE 'schema_%' OR schema_name = 'public'
                `);

                for (const sysSchema of schemasResult.rows.map(r => r.schema_name)) {
                    await client.query(`SET search_path TO "${sysSchema}";`);
                    
                    if (targetId) {
                        result = await client.query(`DELETE FROM debts WHERE id = $1 RETURNING *;`, [targetId]);
                    }
                    if (result.rowCount === 0 && personName) {
                        result = await client.query(`DELETE FROM debts WHERE LOWER(TRIM(person_name)) = LOWER(TRIM($1)) RETURNING *;`, [personName]);
                    }

                    if (result.rowCount > 0) {
                        return res.status(200).json({
                            success: true,
                            message: 'تم الحذف بنجاح عبر الفحص الشامل',
                            schemaUsed: sysSchema,
                            deletedDebt: result.rows[0]
                        });
                    }
                }
            }

            if (result.rowCount === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'لم يتم العثور على أي سجل مطابق لهذه البيانات لحذفه'
                });
            }

            return res.status(200).json({
                success: true,
                message: 'تم الحذف بنجاح',
                schemaUsed: cleanSchema,
                deletedDebt: result.rows[0]
            });
        }

        // ==========================================
        // تنفيذ عملية الحفظ (SAVE / INSERT)
        // ==========================================
        const saveId = targetId || `debt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const pName = (d.personName || d.person_name || 'غير محدد').toString().trim();
        const title = (d.title || d.notes || `دين: ${pName}`).toString().trim();
        const amount = parseFloat(d.amount) || 0.00;
        const type = (d.type || 'owed_to_me').toString().trim();
        const personPhone = d.personPhone || d.person_phone || d.phone || null;
        const dueDate = d.dueDate || d.due_date || null;
        const status = d.status || 'pending';
        const notes = d.notes || null;
        const createdAt = d.createdAt || d.created_at || new Date().toISOString();

        const saveQuery = `
            INSERT INTO debts (
                id, user_id, title, amount, type, person_name, person_phone, due_date, status, notes, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (id) DO UPDATE SET
                user_id = EXCLUDED.user_id,
                title = EXCLUDED.title,
                amount = EXCLUDED.amount,
                type = EXCLUDED.type,
                person_name = EXCLUDED.person_name,
                person_phone = EXCLUDED.person_phone,
                due_date = EXCLUDED.due_date,
                status = EXCLUDED.status,
                notes = EXCLUDED.notes
            RETURNING *;
        `;

        const saveParams = [saveId, userId || cleanSchema, title, amount, type, pName, personPhone, dueDate, status, notes, createdAt];
        const saveResult = await client.query(saveQuery, saveParams);

        return res.status(200).json({
            success: true,
            schemaUsed: cleanSchema,
            debt: saveResult.rows[0]
        });

    } catch (error) {
        console.error(`[DATABASE ERROR]:`, error);
        return res.status(500).json({ success: false, error: error.message });
    } finally {
        client.release();
    }
}
