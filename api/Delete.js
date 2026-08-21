import pg from 'pg';

export default async function handler(req, res) {
    // 1. السماح بطلبات CORS والتحقق من طريقة الطلب
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

        // استخراج البيانات المراد حذفها ومعلومات الحساب
        const debtId = body.id || body.debtId || queryParams.id;
        const personName = body.personName || body.person_name || queryParams.personName;
        
        const companyName = body.companyName || body.company_name || queryParams.companyName || req.headers['x-company-name'];
        const userId = body.userId || body.user_id || queryParams.userId || req.headers['x-user-id'];
        const email = body.email || queryParams.email;

        if (!debtId && !personName) {
            return res.status(400).json({ error: 'يرجى إرسال id أو personName الخاص بالدين المراد حذفه' });
        }

        await client.connect();

        let targetCompanyName = companyName;
        let targetUserId = userId;

        // 💡 نفس منطق التسجيل: إذا لم يصل اسم الشركة، نستعلم عنه من public.app_users باستخدام userId أو email
        if (!targetCompanyName && (targetUserId || email)) {
            const userQuery = targetUserId 
                ? 'SELECT company_name, id FROM public.app_users WHERE id = $1 LIMIT 1'
                : 'SELECT company_name, id FROM public.app_users WHERE LOWER(email) = LOWER($1) LIMIT 1';
            const userParam = targetUserId || email;
            
            const userRes = await client.query(userQuery, [userParam]);
            if (userRes.rows.length > 0) {
                targetCompanyName = userRes.rows[0].company_name;
                targetUserId = userRes.rows[0].id;
            }
        }

        if (!targetCompanyName && !targetUserId) {
            return res.status(400).json({ 
                error: 'تعذر تحديد الحساب. يرجى إرسال userId أو companyName أو email في الطلب' 
            });
        }

        // 💡 نفس الخوارزمية المستخدمة في كود إنشاء الحساب تماماً
        const sanitizedCompany = targetCompanyName 
            ? targetCompanyName.toString().trim().replace(/[^a-zA-Z0-9_]/g, '').toLowerCase() 
            : '';

        const schemaName = sanitizedCompany 
            ? `schema_${sanitizedCompany}` 
            : `schema_user_${String(targetUserId).replace('usr_', '')}`;

        // التبديل إلى الـ Schema المطلوبة
        await client.query(`SET search_path TO "${schemaName}";`);

        // تنفيذ عملية الحذف بالـ ID أو باسم الشخص
        let deleteResult;
        if (debtId) {
            deleteResult = await client.query(
                `DELETE FROM debts WHERE id::text = $1 OR id::text = $2 RETURNING *;`,
                [String(debtId), `debt_${String(debtId).replace(/^debt_/, '')}`]
            );
        } else {
            deleteResult = await client.query(
                `DELETE FROM debts WHERE LOWER(TRIM(person_name)) = LOWER(TRIM($1)) RETURNING *;`,
                [String(personName)]
            );
        }

        if (deleteResult.rowCount === 0) {
            return res.status(404).json({
                error: 'لم يتم العثور على الدين المراد حذفه',
                schemaNameUsed: schemaName,
                searchedFor: { debtId, personName }
            });
        }

        return res.status(200).json({
            success: true,
            message: 'تم حذف الدين بنجاح',
            schemaName: schemaName,
            deletedRecord: deleteResult.rows[0]
        });

    } catch (error) {
        console.error('Delete API Error:', error);
        return res.status(500).json({ error: error.message || 'حدث خطأ أثناء عملية الحذف' });
    } finally {
        if (client) await client.end().catch(err => console.error('Error closing client:', err));
    }
}
