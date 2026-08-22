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
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,DELETE,PUT,PATCH');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-tenant-schema, x-company-name, x-user-id, tenant, user-id'
    );

    if (req.method === 'OPTIONS') return res.status(200).end();

    if (!pool) return res.status(500).json({ error: 'DATABASE_URL غير معرف' });

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

        if (!debtId && !personName) {
            return res.status(400).json({ error: 'يرجى إرسال id أو personName الخاص بالدين' });
        }

        // 1. بناء المخططات المحتملة (Schemas)
        const candidateSchemas = [];
        if (tenantHeader) candidateSchemas.push(tenantHeader.toLowerCase().replace(/[^a-zA-Z0-9_]/g, ''));
        if (companyName) candidateSchemas.push(`schema_${companyName.toLowerCase().replace(/[^a-zA-Z0-9_]/g, '')}`);
        if (userId) {
            const cleanUser = String(userId).replace('usr_', '').toLowerCase().replace(/[^a-zA-Z0-9_]/g, '');
            candidateSchemas.push(`schema_user_${cleanUser}`);
        }
        candidateSchemas.push('public');

        const uniqueSchemas = [...new Set(candidateSchemas)];
        const cleanId = debtId ? String(debtId).trim() : '';
        const rawIdWithoutPrefix = cleanId.replace(/^debt_/, '');

        // 2. بناء أسماء الجداول المحتملة (debts أو user_{userId}_debts)
        const targetTables = ['debts'];
        if (userId) {
            const formattedUserId = String(userId).replace(/-/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
            targetTables.unshift(`user_${formattedUserId}_debts`);
        }

        let actionResult = { rowCount: 0, rows: [] };
        let successfulSchema = '';
        let successfulTable = '';

        // البحث في جميع المخططات والجداول المحتملة
        for (const currentSchema of uniqueSchemas) {
            try {
                await client.query(`SET search_path TO "${currentSchema}";`);

                for (const table of targetTables) {
                    try {
                        if (cleanId) {
                            actionResult = await client.query(
                                `DELETE FROM ${table} 
                                 WHERE id::text = $1 
                                    OR id::text = $2 
                                    OR id::text LIKE $3 
                                    OR REPLACE(id::text, 'debt_', '') = $4
                                 RETURNING *;`,
                                [cleanId, `debt_${rawIdWithoutPrefix}`, `%${rawIdWithoutPrefix}%`, rawIdWithoutPrefix]
                            );
                        }

                        if (actionResult.rowCount === 0 && personName) {
                            actionResult = await client.query(
                                `DELETE FROM ${table} 
                                 WHERE LOWER(TRIM(person_name)) = LOWER(TRIM($1)) 
                                 RETURNING *;`,
                                [String(personName).trim()]
                            );
                        }

                        if (actionResult.rowCount > 0) {
                            successfulSchema = currentSchema;
                            successfulTable = table;
                            break;
                        }
                    } catch (tableErr) {
                        // تجاهل خطأ عدم وجود الجدول والتنقل للجدول التالي
                        continue;
                    }
                }

                if (actionResult.rowCount > 0) break;
            } catch (err) {
                continue;
            }
        }

        // 3. التحقق من نجاح عملية الحذف الفعلية
        if (actionResult.rowCount === 0) {
            return res.status(444 || 404).json({
                success: false,
                message: 'لم يتم العثور على الدين في أي جدول أو مخطط لحذفه',
                searchedSchemas: uniqueSchemas,
                debtId: cleanId
            });
        }

        return res.status(200).json({
            success: true,
            message: 'تم الحذف النهائي للدين بنجاح',
            schemaName: successfulSchema,
            tableName: successfulTable,
            deletedRecord: actionResult.rows[0]
        });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    } finally {
        client.release();
    }
}
