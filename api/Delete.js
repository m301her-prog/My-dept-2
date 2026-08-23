import pg from 'pg';

// 1. استخدام Pool عالمي لإعادة استخدام الاتصالات وتحمل الضغط العالي
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
    
    // السماح بطريقتي POST و DELETE لعملية الحذف
    if (req.method !== 'POST' && req.method !== 'DELETE') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    if (!pool) {
        return res.status(500).json({ success: false, error: 'DATABASE_URL غير معرف في متغيرات البيئة' });
    }

    // اقتطاع اتصال من الـ Pool
    const client = await pool.connect();

    try {
        let body = req.body || {};
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (e) {}
        }

        const d = body.debtData || body.debt || body.updates || body.data || body;
        
        // استخراج معرف الدين (id) من عدة أماكن محتملة أو من الـ Query Params
        const targetId = body.id || body.debtId || d.id || d._id || req.query?.id || req.query?.debtId;
        
        let userId = body.userId || body.user_id || d.userId || d.user_id || req.headers['x-user-id'] || null;
        const finalCompanyName = body.companyName || body.company_name || body.company || d.companyName || d.company_name || d.company;

        if (!targetId) {
            return res.status(400).json({ success: false, error: 'المعرف (id) مطلوب لعملية الحذف' });
        }

        // تحديد وعزل السكيمّا (Schema Isolation)
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

        // إعداد السكيمّا المستهدفة
        await client.query(`CREATE SCHEMA IF NOT EXISTS "${cleanSchema}";`);
        await client.query(`SET search_path TO "${cleanSchema}";`);

        // تنفيذ كويري الحذف وإرجاع العنصر المحذوف للتأكيد
        const query = `DELETE FROM debts WHERE id = $1 RETURNING *;`;
        const result = await client.query(query, [targetId]);

        if (result.rowCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'لم يتم العثور على السجل المطلوب حذفه',
                schemaUsed: cleanSchema
            });
        }

        return res.status(200).json({
            success: true,
            message: 'تم الحذف بنجاح',
            schemaUsed: cleanSchema,
            deletedDebt: result.rows[0],
            rowCount: result.rowCount
        });

    } catch (error) {
        console.error(`[DATABASE ERROR ON DELETE]:`, error);
        return res.status(500).json({ success: false, error: error.message });
    } finally {
        // إرجاع الاتصال إلى Pool
        client.release();
    }
}
