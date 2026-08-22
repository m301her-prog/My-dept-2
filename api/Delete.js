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
        max: 20,                  // أقصى عدد اتصالات
        idleTimeoutMillis: 30000, // إغلاق الاتصال الخامل بعد 30 ثانية
        connectionTimeoutMillis: 5000 // المهلة الزمنية للاتصال
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
    
    // قبول POST أو DELETE لعمليات الحذف
    if (!['POST', 'DELETE'].includes(req.method)) {
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
        
        // 2. استخراج الـ ID المراد حذفه من مختلف المصادر المحتملة (أو من query params لو أُرسل مع DELETE)
        const targetId = req.query.id || body.id || body.debtId || d.id || d._id;
        
        let userId = body.userId || body.user_id || d.userId || d.user_id || req.headers['x-user-id'] || null;
        const finalCompanyName = body.companyName || body.company_name || body.company || d.companyName || d.company_name || d.company;

        if (!targetId) {
            return res.status(400).json({ 
                success: false, 
                error: 'معرف الدين (id) مطلوب لإتمام عملية الحذف' 
            });
        }

        // 3. تحديد وعزل السكيمّا (Schema Isolation) بنفس المنطق بالضبط
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

        // إعداد وتوجيه البحث للسكيمّا المستهدفة
        await client.query(`CREATE SCHEMA IF NOT EXISTS "${cleanSchema}";`);
        await client.query(`SET search_path TO "${cleanSchema}";`);

        // تنفيذ استعلام الحذف وإرجاع البيانات المحذوفة للتأكد
        const query = `DELETE FROM debts WHERE id = $1 RETURNING *;`;
        const result = await client.query(query, [targetId]);

        // إذا لم يتم العثور على العنصر لحذفه
        if (result.rowCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'لم يتم العثور على السجل المطلوب حذفه',
                schemaUsed: cleanSchema
            });
        }

        return res.status(200).json({ 
            success: true, 
            message: 'تم حذف البيانات بنجاح',
            schemaUsed: cleanSchema, 
            deletedRow: result.rows[0],
            rowCount: result.rowCount 
        });

    } catch (error) {
        console.error(`[DATABASE ERROR ON DELETE]:`, error);
        return res.status(500).json({ success: false, error: error.message });
    } finally {
        client.release();
    }
}
