import pg from 'pg';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-tenant-schema'
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

    const d = body.debtData || body.debt || body.updates || body.data || body;
    const rawAction = body.action || d.action || 'SAVE';
    const action = rawAction.toString().toUpperCase().trim();

    const finalId = body.id || body.debtId || d.id || d._id;
    const userId = body.userId || body.user_id || d.userId || d.user_id || req.headers['x-user-id'] || null;
    const finalCompanyName = body.companyName || body.company_name || body.company || d.companyName || d.company_name || d.company;

    let targetSchema = req.headers['x-tenant-schema'];

    if (!targetSchema || targetSchema.trim() === '') {
        if (finalCompanyName && finalCompanyName.toString().trim() !== '') {
            const cleanComp = finalCompanyName.toString().trim().replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
            targetSchema = cleanComp ? `schema_${cleanComp}` : null;
        }
        if (!targetSchema && userId) {
            const cleanUser = userId.toString().trim().replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
            targetSchema = `user_${cleanUser}`;
        }
        if (!targetSchema) targetSchema = 'schema_default';
    }

    const cleanSchema = targetSchema.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();

    try {
        await client.connect();
        
        await client.query(`CREATE SCHEMA IF NOT EXISTS "${cleanSchema}";`);
        await client.query(`SET search_path TO "${cleanSchema}";`);
        
        await client.query(`
            CREATE TABLE IF NOT EXISTS debts (
                id TEXT PRIMARY KEY,
                user_id TEXT,
                title TEXT,
                type TEXT NOT NULL,
                person_name TEXT NOT NULL,
                phone TEXT,
                person_phone TEXT,
                amount NUMERIC NOT NULL,
                currency TEXT DEFAULT 'DZD',
                due_date DATE,
                notes TEXT,
                status TEXT DEFAULT 'pending',
                is_scheduled BOOLEAN DEFAULT FALSE,
                schedule_type TEXT,
                installments_count INT DEFAULT 0,
                first_payment_date DATE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 💡 التعديلات التلقائية: للتأكد من وجود جميع الأعمدة المطلوبة في الجداول المجهزة سابقاً
        await client.query(`ALTER TABLE debts ADD COLUMN IF NOT EXISTS phone TEXT;`);
        await client.query(`ALTER TABLE debts ADD COLUMN IF NOT EXISTS person_phone TEXT;`);
        await client.query(`ALTER TABLE debts ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`);
        await client.query(`ALTER TABLE debts ALTER COLUMN created_at DROP NOT NULL;`);
        await client.query(`ALTER TABLE debts ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP;`);
        
        await client.query(`ALTER TABLE debts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`);
        await client.query(`ALTER TABLE debts ALTER COLUMN updated_at DROP NOT NULL;`);

        await client.query(`ALTER TABLE debts ADD COLUMN IF NOT EXISTS title TEXT;`);
        await client.query(`ALTER TABLE debts ALTER COLUMN title DROP NOT NULL;`);

        await client.query(`ALTER TABLE debts ADD COLUMN IF NOT EXISTS user_id TEXT;`);
        await client.query(`ALTER TABLE debts ALTER COLUMN user_id DROP NOT NULL;`);

        let query = '';
        let params = [];

        const isSaveAction = ['SAVE', 'ADD', 'INSERT', 'UPDATE', 'ADD_DEBT', 'UPDATE_DEBT', 'SAVE_DATA', 'INIT_SCHEMA'].includes(action);

        if (isSaveAction) {
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

            // 💡 الحفظ في العمادين (phone و person_phone) للتوثيق والتوافق
            query = `
                INSERT INTO debts (
                    id, user_id, title, type, person_name, phone, person_phone, amount, currency, due_date, 
                    notes, status, is_scheduled, schedule_type, installments_count, first_payment_date, created_at, updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, CURRENT_TIMESTAMP)
                ON CONFLICT (id) DO UPDATE SET
                    user_id = COALESCE(EXCLUDED.user_id, debts.user_id),
                    title = COALESCE(EXCLUDED.title, debts.title),
                    type = EXCLUDED.type,
                    person_name = EXCLUDED.person_name,
                    phone = EXCLUDED.phone,
                    person_phone = EXCLUDED.person_phone,
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

        } else if (['DELETE', 'DELETE_DEBT', 'DELETE_DATA'].includes(action)) {
            if (!finalId) return res.status(400).json({ success: false, error: 'المعرف (id) مطلوب' });
            query = `DELETE FROM debts WHERE id = $1 RETURNING *;`;
            params = [finalId];

        } else if (['GET', 'GET_DATA', 'FETCH'].includes(action)) {
            query = `SELECT * FROM debts ORDER BY created_at DESC;`;
            params = [];

        } else {
            return res.status(400).json({ success: false, error: `العملية (${action}) غير مدعومة` });
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
        console.error(`[DATABASE ERROR ON ${action}]:`, error);
        return res.status(500).json({ success: false, error: error.message });
    } finally {
        await client.end().catch(err => console.error('Error closing client:', err));
    }
}
