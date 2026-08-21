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

    // 3. الاستعلام من public.app_users لمطابقة جدول إنشاء الحساب
    const userId = body.userId || body.user_id || d.userId || d.user_id || req.headers['x-user-id'] || req.headers['user-id'];
    if (userId) {
        try {
            const dbRes = await client.query(
                `SELECT company_name FROM public.app_users WHERE id::text = $1 LIMIT 1;`,
                [String(userId)]
            );
            if (dbRes.rows.length > 0 && dbRes.rows[0].company_name) {
                return sanitizeSchema(dbRes.rows[0].company_name, userId);
            }
        } catch (e) {
            console.warn('[SCHEMA RESOLUTION DB FALLBACK ERROR]:', e.message);
        }
    }

    return null;
}

function sanitizeSchema(rawName, fallbackUserId = null) {
    const strVal = typeof rawName === 'object' ? JSON.stringify(rawName) : String(rawName);
    const clean = strVal.trim().replace(/^usr_/, '').replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
    
    if (!clean) {
        if (fallbackUserId) {
            return `schema_user_${fallbackUserId.toString().replace('usr_', '')}`;
        }
        return null;
    }
    return clean.startsWith('schema_') ? clean : `schema_${clean}`;
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
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

    const queryParams = req.query || {};
    const d = body.debtData || body.debt || body.updates || body.data || body;

    // استخراج الـ ID أو اسم الشخص بكل المرونات الممكنة
    const targetId = String(body.id || body.debtId || body._id || d.id || d.debtId || d._id || queryParams.id || '').trim();
    const targetName = String(body.personName || body.person_name || body.name || d.personName || d.person_name || queryParams.personName || '').trim();

    if (!targetId && !targetName) {
        return res.status(400).json({
            success: false,
            error: 'يرجى إرسال id أو personName المُراد حذفه.'
        });
    }

    try {
        await client.connect();

        // مطابقة طريقة استخراج السكيمّا تماماً مع كود الحفظ
        const cleanSchema = await resolveSchemaName(client, req, body);

        if (!cleanSchema) {
            return res.status(400).json({ 
                success: false, 
                error: 'تعذر تحديد اسم الشركة أو السكيمّا الخاصة بالمستخدم.',
                debugReceivedData: { headers: req.headers, bodyKeys: Object.keys(body) }
            });
        }

        // ضبط المسار على السكيمّا المطلوبة
        await client.query(`CREATE SCHEMA IF NOT EXISTS "${cleanSchema}";`);
        await client.query(`SET search_path TO "${cleanSchema}", public;`);

        let deleteQuery = '';
        let params = [];

        if (targetId) {
            deleteQuery = `DELETE FROM debts WHERE id::text = $1 OR id::text LIKE $2 RETURNING *;`;
            params = [targetId, `%${targetId}%`];
        } else {
            deleteQuery = `DELETE FROM debts WHERE LOWER(TRIM(person_name)) = LOWER(TRIM($1)) RETURNING *;`;
            params = [targetName];
        }

        const result = await client.query(deleteQuery, params);

        if (result.rowCount === 0) {
            return res.status(404).json({
                success: false,
                message: `لم يتم العثور على العنصر بـ (${targetId || targetName}) في السكيمّا (${cleanSchema}).`,
                schemaUsed: cleanSchema
            });
        }

        return res.status(200).json({
            success: true,
            message: 'تم الحذف بنجاح من قاعدة البيانات',
            schemaUsed: cleanSchema,
            deletedCount: result.rowCount,
            rows: result.rows
        });

    } catch (error) {
        console.error(`[DATABASE DELETE ERROR]:`, error);
        return res.status(500).json({ success: false, error: error.message });
    } finally {
        await client.end().catch(err => console.error('Error closing client:', err));
    }
}
