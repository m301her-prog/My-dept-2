import pg from 'pg';

/**
 * دالة تشخيصية لمعرفة السبب الدقيق لخطأ 404 عند فشل عملية الحذف
 */
async function diagnoseNotFoundReason(client, targetSchema, targetId, targetName) {
    const diagnostics = {
        schemaExists: false,
        tableExists: false,
        foundInOtherSchemas: [],
        totalRecordsInTable: 0,
        sampleRecords: [],
        possibleReason: ''
    };

    try {
        const schemaCheck = await client.query(
            `SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1`,
            [targetSchema]
        );
        diagnostics.schemaExists = schemaCheck.rows.length > 0;

        const tableCheck = await client.query(
            `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'debts'`,
            [targetSchema]
        );
        diagnostics.tableExists = tableCheck.rows.length > 0;

        if (!diagnostics.tableExists) {
            diagnostics.possibleReason = `الجدول debts غير موجود في السكيمّا (${targetSchema}).`;
            return diagnostics;
        }

        const countRes = await client.query(`SELECT COUNT(*) FROM "${targetSchema}".debts`);
        diagnostics.totalRecordsInTable = parseInt(countRes.rows[0].count, 10);

        if (diagnostics.totalRecordsInTable === 0) {
            diagnostics.possibleReason = `الجدول debts في السكيمّا (${targetSchema}) فارغ تماماً لا يحتوي على أي بيانات.`;
        } else {
            const sampleRes = await client.query(
                `SELECT id, person_name FROM "${targetSchema}".debts LIMIT 5`
            );
            diagnostics.sampleRecords = sampleRes.rows;
            diagnostics.possibleReason = `العنصر غير موجود في السكيمّا (${targetSchema}). يرجى التأكد من الـ ID أو الاسم المُرسل ومقارنته بالعينة المخزنة.`;
        }

        if (targetId && targetSchema !== 'public') {
            const publicCheck = await client.query(
                `SELECT id FROM public.debts WHERE id::text = $1 LIMIT 1`,
                [targetId]
            );

            if (publicCheck.rows.length > 0) {
                diagnostics.foundInOtherSchemas.push('public');
                diagnostics.possibleReason = `العنصر موجود في السكيمّا (public) وليس في السكيمّا المستهدفة (${targetSchema}). يرجى التثبت من تحديد (companyName / userId).`;
            }
        }

    } catch (err) {
        diagnostics.diagnosticError = err.message;
    }

    return diagnostics;
}

/**
 * دالة لتنظيف وتنسيق اسم السكيمّا بدعم كامل لأسماء الشركات والـ Fallback
 */
function normalizeSchemaName(inputName, fallbackUserId = null) {
    if (!inputName) {
        if (fallbackUserId) {
            return `schema_user_${fallbackUserId.toString().replace('usr_', '')}`;
        }
        return '';
    }
    let name = typeof inputName === 'object' ? JSON.stringify(inputName) : String(inputName).trim();
    if (name.startsWith('schema_')) {
        name = name.replace(/^schema_/, '');
    }
    name = name.replace(/[\s\W]+/g, '_').toLowerCase();
    name = name.replace(/^_+|_+$/g, '');
    
    return name ? `schema_${name}` : '';
}

