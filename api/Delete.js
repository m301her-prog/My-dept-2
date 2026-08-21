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
        
        const companyName = body.companyName || body.company_name || queryParams.companyName || req.headers['x-company-name'];
        const userId = body.userId || body.user_id || queryParams.userId || req.headers['x-user-id'];
        const email = body.email || queryParams.email;

        if (!debtId && !personName) {
            return res.status(400).json({ error: 'يرجى إرسال id أو personName الخاص بالدين المراد حذفه' });
        }

        await client.connect();

        let targetCompanyName = companyName;
        let targetUserId = userId;

        // جلب بيانات الحساب من الجدول الرئيسي إذا كان أحد البيانات ناقصاً
        if ((!targetCompanyName || !targetUserId) && (targetUserId || email)) {
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

        // بناء قائمة بالـ Schemas المحتملة (الشركة + المستخدم)
        const sanitizedCompany = targetCompanyName 
            ? targetCompanyName.toString().trim().replace(/[^a-zA-Z0-9_]/g, '').toLowerCase() 
            : '';

        const candidateSchemas = [];
        if (sanitizedCompany) {
            candidateSchemas.push(`schema_${sanitizedCompany}`);
        }
        if (targetUserId) {
            candidateSchemas.push(`schema_user_${String(targetUserId).replace('usr_', '')}`);
        }

        let deleteResult = { rowCount: 0, rows: [] };
        let successfulSchema = '';

        // التجربة في الـ Schemas المتاحة لضمان عدم حدوث 404 بسبب اختلاف الاسم
        for (const currentSchema of candidateSchemas) {
            try {
                await client.query(`SET search_path TO "${currentSchema}";`);

                const cleanId = debtId ? String(debtId).trim() : '';
                const rawIdWithoutPrefix = cleanId.replace(/^debt_/, '');

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
                // تجاهل خطأ عدم وجود السكيمّا والانتقال للتالية
            }
        }

        // في حال عدم العثور على السجل في أي سكيمّا، إرجاع تشخيص واضح
        if (deleteResult.rowCount === 0) {
            const primarySchema = candidateSchemas[0] || 'unknown';
            await client.query(`SET search_path TO "${primarySchema}";`).catch(() => {});
            const sampleRows = await client.query(`SELECT id, person_name FROM debts LIMIT 3;`).catch(() => ({ rows: [] }));

            return res.status(404).json({
                error: 'لم يتم العثور على الدين المراد حذفه',
                schemasChecked: candidateSchemas,
                searchedFor: { debtId, personName },
                existingSamplesInDb: sampleRows.rows
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
