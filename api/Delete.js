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
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS,DELETE');
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

        // 1. استخراج الـ ID الحقيقي للديون (مثل: debt_mt3ib9fn_180j1)
        const deleteId = body.id || body.debtId || d.id || d._id;
        const personName = body.personName || body.person_name || body.name || d.personName || d.person_name || d.name;
        const personPhone = body.personPhone || body.person_phone || body.phone || d.personPhone || d.person_phone || d.phone;

        if (!deleteId && !personName && !personPhone) {
            return res.status(400).json({ 
                success: false, 
                error: 'يلزم إرسال المعرف (id) أو اسم الشخص أو رقم الهاتف لإكمال عملية الحذف' 
            });
        }

        // 2. استخراج بيانات المستخدم والشركة
        let userId = body.userId || body.user_id || d.userId || d.user_id || req.headers['x-user-id'] || null;
        let companyName = body.companyName || body.company_name || body.company || d.companyName || d.company_name || d.company;

        // 3. تحديد الـ Schema بفس فلسفة كود التسجيل والحفظ
        let targetSchema = req.headers['x-tenant-schema'];

        // إذا لم تصل السكيمّا في الهيدر، نجلب بيانات الشركة من app_users لضمان الدقة
        if ((!targetSchema || targetSchema.trim() === '') && userId) {
            try {
                const userRes = await client.query(
                    'SELECT company_name FROM public.app_users WHERE id = $1 LIMIT 1', 
                    [userId]
                );
                if (userRes.rows.length > 0 && userRes.rows[0].company_name) {
                    companyName = userRes.rows[0].company_name;
                }
            } catch (err) {
                console.error('Error fetching user company:', err);
            }
        }

        if (!targetSchema || targetSchema.trim() === '') {
            if (companyName && companyName.toString().trim() !== '') {
                const sanitizedCompany = companyName.toString().trim().replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
                targetSchema = sanitizedCompany ? `schema_${sanitizedCompany}` : null;
            }
            if (!targetSchema && userId) {
                const cleanUser = userId.toString().trim().replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
                targetSchema = `schema_user_${cleanUser.replace('usr_', '')}`;
            }
            if (!targetSchema) targetSchema = 'public';
        }

        const cleanSchema = targetSchema.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();

        // تجربة البحث والحذف في السكيمّا الرئيسية المحسوبة ثم public
        const schemasToTry = Array.from(new Set([cleanSchema, 'public']));
        let deletedRecord = null;
        let usedSchema = cleanSchema;

        for (const schema of schemasToTry) {
            await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}";`);
            await client.query(`SET search_path TO "${schema}";`);

            // التأكد من وجود جدول debts في هذه السكيمّا
            const tableCheck = await client.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = $1 AND table_name = 'debts'
                );
            `, [schema]);

            if (!tableCheck.rows[0].exists) continue;

            // بناء استعلام الحذف بتطابق النص الكامل لـ ID الموضح بالصورة
            let conditions = [];
            let params = [];
            let idx = 1;

            if (deleteId) {
                conditions.push(`id = $${idx}`);
                params.push(String(deleteId).trim());
                idx++;
            }

            if (personName) {
                conditions.push(`(LOWER(TRIM(person_name)) = LOWER(TRIM($${idx})) OR LOWER(TRIM("personName")) = LOWER(TRIM($${idx})))`);
                params.push(String(personName));
                idx++;
            }

            if (personPhone) {
                conditions.push(`(phone = $${idx} OR person_phone = $${idx} OR "personPhone" = $${idx})`);
                params.push(String(personPhone).trim());
                idx++;
            }

            const deleteQuery = `
                DELETE FROM debts 
                WHERE ${conditions.join(' OR ')}
                RETURNING *;
            `;

            const result = await client.query(deleteQuery, params);

            if (result.rowCount > 0) {
                deletedRecord = result.rows[0];
                usedSchema = schema;
                break;
            }
        }

        if (!deletedRecord) {
            return res.status(404).json({
                success: false,
                targetSchema: cleanSchema,
                error: `لم يتم العثور على الدين المُراد حذفه في السكيمّا المعنية (${cleanSchema})`
            });
        }

        return res.status(200).json({ 
            success: true, 
            message: 'تمت عملية الحذف بنجاح',
            schemaUsed: usedSchema, 
            deletedDebt: deletedRecord
        });

    } catch (error) {
        console.error(`[DELETE API ERROR]:`, error);
        return res.status(500).json({ success: false, error: error.message });
    } finally {
        client.release();
    }
}
