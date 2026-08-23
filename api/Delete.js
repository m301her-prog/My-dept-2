import pg from 'pg';

// 1. استخدام Pool عالمي
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

        // 2. استخراج قيم البحث الحقيقية المطابقة للصورة المرفقة
        const deleteId = body.id || body.debtId || d.id || d._id;
        const personName = body.personName || body.person_name || body.name || d.personName || d.person_name || d.name;
        const personPhone = body.personPhone || body.person_phone || body.phone || d.personPhone || d.person_phone || d.phone;

        if (!deleteId && !personName && !personPhone) {
            return res.status(400).json({ 
                success: false, 
                error: 'يتطلب الحذف توفير (id) أو (person_name) أو (person_phone)' 
            });
        }

        // 3. تحديد وعزل السكيمّا
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

        // البحث في السكيمّا المحددة ثم public
        const schemasToTry = Array.from(new Set([cleanSchema, 'public']));
        let deletedRecords = [];
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

            // مطابقة الأعمدة المباشرة من قاعدة البيانات (person_name / person_phone)
            let conditions = [];
            let params = [];
            let index = 1;

            if (deleteId) {
                conditions.push(`id::text = $${index}`);
                params.push(String(deleteId).trim());
                index++;
            }

            if (personName) {
                // استخدام TRIM و LOWER لمطابقة الأسماء مثل ", gmal" أو "عمار حسن"
                conditions.push(`(LOWER(TRIM(person_name)) = LOWER(TRIM($${index})) OR LOWER(TRIM("personName")) = LOWER(TRIM($${index})))`);
                params.push(String(personName));
                index++;
            }

            if (personPhone) {
                // مطابقة عمود person_phone الموجود بالصورة
                conditions.push(`(person_phone = $${index} OR "personPhone" = $${index} OR phone = $${index})`);
                params.push(String(personPhone).trim());
                index++;
            }

            // تنفيذ الحذف بشرط توفر أي من المعايير المُرسلة
            const deleteQuery = `
                DELETE FROM debts 
                WHERE ${conditions.join(' OR ')}
                RETURNING *;
            `;

            const result = await client.query(deleteQuery, params);

            if (result.rowCount > 0) {
                deletedRecords = result.rows;
                usedSchema = schema;
                break;
            }
        }

        if (deletedRecords.length === 0) {
            return res.status(404).json({
                success: false,
                schemaUsed: cleanSchema,
                error: 'لم يتم العثور على أي سجل مطابق لبيانات الحذف المرفقة'
            });
        }

        return res.status(200).json({ 
            success: true, 
            message: 'تم الحذف بنجاح من قاعدة البيانات',
            schemaUsed: usedSchema, 
            deletedCount: deletedRecords.length,
            deletedData: deletedRecords[0]
        });

    } catch (error) {
        console.error(`[DATABASE ERROR ON DELETE]:`, error);
        return res.status(500).json({ success: false, error: error.message });
    } finally {
        client.release();
    }
}
