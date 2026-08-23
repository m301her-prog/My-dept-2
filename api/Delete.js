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

        // 2. استخراج قيم المعرف والاسم والهاتف (بدون توليد ID عشوائي منعاً للـ 404)
        const deleteId = body.id || body.debtId || d.id || d._id || null;
        const personName = body.personName || body.person_name || body.name || d.personName || d.person_name || d.name || null;
        const personPhone = body.personPhone || body.person_phone || body.phone || d.personPhone || d.person_phone || d.phone || null;

        if (!deleteId && !personName && !personPhone) {
            return res.status(400).json({
                success: false,
                error: 'يلزم توفير (id) أو (person_name) أو (person_phone) لإتمام الحذف'
            });
        }

        // 3. تحديد وعزل السكيمّا (Schema Isolation) بنفس منطق الحفظ تماماً
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

        // 4. إعداد وتوجيه المسار للسكيمّا المستهدفة
        await client.query(`CREATE SCHEMA IF NOT EXISTS "${cleanSchema}";`);
        await client.query(`SET search_path TO "${cleanSchema}";`);

        // 5. بناء استعلام الحذف الشامل
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
            conditions.push(`(person_phone = $${idx} OR "personPhone" = $${idx} OR phone = $${idx})`);
            params.push(String(personPhone).trim());
            idx++;
        }

        const deleteQuery = `
            DELETE FROM debts 
            WHERE ${conditions.join(' OR ')}
            RETURNING *;
        `;

        let result = await client.query(deleteQuery, params);

        // خيار احتياطي (Fallback): إذا لم يجد السجل بالسكيمّا الحالية، يجرب البحث داخل public
        if (result.rowCount === 0 && cleanSchema !== 'public') {
            await client.query(`SET search_path TO "public";`);
            result = await client.query(deleteQuery, params);
        }

        if (result.rowCount === 0) {
            return res.status(404).json({
                success: false,
                schemaUsed: cleanSchema,
                error: `لم يتم العثور على سجل بالمعايير المرفقة (ID: ${deleteId || 'غير مدخل'}, الاسم: ${personName || 'غير مدخل'})`
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
        client.release();
    }
}
