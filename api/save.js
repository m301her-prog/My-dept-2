import pg from 'pg';

export default async function handler(req, res) {
    // إعدادات CORS
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

    try {
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

        // 1. تحديد اسم الـ Schema بنفس طريقة كود التسجيل
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

        await client.connect();

        // 2. التبديل إلى الـ Schema المستهدفة
        await client.query(`CREATE SCHEMA IF NOT EXISTS "${cleanSchema}";`);
        await client.query(`SET search_path TO "${cleanSchema}";`);

        // 3. التأكد من وجود الجدول بنفس هيكلية كود التسجيل بالضبط
        await client.query(`
            CREATE TABLE IF NOT EXISTS debts (
                id TEXT PRIMARY KEY,
                type TEXT NOT NULL,
                person_name TEXT NOT NULL,
                phone TEXT,
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

        // 4. ترقية الجداول القديمة تلقائياً لتفادي أخطاء الأعمدة المفقودة
        await client.query(`ALTER TABLE debts ADD COLUMN IF NOT EXISTS phone TEXT;`);
        await client.query(`ALTER TABLE debts ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'DZD';`);
        await client.query(`ALTER TABLE debts ADD COLUMN IF NOT EXISTS due_date DATE;`);
        await client.query(`ALTER TABLE debts ADD COLUMN IF NOT EXISTS notes TEXT;`);
        await client.query(`ALTER TABLE debts ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';`);
        await client.query(`ALTER TABLE debts ADD COLUMN IF NOT EXISTS is_scheduled BOOLEAN DEFAULT FALSE;`);
        await client.query(`ALTER TABLE debts ADD COLUMN IF NOT EXISTS schedule_type TEXT;`);
        await client.query(`ALTER TABLE debts ADD COLUMN IF NOT EXISTS installments_count INT DEFAULT 0;`);
        await client.query(`ALTER TABLE debts ADD COLUMN IF NOT EXISTS first_payment_date DATE;`);
        await client.query(`ALTER TABLE debts ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`);
        await client.query(`ALTER TABLE debts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`);

        let query = '';
        let params = [];

        const isSaveAction = ['SAVE', 'ADD', 'INSERT', 'UPDATE', 'ADD_DEBT', 'UPDATE_DEBT', 'SAVE_DATA'].includes(action);

        if (isSaveAction) {
            const activeId = finalId || `debt_${Date.now()}`;
            const personName = d.personName || d.person_name || d.person_Name || 'غير محدد';
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

            // استعلام الإدخال / التحديث المطابق للجدول
            query = `
                INSERT INTO debts (
                    id, type, person_name, phone, amount, currency, due_date, 
                    notes, status, is_scheduled, schedule_type, installments_count, first_payment_date, updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP)
                ON CONFLICT (id) DO UPDATE SET
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

            params = [
                activeId, type, personName, phone, amount, currency, 
                dueDate, notes, status, isScheduled, scheduleType, 
                installmentsCount, firstPaymentDate
            ];

        } else if (['DELETE', 'DELETE_DEBT', 'DELETE_DATA'].includes(action)) {
            if (!finalId) return res.status(400).json({ success: false, error: 'المعرف (id) مطلوب لعملية الحذف' });
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
        console.error(`[DATABASE ERROR ON SAVE]:`, error);
        return res.status(500).json({ success: false, error: error.message });
    } finally {
        await client.end().catch(err => console.error('Error closing client:', err));
    }
}
