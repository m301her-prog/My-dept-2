import pg from 'pg';

// 💡 دالة استخراج وتنظيف اسم الشركة / السكيمّا من جميع أجزاء Request الواجهة
function extractSchemaName(req, body) {
    // 1. الفحص من الـ Headers المباشرة
    const headerSchema = req.headers['x-tenant-schema'] || req.headers['x-company-name'] || req.headers['tenant'];
    if (headerSchema && headerSchema.trim() !== '') {
        return headerSchema;
    }

    // 2. البحث داخل body والـ nested objects التي ترسلها الواجهة
    const d = body.debtData || body.debt || body.updates || body.data || body;
    const userObj = body.user || d.user || {};
    const companyObj = body.company || d.company || {};

    const rawCompany = 
        body.companyName || body.company_name || body.companyId || body.company_id ||
        d.companyName || d.company_name || d.companyId || d.company_id ||
        userObj.companyName || userObj.company_name || userObj.company ||
        companyObj.name || companyObj.companyName || companyObj.id ||
        req.headers['x-user-id'] || body.userId || body.user_id || d.userId || d.user_id;

    if (!rawCompany) return null;

    // تنظيف الاسم وتحويله إلى صيغة schema_companyname
    const strVal = typeof rawCompany === 'object' ? JSON.stringify(rawCompany) : String(rawCompany);
    const cleanCompany = strVal.trim().replace(/^usr_/, '').replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();

    if (!cleanCompany) return null;

    return cleanCompany.startsWith('schema_') ? cleanCompany : `schema_${cleanCompany}`;
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

    // 💡 استخراج السكيمّا المباشرة باستخدام الدالة الجديدة
    const rawSchema = extractSchemaName(req, body);

    if (!rawSchema) {
        return res.status(400).json({ 
            success: false, 
            error: 'لم يتم العثور على اسم الشركة أو السكيمّا في الطلب.',
            debugReceivedData: {
                headers: req.headers,
                bodyKeys: Object.keys(body)
            }
        });
    }

    const cleanSchema = rawSchema.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();

    const d = body.debtData || body.debt || body.updates || body.data || body;
    const rawAction = body.action || d.action || 'SAVE';
    const action = rawAction.toString().toUpperCase().trim();

    const finalId = body.id || body.debtId || body._id || d.id || d.debtId || d._id || null;
    const userId = body.userId || body.user_id || d.userId || d.user_id || req.headers['x-user-id'] || null;

    try {
        await client.connect();

        // 💡 التوجيه للسكيمّا المستخرجة فقط
        await client.query(`SET search_path TO "${cleanSchema}";`);

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
        console.error(`[DATABASE ERROR ON ${action}]:`, error);
        return res.status(500).json({ success: false, error: error.message });
    } finally {
        await client.end().catch(err => console.error('Error closing client:', err));
    }
}
