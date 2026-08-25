import pg from 'pg';

// 1. استخدام Pool عالمي لإعادة استخدام الاتصالات وتحمل الضغط العالي
const baseConnectionString = process.env.DATABASE_URL;
let pool;

if (baseConnectionString) {
    const separator = baseConnectionString.includes('?') ? '&' : '?';
    const finalConnectionString = `${baseConnectionString}${separator}sslmode=verify-full`;

    pool = new pg.Pool({
        connectionString: finalConnectionString,
        ssl: { rejectUnauthorized: false },
        max: 20,                  // أقصى عدد اتصالات بالطلب الواضح
        idleTimeoutMillis: 30000, // إغلاق الاتصال الخامل بعد 30 ثانية
        connectionTimeoutMillis: 5000 // المهلة الزمنية للاتصال
    });
}

export default async function handler(req, res) {
    // إعدادات CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-tenant-schema, x-user-id'
    );

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    if (!pool) {
        return res.status(500).json({ success: false, error: 'DATABASE_URL غير معرف في متغيرات البيئة' });
    }

    // اقتطاع اتصال من الـ Pool
    const client = await pool.connect();

    try {
        let body = req.body || {};
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (e) {}
        }

        const d = body.debtData || body.debt || body.updates || body.data || body;
        const rawAction = body.action || d.action || 'SAVE';
        const action = rawAction.toString().toUpperCase().trim();

        // 2. استخراج الحقول وتوفير قيم افتراضية منعاً لـ NOT NULL Violations
        const finalId = body.id || body.debtId || d.id || d._id || `debt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        
        let userId = body.userId || body.user_id || d.userId || d.user_id || req.headers['x-user-id'] || null;
        const finalCompanyName = body.companyName || body.company_name || body.company || d.companyName || d.company_name || d.company;

        // 3. تحديد وعزل السكيمّا (Schema Isolation)
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

        // توفير قيمة fallback لـ userId إذا لم يرسل صراحةً
        if (!userId || userId.toString().trim() === '') {
            userId = cleanSchema;
        }

        // إعداد السكيمّا المستهدفة
        await client.query(`CREATE SCHEMA IF NOT EXISTS "${cleanSchema}";`);
        await client.query(`SET search_path TO "${cleanSchema}";`);

        let query = '';
        let params = [];

        const isSaveAction = ['SAVE', 'ADD', 'INSERT', 'UPDATE', 'ADD_DEBT', 'UPDATE_DEBT', 'SAVE_DATA'].includes(action);

        if (isSaveAction) {
            // معالجة ومطابقة كافة الحقول بناءً على تعريف جدول PostgreSQL لديك
            const personName = (d.personName || d.person_name || d.person_Name || 'غير محدد').toString().trim();
            const title = (d.title || d.notes || `دين: ${personName}`).toString().trim();
            const amount = parseFloat(d.amount) || 0.00;
            const type = (d.type || 'owed_to_me').toString().trim();
            const personPhone = d.personPhone || d.person_phone || d.phone || null;
            const dueDate = d.dueDate || d.due_date || null;
            const status = d.status || 'pending';
            const notes = d.notes || null;
            const createdAt = d.createdAt || d.created_at || new Date().toISOString();

            // استخراج وإعداد حقول الجدولة والعملة وحركة الدفعات
            const currency = d.currency || 'DZD';
            const isScheduled = d.isScheduled !== undefined ? d.isScheduled : (d.is_scheduled !== undefined ? d.is_scheduled : false);
            const scheduleType = d.scheduleType || d.schedule_type || null;
            const installmentsCount = parseInt(d.installmentsCount || d.installments_count) || 0;
            const firstPaymentDate = d.firstPaymentDate || d.first_payment_date || null;
            
            const scheduleDataRaw = d.scheduleData || d.schedule_data || null;
            const scheduleData = scheduleDataRaw ? JSON.stringify(scheduleDataRaw) : null;
            
            const paymentsListRaw = d.paymentsList || d.payments_list || null;
            const paymentsList = paymentsListRaw ? JSON.stringify(paymentsListRaw) : null;

            // query الإدخال المباشر للجدول مع دعم الجدولة
            query = `
                INSERT INTO debts (
                    id, user_id, title, amount, type, person_name, person_phone, due_date, status, notes, created_at,
                    currency, is_scheduled, schedule_type, installments_count, first_payment_date, schedule_data, payments_list
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
                ON CONFLICT (id) DO UPDATE SET
                    user_id = EXCLUDED.user_id,
                    title = EXCLUDED.title,
                    amount = EXCLUDED.amount,
                    type = EXCLUDED.type,
                    person_name = EXCLUDED.person_name,
                    person_phone = EXCLUDED.person_phone,
                    due_date = EXCLUDED.due_date,
                    status = EXCLUDED.status,
                    notes = EXCLUDED.notes,
                    currency = EXCLUDED.currency,
                    is_scheduled = EXCLUDED.is_scheduled,
                    schedule_type = EXCLUDED.schedule_type,
                    installments_count = EXCLUDED.installments_count,
                    first_payment_date = EXCLUDED.first_payment_date,
                    schedule_data = EXCLUDED.schedule_data,
                    payments_list = EXCLUDED.payments_list
                RETURNING *;
            `;

            params = [
                finalId,
                userId,
                title,
                amount,
                type,
                personName,
                personPhone,
                dueDate,
                status,
                notes,
                createdAt,
                currency,
                isScheduled,
                scheduleType,
                installmentsCount,
                firstPaymentDate,
                scheduleData,
                paymentsList
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
        // إرجاع الاتصال إلى Pool
        client.release();
    }
}
