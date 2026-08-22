import pg from 'pg';

// 1. استخدام Pool عالمي لتحمل ضغط الطلبات العالي وإعادة استخدام الاتصالات
const baseConnectionString = process.env.DATABASE_URL;
let pool;

if (baseConnectionString) {
    const separator = baseConnectionString.includes('?') ? '&' : '?';
    const finalConnectionString = `${baseConnectionString}${separator}sslmode=verify-full`;

    pool = new pg.Pool({
        connectionString: finalConnectionString,
        ssl: { rejectUnauthorized: false },
        max: 20,                  // أقصى عدد اتصالات بالتوازي
        idleTimeoutMillis: 30000, // إغلاق الاتصالات الخاملة
        connectionTimeoutMillis: 5000
    });
}

export default async function handler(req, res) {
    // إعدادات الـ CORS
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,DELETE,PUT,PATCH');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-tenant-schema, x-company-name, x-user-id, tenant, user-id'
    );

    if (req.method === 'OPTIONS') return res.status(200).end();

    if (!pool) {
        return res.status(500).json({ error: 'DATABASE_URL غير معرف في متغيرات البيئة' });
    }

    // اقتطاع اتصال من الـ Pool
    const client = await pool.connect();

    try {
        let body = req.body || {};
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (e) {}
        }

        const queryParams = req.query || {};

        const debtId = body.id || body.debtId || queryParams.id;
        const personName = body.personName || body.person_name || queryParams.personName;
        
        let companyName = body.companyName || body.company_name || queryParams.companyName || req.headers['x-company-name'];
        let userId = body.userId || body.user_id || queryParams.userId || req.headers['x-user-id'] || req.headers['user-id'];
        let tenantHeader = req.headers['x-tenant-schema'] || req.headers['tenant'];
        const email = body.email || queryParams.email;

        // التحقق من إرسال معرف للعملية
        if (!debtId && !personName) {
            return res.status(400).json({ error: 'يرجى إرسال id أو personName الخاص بالدين المراد حذفه' });
        }

        // 2. استكمال بيانات الحساب للبحث عن السكيمّا الصحيحة
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

        // 3. بناء قائمة السكيمات المحتملة حسب الأولوية
        const candidateSchemas = [];

        if (tenantHeader) {
            const cleanTenant = tenantHeader.toString().trim().replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
            if (cleanTenant) candidateSchemas.push(cleanTenant);
        }

        if (companyName) {
            const sanitizedCompany = companyName.toString().trim().replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
            if (sanitizedCompany) candidateSchemas.push(`schema_${sanitizedCompany}`);
        }

        if (userId) {
            const cleanUserId = String(userId).replace('usr_', '').replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
            candidateSchemas.push(`schema_user_${cleanUserId}`);
            candidateSchemas.push(`user_${cleanUserId}`);
        }

        candidateSchemas.push('public');

        // إزالة التكرارات من قائمة السكيمّات
        const uniqueSchemas = [...new Set(candidateSchemas)];

        let actionResult = { rowCount: 0, rows: [] };
        let successfulSchema = '';

        const cleanId = debtId ? String(debtId).trim() : '';
        const rawIdWithoutPrefix = cleanId.replace(/^debt_/, '');

        // 4. تنفيذ الحذف بالمرور على السكيمات المتاحة
        for (const currentSchema of uniqueSchemas) {
            try {
                await client.query(`SET search_path TO "${currentSchema}";`);

                // التأكد من وجود الجدول أولاً
                const tableCheck = await client.query(`
                    SELECT EXISTS (
                        SELECT FROM information_schema.tables 
                        WHERE table_schema = $1 AND table_name = 'debts'
                    );
                `, [currentSchema]);

                if (!tableCheck.rows[0].exists) continue;

                // التحقق من وجود عمود is_deleted (للدعم المزدوج بين Soft Delete و Hard Delete)
                const colCheck = await client.query(`
                    SELECT EXISTS (
                        SELECT FROM information_schema.columns 
                        WHERE table_schema = $1 AND table_name = 'debts' AND column_name = 'is_deleted'
                    );
                `, [currentSchema]);

                const hasIsDeleted = colCheck.rows[0].exists;

                // تنفيذ الحذف حسب العمود المتوفر
                if (cleanId) {
                    if (hasIsDeleted) {
                        actionResult = await client.query(
                            `UPDATE debts 
                             SET is_deleted = true
                             WHERE id::text = $1 
                                OR id::text = $2 
                                OR id::text LIKE $3 
                                OR REPLACE(id::text, 'debt_', '') = $4
                             RETURNING *;`,
                            [cleanId, `debt_${rawIdWithoutPrefix}`, `%${rawIdWithoutPrefix}%`, rawIdWithoutPrefix]
                        );
                    } else {
                        actionResult = await client.query(
                            `DELETE FROM debts 
                             WHERE id::text = $1 
                                OR id::text = $2 
                                OR id::text LIKE $3 
                                OR REPLACE(id::text, 'debt_', '') = $4
                             RETURNING *;`,
                            [cleanId, `debt_${rawIdWithoutPrefix}`, `%${rawIdWithoutPrefix}%`, rawIdWithoutPrefix]
                        );
                    }
                }

                // الحذف بالاسم في حال عدم العثور بالـ ID
                if (actionResult.rowCount === 0 && personName) {
                    if (hasIsDeleted) {
                        actionResult = await client.query(
                            `UPDATE debts 
                             SET is_deleted = true
                             WHERE LOWER(TRIM(person_name)) = LOWER(TRIM($1)) 
                             RETURNING *;`,
                            [String(personName).trim()]
                        );
                    } else {
                        actionResult = await client.query(
                            `DELETE FROM debts 
                             WHERE LOWER(TRIM(person_name)) = LOWER(TRIM($1)) 
                             RETURNING *;`,
                            [String(personName).trim()]
                        );
                    }
                }

                if (actionResult.rowCount > 0) {
                    successfulSchema = currentSchema;
                    break;
                }
            } catch (err) {
                console.error(`خطأ أثناء الحذف في السكيمّا ${currentSchema}:`, err.message);
                continue;
            }
        }

        if (actionResult.rowCount === 0) {
            return res.status(200).json({
                success: true,
                message: 'تم الحذف أو لم يتم العثور على العنصر في قواعد البيانات',
                schemasChecked: uniqueSchemas
            });
        }

        return res.status(200).json({
            success: true,
            message: 'تم حذف الدين بنجاح',
            schemaName: successfulSchema,
            deletedRecord: actionResult.rows[0]
        });

    } catch (error) {
        console.error('Delete API Error:', error);
        return res.status(500).json({ success: false, error: error.message || 'حدث خطأ أثناء تنفيذ الحذف' });
    } finally {
        // إرجاع الاتصال إلى הـ Pool
        client.release();
    }
}
