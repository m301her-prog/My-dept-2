import pg from 'pg';

// 1. استخدام Pool عالمي لإعادة استخدام الاتصالات
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
    // إعدادات CORS
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

        // 2. استخراج المعرفات واسم الشخص
        const deleteId = body.id || body.debtId || d.id || d._id;
        const personName = body.personName || body.person_name || d.personName || d.person_name;

        if (!deleteId && !personName) {
            return res.status(400).json({ 
                success: false, 
                error: 'مطلوب توفير (id) أو (personName) لإتمام عملية الحذف' 
            });
        }

        // 3. استخراج بيانات المستخدم والشركة
        let userId = body.userId || body.user_id || d.userId || d.user_id || req.headers['x-user-id'] || null;
        const finalCompanyName = body.companyName || body.company_name || body.company || d.companyName || d.company_name || d.company;

        // 4. تحديد وعزل السكيمّا
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

        // تجربة الحذف في السكيمّا الأساسية المحددة أولاً ثم public كخيار إضافي
        const schemasToTry = Array.from(new Set([cleanSchema, 'public']));
        let deletedRecord = null;
        let usedSchema = cleanSchema;

        for (const schema of schemasToTry) {
            await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}";`);
            await client.query(`SET search_path TO "${schema}";`);

            // التأكد من وجود الجدول
            const tableCheck = await client.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = $1 AND table_name = 'debts'
                );
            `, [schema]);

            if (!tableCheck.rows[0].exists) continue;

            // 1) محاولة الحذف برقم ID أولاً
            if (deleteId) {
                const deleteByIdQuery = `
                    DELETE FROM debts 
                    WHERE id::text = $1::text 
                    RETURNING *;
                `;
                const resById = await client.query(deleteByIdQuery, [deleteId]);
                if (resById.rowCount > 0) {
                    deletedRecord = resById.rows[0];
                    usedSchema = schema;
                    break;
                }
            }

            // 2) محاولة الحذف باسم الشخص (Fallback في حال عدم العثور بـ ID)
            if (personName) {
                const deleteByNameQuery = `
                    DELETE FROM debts 
                    WHERE LOWER(person_name) = LOWER($1) OR LOWER(personName) = LOWER($1)
                    RETURNING *;
                `;
                const resByName = await client.query(deleteByNameQuery, [personName]);
                if (resByName.rowCount > 0) {
                    deletedRecord = resByName.rows[0];
                    usedSchema = schema;
                    break;
                }
            }
        }

        // إذا لم يتم العثور عليه مطلقاً
        if (!deletedRecord) {
            return res.status(404).json({
                success: false,
                schemaUsed: cleanSchema,
                error: `لم يتم العثور على الدين المراد حذفه بالمعرف (${deleteId}) أو الاسم (${personName})`
            });
        }

        return res.status(200).json({ 
            success: true, 
            message: 'تم حذف البيانات بنجاح',
            schemaUsed: usedSchema, 
            deletedDebt: deletedRecord
        });

    } catch (error) {
        console.error(`[DATABASE ERROR ON DELETE]:`, error);
        return res.status(500).json({ success: false, error: error.message });
    } finally {
        client.release();
    }
}
