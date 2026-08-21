import pg from 'pg';

export default async function handler(req, res) {
    // 1. إعدادات CORS الكاملة
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-tenant-schema'
    );

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    // 2. ضبط الاتصال بـ Postgres (Neon)
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

    // 3. تحليل البودي والبيانات بمرونة قصوى
    let body = req.body || {};
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e) {}
    }

    const d = body.debtData || body.debt || body.updates || body.data || body;
    
    // التقاط اسم العملية بمرونة وتحويلها للأحرف الكبيرة
    const rawAction = body.action || d.action || 'SAVE';
    const action = rawAction.toString().toUpperCase().trim();

    const finalId = body.id || body.debtId || d.id || d._id;
    const userId = body.userId || body.user_id || d.userId || d.user_id;
    const finalCompanyName = body.companyName || body.company_name || body.company || d.companyName || d.company_name || d.company;

    let targetSchema = req.headers['x-tenant-schema'];

    // 4. تحديد اسم السكيمّا تلقائياً بمرونة
    if (!targetSchema || targetSchema.trim() === '') {
        if (finalCompanyName && finalCompanyName.toString().trim() !== '') {
            const cleanComp = finalCompanyName.toString().trim().replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
            targetSchema = cleanComp ? `schema_${cleanComp}` : null;
        }
        
        // بديل آخر في حال كانت تسمية الشركة بالعربية فقط أو غير موجودة
        if (!targetSchema && userId) {
            const cleanUser = userId.toString().trim().replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
            targetSchema = `user_${cleanUser}`;
        }
        
        // fallback افتراضي لمنع خطأ 400 وتوقف النظام
        if (!targetSchema) {
            targetSchema = 'schema_default';
        }
    }

    const cleanSchema = targetSchema.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();

    try {
        await client.connect();
        
        // 5. تفعيل وإنشاء السكيمّا
        await client.query(`CREATE SCHEMA IF NOT EXISTS "${cleanSchema}";`);
        await client.query(`SET search_path TO "${cleanSchema}";`);
        
        // إنشـاء الجدول تلقائياً إن لم يكن موجوداً
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

        // تحديث الهيكل تلقائياً للأعمدة القديمة
        await client.query(`
            ALTER TABLE debts ADD COLUMN IF NOT EXISTS phone TEXT;
            ALTER TABLE debts ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'DZD';
            ALTER TABLE debts ADD COLUMN IF NOT EXISTS notes TEXT;
            ALTER TABLE debts ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
            ALTER TABLE debts ADD COLUMN IF NOT EXISTS is_scheduled BOOLEAN DEFAULT FALSE;
            ALTER TABLE debts ADD COLUMN IF NOT EXISTS schedule_type TEXT;
            ALTER TABLE debts ADD COLUMN IF NOT EXISTS installments_count INT DEFAULT 0;
            ALTER TABLE debts ADD COLUMN IF NOT EXISTS first_payment_date DATE;
            ALTER TABLE debts ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
            ALTER TABLE debts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
        `);

        let query = '';
        let params = [];

        // 6. قبول جميع التسميات القادمة للعملية (ADD / SAVE / UPDATE / ADD_DEBT إلخ)
        const isSaveAction = ['SAVE', 'ADD', 'INSERT', 'UPDATE', 'ADD_DEBT', 'UPDATE_DEBT', 'SAVE_DATA', 'INIT_SCHEMA'].includes(action);

        if (isSaveAction) {
            const activeId = finalId || `debt_${Date.now()}`;
            const type = d.type || 'owed_to_me';
            const personName = d.personName || d.person_name || d.person_Name || 'غير محدد';
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

            // استعلام Upsert (حفظ أو تحديث تلقائي حسب ID)
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
            params = [activeId, type, personName, phone, amount, currency, dueDate, notes, status, isScheduled, scheduleType, installmentsCount, firstPaymentDate];

        } else if (['DELETE', 'DELETE_DEBT', 'DELETE_DATA'].includes(action)) {
            if (!finalId) {
                return res.status(400).json({ success: false, error: 'المعرف (id) مطلوب لإتمام عملية الحذف' });
            }
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
