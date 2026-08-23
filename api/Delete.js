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

        // 2. استخراج المعرف (ID) بدقة بدون توليد قيم عشوائية
        const deleteId = body.id || body.debtId || d.id || d._id;

        if (!deleteId) {
            return res.status(400).json({ 
                success: false, 
                error: 'المعرف (id) مطلوب بشكل صريح لإتمام عملية الحذف' 
            });
        }

        // 3. استخراج بيانات المستخدم والشركة بنفس منطق كود الحفظ
        let userId = body.userId || body.user_id || d.userId || d.user_id || req.headers['x-user-id'] || null;
        const finalCompanyName = body.companyName || body.company_name || body.company || d.companyName || d.company_name || d.company;

        // 4. تحديد وعزل السكيمّا (Schema Isolation) بنفس منطق الحفظ
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

        if (!userId || userId.toString().trim() === '') {
            userId = cleanSchema;
        }

        // 5. التوجيه إلى السكيمّا المستهدفة
        await client.query(`CREATE SCHEMA IF NOT EXISTS "${cleanSchema}";`);
        await client.query(`SET search_path TO "${cleanSchema}";`);

        // 6. تنفيذ عملية الحذف والبحث بـ ID مع إرجاع العنصر المحذوف
        const query = `
            DELETE FROM debts 
            WHERE id = $1 
            RETURNING *;
        `;
        const params = [deleteId];

        const result = await client.query(query, params);

        // التحقق مما إذا تم العثور على العنصر وحذفه بالفعل
        if (result.rowCount === 0) {
            return res.status(404).json({
                success: false,
                schemaUsed: cleanSchema,
                error: `لم يتم العثور على سجل بالمعرف (${deleteId}) داخل السكيمّا المحدد`
            });
        }

        return res.status(200).json({ 
            success: true, 
            message: 'تم حذف البيانات بنجاح',
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
