import pg from 'pg';

/**
 * مطابقة دالة استخراج وتنظيف السكيمّا مع كود إنشاء الحساب حرفياً
 */
function buildSchemaName(companyName, userId) {
    if (companyName) {
        const strVal = typeof companyName === 'object' ? JSON.stringify(companyName) : String(companyName);
        
        // إذا كان الاسم يبدأ بـ schema_ جاهز
        if (strVal.trim().startsWith('schema_')) {
            return strVal.trim();
        }

        const sanitized = strVal.trim().replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
        if (sanitized) {
            return `schema_${sanitized}`;
        }
    }

    // الـ Fallback في حال كان اسم الشركة بالعربية أو رموز فقط
    if (userId) {
        const cleanUserId = String(userId).replace('usr_', '');
        return `schema_user_${cleanUserId}`;
    }

    return null;
}

async function resolveSchemaName(client, req, body, queryParams) {
    // 1. الفحص من الـ Headers
    const headerSchema = req.headers['x-tenant-schema'] || req.headers['x-company-name'] || req.headers['tenant'];
    const userId = body.userId || body.user_id || queryParams.userId || req.headers['x-user-id'] || req.headers['user-id'];

    if (headerSchema && headerSchema.trim() !== '') {
        return buildSchemaName(headerSchema, userId);
    }

    // 2. الفحص من الـ Body والـ Query Params
    const d = body.debtData || body.debt || body.updates || body.data || body;
    const userObj = body.user || d.user || {};
    const companyObj = body.company || d.company || {};

    const rawCompany = 
        body.companyName || body.company_name || body.companyId || body.company_id ||
        d.companyName || d.company_name || d.companyId || d.company_id ||
        queryParams.companyName || queryParams.company_name || queryParams.schemaName ||
        userObj.companyName || userObj.company_name || userObj.company ||
        companyObj.name || companyObj.companyName || companyObj.id;

    if (rawCompany) {
        return buildSchemaName(rawCompany, userId);
    }

    // 3. الاستعلام المباشر من جدول public.app_users لاستخراج الشركة الأصلية
    if (userId) {
        try {
            const dbRes = await client.query(
                `SELECT company_name FROM public.app_users WHERE id::text = $1 LIMIT 1;`,
                [String(userId)]
            );
            if (dbRes.rows.length > 0 && dbRes.rows[0].company_name) {
                return buildSchemaName(dbRes.rows[0].company_name, userId);
            }
        } catch (e) {
            console.warn('[SCHEMA RESOLUTION DB ERROR]:', e.message);
        }
    }

    // 4. إذا أُرسل userId فقط ولم نجد شركة، نعتمد سكيمّا المستخدم
    if (userId) {
        return buildSchemaName(null, userId);
    }

    return null;
}

export default async function handler(req, res) {
    // إعدادات CORS
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,DELETE');
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

    // استخراج معرّف الدين (id) أو اسم الشخص (personName)
    const targetId = String(body.id || body.debtId || body._id || d.id || d.debtId || d._id || queryParams.id || '').trim();
    const targetName = String(body.personName || body.person_name || body.name || d.personName || d.person_name || queryParams.personName || '').trim();

    if (!targetId && !targetName) {
        return res.status(400).json({
            success: false,
            error: 'يرجى إرسال المعرف (id) أو اسم الشخص (personName) المُراد حذفه.'
        });
    }

    try {
        await client.connect();

        // تحديد اسم السكيمّا بدقة
        const schemaName = await resolveSchemaName(client, req, body, queryParams);

        if (!schemaName) {
            return res.status(400).json({ 
                success: false, 
                error: 'تعذر تحديد السكيمّا الخاصة بالحساب. يرجى إرسال companyName أو userId.',
                debugData: { headers: req.headers, bodyKeys: Object.keys(body), queryParams }
            });
        }

        // ضبط المسار على السكيمّا المحددة
        await client.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}";`);
        await client.query(`SET search_path TO "${schemaName}", public;`);

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
                message: `لم يتم العثور على الدين المراد حذفه في السكيمّا (${schemaName}).`,
                searchedFor: { id: targetId, personName: targetName },
                schemaNameUsed: schemaName
            });
        }

        return res.status(200).json({
            success: true,
            message: 'تم حذف الدين بنجاح من قاعدة البيانات',
            schemaNameUsed: schemaName,
            deletedCount: result.rowCount,
            deletedRows: result.rows
        });

    } catch (error) {
        console.error('[DELETE API ERROR]:', error);
        return res.status(500).json({ success: false, error: error.message });
    } finally {
        await client.end().catch(err => console.error('Error closing client:', err));
    }
}
