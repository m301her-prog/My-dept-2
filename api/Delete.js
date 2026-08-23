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

// دالة مساعدة لقص النصوص وتفادي خطأ الطول المتجاوز (VARCHAR Limit)
const safeTruncate = (str, limit = 50) => {
    if (!str) return null;
    const stringVal = str.toString().trim();
    return stringVal.length > limit ? stringVal.substring(0, limit) : stringVal;
};

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
        
        // تحديد نوع العملية
        let action = (body.action || d.action || req.method).toString().toUpperCase().trim();
        if (req.method === 'DELETE') action = 'DELETE';

        // 1. استخراج المعرفات المباشرة مع آمان الطول
        const rawId = body.id || body.debtId || d.id || d._id || null;
        const targetId = safeTruncate(rawId, 50); // تقليم الـ ID لتجنب تجاوز 50 حرفاً
        const personName = safeTruncate(body.personName || body.person_name || d.personName || d.person_name, 50);

        // 2. تحديد وتوحيد السكيمّا المستهدفة
        let rawUserId = body.userId || body.user_id || d.userId || d.user_id || req.headers['x-user-id'] || null;
        const finalCompanyName = body.companyName || body.company_name || body.company || d.companyName || d.company_name || d.company;

        let targetSchema = req.headers['x-tenant-schema'];

        if (!targetSchema || targetSchema.trim() === '') {
            if (finalCompanyName && finalCompanyName.toString().trim() !== '') {
                const sanitizedCompany = finalCompanyName.toString().trim().replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
                targetSchema = sanitizedCompany ? `schema_${sanitizedCompany}` : null;
            }
            if (!targetSchema && rawUserId) {
                const cleanUser = rawUserId.toString().trim().replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
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

            let result = { rowCount: 0, rows: [] };

            // محاولة الحذف بالـ ID أولاً
            if (targetId) {
                try {
                    const deleteQuery = `DELETE FROM debts WHERE id::text = $1 RETURNING *;`;
                    result = await client.query(deleteQuery, [targetId.toString()]);
                } catch (e) {
                    console.warn('[DELETE ID WARN]:', e.message);
                }
            }

            // في حال عدم العثور بالـ ID وكان اسم الشخص متوفراً
            if (result.rowCount === 0 && personName) {
                const deleteQuery = `DELETE FROM debts WHERE LOWER(TRIM(person_name)) = LOWER(TRIM($1)) RETURNING *;`;
                result = await client.query(deleteQuery, [personName]);
            }

            // خيار الفحص الشامل في باقي السكيمات
            if (result.rowCount === 0) {
                const schemasResult = await client.query(`
                    SELECT schema_name FROM information_schema.schemata 
                    WHERE schema_name LIKE 'schema_%' OR schema_name = 'public'
                `);

                for (const sysSchema of schemasResult.rows.map(r => r.schema_name)) {
                    await client.query(`SET search_path TO "${sysSchema}";`);
                    
                    if (targetId) {
                        try {
                            result = await client.query(`DELETE FROM debts WHERE id::text = $1 RETURNING *;`, [targetId.toString()]);
                        } catch (e) {}
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
        const rawSaveId = targetId || `debt_${Date.now()}`;
        const saveId = safeTruncate(rawSaveId, 50);
        const userId = safeTruncate(rawUserId || cleanSchema, 50);
        const pName = safeTruncate(d.personName || d.person_name || 'غير محدد', 50);
        const title = safeTruncate(d.title || `دين: ${pName}`, 50);
        const amount = parseFloat(d.amount) || 0.00;
        const type = safeTruncate(d.type || 'owed_to_me', 20);
        const personPhone = safeTruncate(d.personPhone || d.person_phone || d.phone, 30);
        const dueDate = d.dueDate || d.due_date || null;
        const status = safeTruncate(d.status || 'pending', 20);
        const notes = d.notes ? d.notes.toString() : null; // الملاحظات تبقى طويلة طالما نوعها TEXT
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

        const saveParams = [saveId, userId, title, amount, type, pName, personPhone, dueDate, status, notes, createdAt];
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
