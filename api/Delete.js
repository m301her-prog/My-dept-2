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
    // إعدادات CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-tenant-schema, x-user-id'
    );

    if (req.method === 'OPTIONS') return res.status(200).end();
    
    if (req.method !== 'POST' && req.method !== 'DELETE') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

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
        const targetId = body.id || body.debtId || d.id || d._id || req.query?.id || req.query?.debtId;
        
        let userId = body.userId || body.user_id || d.userId || d.user_id || req.headers['x-user-id'] || null;
        const finalCompanyName = body.companyName || body.company_name || body.company || d.companyName || d.company_name || d.company;

        if (!targetId) {
            return res.status(400).json({ success: false, error: 'المعرف (id) مطلوب لعملية الحذف' });
        }

        // 1. محاولة استخراج السكيمّا المباشرة من الهيدر أو بيانات الشركة/المستخدم
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
        }

        const deleteQuery = `DELETE FROM debts WHERE id = $1 RETURNING *;`;
        let result = { rowCount: 0, rows: [] };
        let matchedSchema = null;

        // 2. إذا تم تحديد السكيمّا بوضوح، حاول الحذف منها أولاً
        if (targetSchema) {
            const cleanSchema = targetSchema.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
            try {
                await client.query(`SET search_path TO "${cleanSchema}";`);
                result = await client.query(deleteQuery, [targetId]);
                if (result.rowCount > 0) {
                    matchedSchema = cleanSchema;
                }
            } catch (err) {
                // في حال عدم وجود الجدول أو السكيمّا سنتجه للمسح الشامل
            }
        }

        // 3. (Fallback الذكي): إذا لم يُعثر على السجل، قم بالبحث في كافة السكيمات التي تبدأ بـ schema_
        if (result.rowCount === 0) {
            const schemasResult = await client.query(`
                SELECT schema_name 
                FROM information_schema.schemata 
                WHERE schema_name LIKE 'schema_%'
            `);

            const allSchemas = schemasResult.rows.map(r => r.schema_name);

            for (const schemaName of allSchemas) {
                // تجنب إعادة الفحص للسكيمّا التي تم فحصها مسبقاً
                if (targetSchema && schemaName === targetSchema.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase()) continue;

                try {
                    await client.query(`SET search_path TO "${schemaName}";`);
                    const checkResult = await client.query(deleteQuery, [targetId]);
                    
                    if (checkResult.rowCount > 0) {
                        result = checkResult;
                        matchedSchema = schemaName;
                        break; // تم العثور على السجل وحذفه، اخرج من الحلقة
                    }
                } catch (err) {
                    // تجاهل السكيمات التي لا تحتوي على جدول debts
                    continue;
                }
            }
        }

        // 4. إرجاع النتيجة للعميل
        if (result.rowCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'لم يتم العثور على السجل في أي من السكيمات الخاصة بالشركات',
                targetId: targetId
            });
        }

        return res.status(200).json({
            success: true,
            message: 'تم الحذف بنجاح',
            schemaUsed: matchedSchema,
            deletedDebt: result.rows[0],
            rowCount: result.rowCount
        });

    } catch (error) {
        console.error(`[DATABASE ERROR ON DELETE]:`, error);
        return res.status(500).json({ success: false, error: error.message });
    } finally {
        client.release();
    }
}