async function resolveSchemaName(client, req, body) {
    const queryParams = req.query || {};
    const d = body.debtData || body.debt || body.updates || body.data || body;
    const userObj = body.user || d.user || {};
    const companyObj = body.company || d.company || {};

    const rawSchema = 
        req.headers['x-tenant-schema'] || 
        req.headers['x-company-name'] || 
        req.headers['tenant'] ||
        body.schemaName || 
        body.companyName || 
        body.company_name || 
        body.companyId || 
        body.company_id ||
        d.companyName || 
        d.company_name || 
        d.companyId || 
        d.company_id ||
        queryParams.companyName || 
        queryParams.schemaName ||
        userObj.companyName || 
        userObj.company_name || 
        userObj.company ||
        companyObj.name || 
        companyObj.companyName || 
        companyObj.id;

    if (rawSchema) {
        return normalizeSchemaName(rawSchema);
    }

    const userId = body.userId || body.user_id || d.userId || d.user_id || queryParams.userId || req.headers['x-user-id'] || req.headers['user-id'];
    if (userId && userId !== 'guest') {
        try {
            const dbRes = await client.query(
                `SELECT company_name FROM public.app_users WHERE id::text = $1 LIMIT 1;`,
                [String(userId)]
            );
            if (dbRes.rows.length > 0 && dbRes.rows[0].company_name) {
                return normalizeSchemaName(dbRes.rows[0].company_name, userId);
            }
        } catch (e) {
            console.warn('[SCHEMA RESOLUTION DB FALLBACK ERROR]:', e.message);
        }
    }

    return null;
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-tenant-schema, x-company-name, x-user-id, tenant, user-id'
    );

    if (req.method === 'OPTIONS') return res.status(200).end();

    const baseConnectionString = process.env.DATABASE_URL;
    if (!baseConnectionString) {
        return res.status(500).json({ success: false, error: 'DATABASE_URL غير معرف في متغيرات البيئة' });
    }

    const separator = baseConnectionString.includes('?') ? '&' : '?';
    const finalConnectionString = `${baseConnectionString}${separator}sslmode=verify-full`;

    const client = new pg.Client({
        connectionString: finalConnectionString,
        ssl: { rejectUnauthorized: false }
    });

    let body = req.body || {};
    if (typeof body === 'string') {
        try { body = JSON.parse(body || '{}'); } catch (e) {}
    }

    try {
        await client.connect();

        let cleanSchema = await resolveSchemaName(client, req, body);
        if (!cleanSchema) cleanSchema = 'public';

        const queryParams = req.query || {};
        const d = body.debtData || body.debt || body.updates || body.data || body;
        const rawAction = body.action || d.action || queryParams.action || (req.method === 'DELETE' ? 'DELETE' : 'SAVE');
        const action = rawAction.toString().toUpperCase().trim();

        const finalId = String(body.id || body.debtId || body._id || d.id || d.debtId || d._id || queryParams.id || '').trim();
        const targetName = String(body.personName || body.person_name || body.name || d.personName || d.person_name || queryParams.personName || '').trim();
        const userId = body.userId || body.user_id || d.userId || d.user_id || queryParams.userId || req.headers['x-user-id'] || req.headers['user-id'] || null;

        await client.query(`CREATE SCHEMA IF NOT EXISTS "${cleanSchema}";`);
        await client.query(`SET search_path TO "${cleanSchema}", public;`);

        await client.query(`
            CREATE TABLE IF NOT EXISTS debts (
                id VARCHAR(255) PRIMARY KEY,
                user_id VARCHAR(255),
                title TEXT,
                type VARCHAR(50),
                person_name TEXT,
                phone TEXT,
                amount NUMERIC(12,2) DEFAULT 0,
                currency VARCHAR(10) DEFAULT 'DZD',
                due_date TIMESTAMP,
                notes TEXT,
                status VARCHAR(50) DEFAULT 'pending',
                is_scheduled BOOLEAN DEFAULT false,
                schedule_type VARCHAR(50),
                installments_count INT DEFAULT 0,
                first_payment_date TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            ALTER TABLE debts ADD COLUMN IF NOT EXISTS user_id VARCHAR(255);
            ALTER TABLE debts ADD COLUMN IF NOT EXISTS title TEXT;
            ALTER TABLE debts ADD COLUMN IF NOT EXISTS phone TEXT;
            ALTER TABLE debts ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'DZD';
            ALTER TABLE debts ADD COLUMN IF NOT EXISTS is_scheduled BOOLEAN DEFAULT false;
            ALTER TABLE debts ADD COLUMN IF NOT EXISTS schedule_type VARCHAR(50);
            ALTER TABLE debts ADD COLUMN IF NOT EXISTS installments_count INT DEFAULT 0;
            ALTER TABLE debts ADD COLUMN IF NOT EXISTS first_payment_date TIMESTAMP;
            ALTER TABLE debts ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
            ALTER TABLE debts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
        `);

        const isDeleteAction = ['DELETE', 'DELETE_DEBT', 'DELETE_DATA', 'REMOVE'].includes(action) || req.method === 'DELETE';
        const isFetchAction = ['GET', 'GET_DATA', 'FETCH', 'READ'].includes(action) || req.method === 'GET';
        const isSyncAction = ['SYNC', 'SYNC_BATCH', 'BATCH_SAVE'].includes(action);

        const cleanDate = (dateVal) => {
            if (!dateVal || dateVal.toString().trim() === '' || dateVal.toString().includes('Invalid')) return null;
            return dateVal;
        };

        const upsertQuery = `
            INSERT INTO debts (
                id, user_id, title, type, person_name, phone, amount, currency, due_date, 
                notes, status, is_scheduled, schedule_type, installments_count, first_payment_date, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, CURRENT_TIMESTAMP)
            ON CONFLICT (id) DO UPDATE SET
                user_id = COALESCE(EXCLUDED.user_id, debts.user_id),
                title = COALESCE(EXCLUDED.title, debts.title),
                type = EXCLUDED.type,
                person_name = EXCLUDED.person_name,
                phone = EXCLUDED.phone,
                amount = EXCLUDED.amount,
                currency = EXCLUDED.currency,
                due_date = EXCLUDED.due_date,
                notes = EXCLUDED.notes,
                status = EXCLUDED.status,
                is_scheduled = EXCLUDED.is_scheduled,
                schedule_type = EXCLUDED.schedule_type,
                installments_count = EXCLUDED.installments_count,
                first_payment_date = EXCLUDED.first_payment_date,
                updated_at = CURRENT_TIMESTAMP
            RETURNING *;
        `;

        if (isDeleteAction) {
            if (!finalId && !targetName) {
                return res.status(400).json({
                    success: false,
                    error: 'يرجى إرسال id أو personName المُراد حذفه.'
                });
            }

            let deleteQuery = '';
            let queryParamsArr = [];

            if (finalId) {
                deleteQuery = `DELETE FROM "${cleanSchema}".debts WHERE id::text = $1 OR id::text LIKE $2 RETURNING *;`;
                queryParamsArr = [finalId, `%${finalId}%`];
            } else {
                deleteQuery = `DELETE FROM "${cleanSchema}".debts WHERE LOWER(TRIM(person_name)) = LOWER(TRIM($1)) RETURNING *;`;
                queryParamsArr = [targetName];
            }

            let result = await client.query(deleteQuery, queryParamsArr);

            // آلية الـ Fallback للحذف من السكيمّات الأخرى إذا لم يُعثر عليه في السكيمّا الحالية
            if (result.rowCount === 0 && finalId) {
                const allSchemasRes = await client.query(`
                    SELECT table_schema 
                    FROM information_schema.tables 
                    WHERE table_name = 'debts' AND table_schema NOT IN ('pg_catalog', 'information_schema')
                `);

                for (const row of allSchemasRes.rows) {
                    const schemaToSearch = row.table_schema;
                    if (schemaToSearch === cleanSchema) continue;

                    const fallbackDelete = await client.query(
                        `DELETE FROM "${schemaToSearch}".debts WHERE id::text = $1 OR id::text LIKE $2 RETURNING *;`,
                        [finalId, `%${finalId}%`]
                    ).catch(() => ({ rowCount: 0, rows: [] }));

                    if (fallbackDelete.rowCount > 0) {
                        return res.status(200).json({
                            success: true,
                            message: `تم الحذف بنجاح من السكيمّا البديلة (${schemaToSearch})`,
                            deletedCount: fallbackDelete.rowCount,
                            deletedRows: fallbackDelete.rows,
                            actualSchema: schemaToSearch
                        });
                    }
                }
            }

            if (result.rowCount === 0) {
                const diagnostics = await diagnoseNotFoundReason(client, cleanSchema, finalId, targetName);

                return res.status(404).json({
                    success: false,
                    message: `لم يتم العثور على العنصر بـ (${finalId || targetName}) للحذف في السكيمّا (${cleanSchema}).`,
                    debugInfo: {
                        searchedFor: { id: finalId, personName: targetName },
                        targetSchema: cleanSchema,
                        reason: diagnostics.possibleReason,
                        diagnostics
                    }
                });
            }

            return res.status(200).json({
                success: true,
                message: 'تم الحذف بنجاح من قاعدة البيانات',
                deletedCount: result.rowCount,
                deletedRows: result.rows,
                schemaUsed: cleanSchema
            });

        } else if (isFetchAction) {
            const result = await client.query(`SELECT * FROM debts ORDER BY created_at DESC;`);
            return res.status(200).json({ success: true, schemaUsed: cleanSchema, rows: result.rows });

        } else if (isSyncAction) {
            const items = body.items || body.debts || d.items || [];
            if (!Array.isArray(items) || items.length === 0) {
                return res.status(400).json({ success: false, error: 'لم يتم إرسال أي عناصر لمزامنتها' });
            }

            await client.query('BEGIN');
            const syncedRows = [];

            for (const item of items) {
                const activeId = item.id || item.debtId || item._id || `debt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
                const personName = item.personName || item.person_name || 'غير محدد';
                const title = item.title || item.notes || personName || 'دين جديد';
                const type = item.type || 'owed_to_me';
                const phone = item.phone || item.personPhone || null;
                const amount = parseFloat(item.amount) || 0;
                const currency = item.currency || 'DZD';
                const notes = item.notes || null;
                const status = item.status || 'pending';
                const isScheduled = item.isScheduled !== undefined ? item.isScheduled : (item.is_scheduled || false);
                const scheduleType = item.scheduleType || item.schedule_type || null;
                const installmentsCount = parseInt(item.installmentsCount) || parseInt(item.installments_count) || 0;

                const dueDate = cleanDate(item.dueDate || item.due_date);
                const firstPaymentDate = cleanDate(item.firstPaymentDate || item.first_payment_date);
                const createdAtVal = cleanDate(item.createdAt || item.created_at) || new Date().toISOString();

                const params = [activeId, userId, title, type, personName, phone, amount, currency, dueDate, notes, status, isScheduled, scheduleType, installmentsCount, firstPaymentDate, createdAtVal];
                const resRow = await client.query(upsertQuery, params);
                syncedRows.push(resRow.rows[0]);
            }

            await client.query('COMMIT');
            return res.status(200).json({ success: true, schemaUsed: cleanSchema, syncedCount: syncedRows.length, rows: syncedRows });

        } else {
            const activeId = finalId || `debt_${Date.now()}`;
            const personName = d.personName || d.person_name || d.person_Name || 'غير محدد';
            const title = d.title || d.notes || personName || 'دين جديد';
            const type = d.type || 'owed_to_me';
            const phone = d.phone || d.personPhone || d.person_phone || null;
            const amount = parseFloat(d.amount) || 0;
            const currency = d.currency || 'DZD';
            const notes = d.notes || null;
            const status = d.status || 'pending';
            const isScheduled = d.isScheduled !== undefined ? d.isScheduled : (d.is_scheduled || false);
            const scheduleType = d.scheduleType || d.schedule_type || null;
            const installmentsCount = parseInt(d.installmentsCount) || parseInt(d.installments_count) || 0;

            const dueDate = cleanDate(d.dueDate || d.due_date);
            const firstPaymentDate = cleanDate(d.firstPaymentDate || d.first_payment_date);
            const createdAtVal = cleanDate(d.createdAt || d.created_at) || new Date().toISOString();

            const params = [activeId, userId, title, type, personName, phone, amount, currency, dueDate, notes, status, isScheduled, scheduleType, installmentsCount, firstPaymentDate, createdAtVal];
            const result = await client.query(upsertQuery, params);

            return res.status(200).json({ 
                success: true, 
                schemaUsed: cleanSchema, 
                rows: result.rows, 
                debt: result.rows[0] || null
            });
        }

    } catch (error) {
        if (action === 'SYNC' || action === 'SYNC_BATCH') {
            await client.query('ROLLBACK').catch(() => {});
        }
        console.error(`[DATABASE ERROR]:`, error);
        return res.status(500).json({ success: false, error: error.message });
    } finally {
        await client.end().catch(err => console.error('Error closing client:', err));
    }
}
