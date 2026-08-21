import pg from 'pg';

async function resolveSchemaName(client, req, body) {
    // 1. الفحص المباشر من الـ Headers
    const headerSchema = req.headers['x-tenant-schema'] || req.headers['x-company-name'] || req.headers['tenant'];
    if (headerSchema && headerSchema.trim() !== '') {
        return sanitizeSchema(headerSchema);
    }

    // 2. الفحص من كائن الـ Body والـ Nested Objects
    const d = body.debtData || body.debt || body.updates || body.data || body;
    const userObj = body.user || d.user || {};
    const companyObj = body.company || d.company || {};

    const rawCompany = 
        body.companyName || body.company_name || body.companyId || body.company_id ||
        d.companyName || d.company_name || d.companyId || d.company_id ||
        userObj.companyName || userObj.company_name || userObj.company ||
        companyObj.name || companyObj.companyName || companyObj.id;

    if (rawCompany) {
        return sanitizeSchema(rawCompany);
    }

    // 3. الاستعلام من قاعدة البيانات لجلب اسم شركة آخر جلسة/مستخدم عبر userId
    const userId = body.userId || body.user_id || d.userId || d.user_id || req.headers['x-user-id'];
    if (userId) {
        try {
            const dbRes = await client.query(
                `SELECT company_name, company_id, company FROM public.users WHERE id = $1 OR user_id = $1 LIMIT 1;`,
                [userId]
            );
            if (dbRes.rows.length > 0) {
                const fetchedCompany = dbRes.rows[0].company_name || dbRes.rows[0].company_id || dbRes.rows[0].company;
                if (fetchedCompany) return sanitizeSchema(fetchedCompany);
            }
        } catch (e) {
            console.warn('[SCHEMA RESOLUTION DB FALLBACK ERROR]:', e.message);
        }
    }

    return null;
}

function sanitizeSchema(rawName) {
    const strVal = typeof rawName === 'object' ? JSON.stringify(rawName) : String(rawName);
    const clean = strVal.trim().replace(/^usr_/, '').replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
    if (!clean) return null;
    return clean.startsWith('schema_') ? clean : `schema_${clean}`;
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-tenant-schema, x-company-name, x-user-id'
    );

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

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
        try { body = JSON.parse(body); } catch (e) {}
    }

    try {
        await client.connect();

        // 💡 جلب السكيمّا تلقائياً بآلية الاستعلام الاحتياطي
        const cleanSchema = await resolveSchemaName(client, req, body);

        if (!cleanSchema) {
            return res.status(400).json({ 
                success: false, 
                error: 'تعذر تحديد اسم الشركة أو السكيمّا الخاصة بالمستخدم.',
                debugReceivedData: { headers: req.headers, bodyKeys: Object.keys(body) }
            });
        }

        const d = body.debtData || body.debt || body.updates || body.data || body;
        const rawAction = body.action || d.action || 'SAVE';
        const action = rawAction.toString().toUpperCase().trim();

        const finalId = body.id || body.debtId || body._id || d.id || d.debtId || d._id || null;
        const userId = body.userId || body.user_id || d.userId || d.user_id || req.headers['x-user-id'] || null;

        // 💡 1. إنشائها وتحديد مسار العمل
        await client.query(`CREATE SCHEMA IF NOT EXISTS "${cleanSchema}";`);
        await client.query(`SET search_path TO "${cleanSchema}", public;`);

        // 💡 2. إنشاء الهيكل وضمان وجود كافة الأعمدة للجدول الموجود مسبقاً
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

            ALTER TABLE debts ADD COLUMN IF NOT EXISTS phone TEXT;
            ALTER TABLE debts ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'DZD';
            ALTER TABLE debts ADD COLUMN IF NOT EXISTS is_scheduled BOOLEAN DEFAULT false;
            ALTER TABLE debts ADD COLUMN IF NOT EXISTS schedule_type VARCHAR(50);
            ALTER TABLE debts ADD COLUMN IF NOT EXISTS installments_count INT DEFAULT 0;
            ALTER TABLE debts ADD COLUMN IF NOT EXISTS first_payment_date TIMESTAMP;
        `);

        let query = '';
        let params = [];

        const isDeleteAction = ['DELETE', 'DELETE_DEBT', 'DELETE_DATA', 'REMOVE'].includes(action);
        const isFetchAction = ['GET', 'GET_DATA', 'FETCH', 'READ'].includes(action);

        if (isDeleteAction) {
            if (!finalId) {
                return res.status(400).json({ success: false, error: 'المعرف (id) مطلوب لإتمام عملية الحذف' });
            }
            query = `DELETE FROM debts WHERE id = $1 RETURNING *;`;
            params = [finalId];

        } else if (isFetchAction) {
            query = `SELECT * FROM debts ORDER BY created_at DESC;`;
            params = [];

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

            const cleanDate = (dateVal) => {
                if (!dateVal || dateVal.toString().trim() === '' || dateVal.toString().includes('Invalid')) return null;
                return dateVal;
            };
            const dueDate = cleanDate(d.dueDate || d.due_date);
            const firstPaymentDate = cleanDate(d.firstPaymentDate || d.first_payment_date);
            const createdAtVal = cleanDate(d.createdAt || d.created_at) || new Date().toISOString();

            query = `
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
            params = [activeId, userId, title, type, personName, phone, amount, currency, dueDate, notes, status, isScheduled, scheduleType, installmentsCount, firstPaymentDate, createdAtVal];
        }

        const result = await client.query(query, params);

        return res.status(200).json({ 
            success: true, 
            schemaUsed: cleanSchema, 
            rows: result.rows, 
            debt: result.rows[0] || null,
            rowCount: result.rowCount 
        });

    } catch (error) {
        console.error(`[DATABASE ERROR]:`, error);
        return res.status(500).json({ success: false, error: error.message });
    } finally {
        await client.end().catch(err => console.error('Error closing client:', err));
    }
}
