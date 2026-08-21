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
    const separator = baseConnectionString.includes('?') ? '&' : '?';
    const finalConnectionString = `${baseConnectionString}${separator}sslmode=verify-full`;

    const client = new pg.Client({
        connectionString: finalConnectionString,
        ssl: { rejectUnauthorized: false }
    });

    // 3. استقبال البيانات والـ Action
    const { action, id, debtId, debtData, debt, updates, companyName, company_name } = req.body;
    let targetSchema = req.headers['x-tenant-schema'];

    // التقاط كائن البيانات الصحيح بمرونة عالية
    const d = debtData || debt || updates || req.body.data || req.body || {}; 
    const finalId = id || debtId || d.id;
    
    // التقاط اسم الشركة القادم من البودي بشكل مرن
    const finalCompanyName = companyName || company_name || d.companyName || d.company_name;

    // 💡 الإصلاح الجوهري: نعتمد حصراً على اسم الشركة لتحديد السكيمّا وليس على الـ userId
    if (!targetSchema || targetSchema.trim() === '') {
        if (finalCompanyName) {
            targetSchema = `schema_${finalCompanyName.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase()}`;
        } else {
            return res.status(400).json({ 
                success: false, 
                error: 'اسم الشركة مطلوب لتحديد السكيمّا المستهدفة لحفظ البيانات.' 
            });
        }
    }

    try {
        await client.connect();
        
        // 4. معالجة وتفعيل السكيمّا الخاصة بالشركة المستهدفة حصراً
        const cleanSchema = targetSchema.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
        
        // نستخدم الميزة لفتح السكيمّا الحالية وضبط المسار إليها مباشرة دون تشتت البيانات
        await client.query(`CREATE SCHEMA IF NOT EXISTS "${cleanSchema}"`);
        await client.query(`SET search_path TO "${cleanSchema}"`);
        
        // تأكيد إنشاء الجدول بداخل السكيمّا الخاصة بالشركة قبل تنفيذ أي استعلام
        await client.query(`
            CREATE TABLE IF NOT EXISTS debts (
                id TEXT PRIMARY KEY,
                type TEXT NOT NULL,
                person_name TEXT NOT NULL,
                phone TEXT,
                amount NUMERIC NOT NULL,
                currency TEXT,
                due_date DATE,
                notes TEXT,
                status TEXT,
                is_scheduled BOOLEAN,
                schedule_type TEXT,
                installments_count INT,
                first_payment_date DATE
            );
        `);

        let query = '';
        let params = [];

        if (action === 'ADD' || action === 'INSERT' || action === 'UPDATE') {
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

            if (action === 'ADD' || action === 'INSERT') {
                query = `
                    INSERT INTO debts (
                        id, type, person_name, phone, amount, currency, due_date, 
                        notes, status, is_scheduled, schedule_type, installments_count, first_payment_date
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                    RETURNING *;
                `;
                params = [activeId, type, personName, phone, amount, currency, dueDate, notes, status, isScheduled, scheduleType, installmentsCount, firstPaymentDate];
            } else {
                query = `
                    UPDATE debts SET 
                        type = $2, person_name = $3, phone = $4, amount = $5, currency = $6, due_date = $7, 
                        notes = $8, status = $9, is_scheduled = $10, schedule_type = $11, installments_count = $12, first_payment_date = $13
                    WHERE id = $1
                    RETURNING *;
                `;
                params = [activeId, type, personName, phone, amount, currency, dueDate, notes, status, isScheduled, scheduleType, installmentsCount, firstPaymentDate];
            }

        } else if (action === 'DELETE') {
            if (!finalId) return res.status(400).json({ success: false, error: 'المعرف id مطلوب' });
            query = `DELETE FROM debts WHERE id = $1 RETURNING *;`;
            params = [finalId];
        } else {
            return res.status(400).json({ success: false, error: 'العملية غير مدعومة' });
        }

        const result = await client.query(query, params);
        return res.status(200).json({ success: true, rows: result.rows, rowCount: result.rowCount });

    } catch (error) {
        console.error(`[DATABASE ERROR ON ${action}]:`, error);
        return res.status(500).json({ success: false, error: error.message });
    } finally {
        await client.end().catch(err => console.error('Error closing client:', err));
    }
}
