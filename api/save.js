import pg from 'pg';

export default async function handler(req, res) {
    // 1. إعدادات CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-tenant-schema'
    );

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    // 2. إعداد الاتصال بقاعدة البيانات Neon
    const baseConnectionString = process.env.DATABASE_URL;
    if (!baseConnectionString) {
        return res.status(500).json({ success: false, error: 'DATABASE_URL غير معرفة في بيئة Vercel' });
    }

    const separator = baseConnectionString.includes('?') ? '&' : '?';
    const finalConnectionString = `${baseConnectionString}${separator}sslmode=verify-full`;

    const client = new pg.Client({
        connectionString: finalConnectionString,
        ssl: { rejectUnauthorized: false }
    });

    // 3. تفكيك البيانات المرئية بدقة
    const body = req.body || {};
    const d = body.debtData || body.debt || body.updates || body.data || body;
    
    const action = (body.action || d.action || 'SAVE').toUpperCase();
    const finalId = body.id || body.debtId || d.id || d._id;
    
    // التقاط المعرفات بدقة عالية
    const company = body.companyName || body.company_name || body.company || d.companyName || d.company_name || d.company;
    const userId = body.userId || body.user_id || d.userId || d.user_id;
    
    let targetSchema = req.headers['x-tenant-schema'];

    // 4. إجبار السكيمّا الحقيقية بناءً على الشركة أو المستخدم (ويرفض الحفظ الافتراضي تماماً)
    if (!targetSchema || targetSchema.trim() === '') {
        if (company && company.toString().trim() !== '') {
            targetSchema = `schema_${company.toString().trim().replace(/[^a-zA-Z0-9_]/g, '').toLowerCase()}`;
        } else if (userId && userId.toString().trim() !== '') {
            targetSchema = `user_${userId.toString().trim().replace(/[^a-zA-Z0-9_]/g, '').toLowerCase()}`;
        } else {
            // إيقاف العملية ومنع الحفظ في مكان عشوائي إذا لم تتوفر هوية الحساب
            return res.status(400).json({ 
                success: false, 
                error: 'تعذر تحديد السكيمّا المستهدفة! يرجى إرسال companyName أو userId مع الطلب.' 
            });
        }
    }

    // تنظيف اسم السكيمّا لمنع SQL Injection
    const cleanSchema = targetSchema.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();

    try {
        await client.connect();

        // 5. إنشاء وتفعيل السكيمّا الصحيحة فوراً
        await client.query(`CREATE SCHEMA IF NOT EXISTS "${cleanSchema}";`);
        await client.query(`SET search_path TO "${cleanSchema}";`);

        // إنشاء جدول الديون داخل هذه السكيمّا تحديداً
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

        let query = '';
        let params = [];

        // 6. تنفيذ العمليات بحسب الـ Action
        if (['ADD', 'INSERT', 'UPDATE', 'ADD_DEBT', 'UPDATE_DEBT', 'SAVE_DATA', 'SAVE'].includes(action)) {
            const activeId = finalId || `debt_${Date.now()}`;
            const type = d.type || 'owed_to_me';
            const personName = d.personName || d.person_name || 'غير محدد';
            const phone = d.phone || d.personPhone || null;
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

            // دمج الإضافة والتحديث بطريقة أمنة عبر UPSERT (ON CONFLICT)
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
                return res.status(400).json({ success: false, error: 'مطلوب معرف الدين (id) لإتمام الحذف.' });
            }
            query = `DELETE FROM debts WHERE id = $1 RETURNING *;`;
            params = [finalId];

        } else if (['GET', 'GET_DATA', 'FETCH'].includes(action)) {
            query = `SELECT * FROM debts ORDER BY created_at DESC;`;
            params = [];

        } else {
            return res.status(400).json({ success: false, error: `العملية ${action} غير مدعومة.` });
        }

        const result = await client.query(query, params);

        return res.status(200).json({
            success: true,
            schemaUsed: cleanSchema,
            rowCount: result.rowCount,
            debt: result.rows[0] || null,
            debts: result.rows
        });

    } catch (error) {
        console.error(`[DATABASE ERROR IN SCHEMA ${cleanSchema}]:`, error);
        return res.status(500).json({ success: false, error: error.message });
    } finally {
        await client.end().catch(err => console.error('Error closing client connection:', err));
    }
}
