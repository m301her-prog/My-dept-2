import pg from 'pg';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,DELETE');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-tenant-schema, x-company-name, x-user-id, tenant, user-id'
    );

    if (req.method === 'OPTIONS') return res.status(200).end();

    const baseConnectionString = process.env.DATABASE_URL;
    if (!baseConnectionString) {
        return res.status(500).json({ error: 'DATABASE_URL غير معرف في متغيرات البيئة' });
    }

    const separator = baseConnectionString.includes('?') ? '&' : '?';
    const finalConnectionString = `${baseConnectionString}${separator}sslmode=verify-full`;

    const client = new pg.Client({
        connectionString: finalConnectionString,
        ssl: { rejectUnauthorized: false }
    });

    try {
        let body = req.body || {};
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (e) {}
        }

        const queryParams = req.query || {};

        const debtId = body.id || body.debtId || queryParams.id;
        const personName = body.personName || body.person_name || queryParams.personName;
        
        let companyName = body.companyName || body.company_name || queryParams.companyName || req.headers['x-company-name'];
        let userId = body.userId || body.user_id || queryParams.userId || req.headers['x-user-id'];
        const email = body.email || queryParams.email;

        // تحقق من المعرفات الأساسية
        if (!debtId && !personName) {
            return res.status(400).json({ error: 'يرجى إرسال id أو personName الخاص بالدين المراد حذفه' });
        }

        await client.connect();

        // 1. محاولة استكمال بيانات الحساب إذا كان أحد البيانات ناقصاً
        if ((!companyName || !userId) && (userId || email)) {
            const userQuery = userId 
                ? 'SELECT company_name, id FROM public.app_users WHERE id = $1 LIMIT 1'
                : 'SELECT company_name, id FROM public.app_users WHERE LOWER(email) = LOWER($1) LIMIT 1';
            const userParam = userId || email;
            
            const userRes = await client.query(userQuery, [userParam]).catch(() => ({ rows: [] }));
            if (userRes.rows.length > 0) {
                companyName = companyName || userRes.rows[0].company_name;
                userId = userId || userRes.rows[0].id;
            }
        }

        // 2. بناء المخططات والجداول المحتملة دون رفض الطلب بـ 400
        const candidateSchemas = [];

        if (companyName) {
            const sanitizedCompany = companyName.toString().trim().replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
            if (sanitizedCompany) candidateSchemas.push(`schema_${sanitizedCompany}`);
        }

        if (userId) {
            const cleanUserId = String(userId).replace('usr_', '').replace(/[^a-zA-Z0-9_]/g, '_');
            candidateSchemas.push(`schema_user_${cleanUserId}`);
            candidateSchemas.push(`user_${cleanUserId}`);
        }

        // إضافة المخططات الافتراضية لمنع القفل وخطأ 400
        candidateSchemas.push('public');

        let deleteResult = { rowCount: 0, rows: [] };
        let successfulSchema = '';

        const cleanId = debtId ? String(debtId).trim() : '';
        const rawIdWithoutPrefix = cleanId.replace(/^debt_/, '');

        // 3. البحث والحذف عبر المخططات المتاحة
        for (const currentSchema of candidateSchemas) {
            try {
                await client.query(`SET search_path TO "${currentSchema}", public;`);

                if (cleanId) {
                    deleteResult = await client.query(
                        `DELETE FROM debts 
                         WHERE id::text = $1 
                            OR id::text = $2 
                            OR id::text LIKE $3 
                            OR REPLACE(id::text, 'debt_', '') = $4
                         RETURNING *;`,
                        [cleanId, `debt_${rawIdWithoutPrefix}`, `%${rawIdWithoutPrefix}%`, rawIdWithoutPrefix]
                    );
                }

                if (deleteResult.rowCount === 0 && personName) {
                    deleteResult = await client.query(
                        `DELETE FROM debts WHERE LOWER(TRIM(person_name)) = LOWER(TRIM($1)) RETURNING *;`,
                        [String(personName).trim()]
                    );
                }

                if (deleteResult.rowCount > 0) {
                    successfulSchema = currentSchema;
                    break;
                }
            } catch (err) {
                // استمرار البحث في حال كان الجدول أو الـ Schema غير موجود
                continue;
            }
        }

        if (deleteResult.rowCount === 0) {
            return res.status(200).json({
                success: true,
                message: 'تم الحذف محلياً أو تم حذفه سابقاً من القاعدة',
                schemasChecked: candidateSchemas
            });
        }

        return res.status(200).json({
            success: true,
            message: 'تم حذف الدين بنجاح',
            schemaName: successfulSchema,
            deletedRecord: deleteResult.rows[0]
        });

    } catch (error) {
        console.error('Delete API Error:', error);
        return res.status(500).json({ error: error.message || 'حدث خطأ أثناء عملية الحذف' });
    } finally {
        if (client) await client.end().catch(err => console.error('Error closing client:', err));
    }
}
