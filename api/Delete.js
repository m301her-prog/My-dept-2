import pg from 'pg';

/**
 * دالة تشخيصية لمعرفة السبب الدقيق لخطأ 404 عند فشل عملية الحذف
 */
async function diagnoseNotFoundReason(client, targetSchema, targetId, targetName) {
    const diagnostics = {
        schemaExists: false,
        tableExists: false,
        foundInOtherSchemas: [],
        totalRecordsInTable: 0,
        sampleRecords: [],
        possibleReason: ''
    };

    try {
        // 1. التحقق من وجود السكيمّا
        const schemaCheck = await client.query(
            `SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1`,
            [targetSchema]
        );
        diagnostics.schemaExists = schemaCheck.rows.length > 0;

        // 2. التحقق من وجود جدول debts داخل السكيمّا
        const tableCheck = await client.query(
            `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'debts'`,
            [targetSchema]
        );
        diagnostics.tableExists = tableCheck.rows.length > 0;

        if (!diagnostics.tableExists) {
            diagnostics.possibleReason = `الجدول debts غير موجود في السكيمّا (${targetSchema}).`;
            return diagnostics;
        }

        // 3. حساب عدد السجلات الكلي في الجدول المذكور
        const countRes = await client.query(`SELECT COUNT(*) FROM "${targetSchema}".debts`);
        diagnostics.totalRecordsInTable = parseInt(countRes.rows[0].count, 10);

        if (diagnostics.totalRecordsInTable === 0) {
            diagnostics.possibleReason = `الجدول debts في السكيمّا (${targetSchema}) فارغ تماماً لا يحتوي على أي بيانات.`;
        } else {
            // جلب عينة من أول 5 عناصر في الجدول لمعاينة الـ ID والأسماء المخزنة
            const sampleRes = await client.query(
                `SELECT id, person_name FROM "${targetSchema}".debts LIMIT 5`
            );
            diagnostics.sampleRecords = sampleRes.rows;
            diagnostics.possibleReason = `العنصر غير موجود في السكيمّا (${targetSchema}). يرجى التأكد من الـ ID أو الاسم المُرسل ومقارنته بالعينة المخزنة.`;
        }

        // 4. البحث عن العنصر في السكيمّا العامّة (public) للتحقق مما إذا كان مخزناً هناك
        if (targetId && targetSchema !== 'public') {
            const publicCheck = await client.query(
                `SELECT id FROM public.debts WHERE id::text = $1 LIMIT 1`,
                [targetId]
            ).catch(() => ({ rows: [] }));

            if (publicCheck.rows.length > 0) {
                diagnostics.foundInOtherSchemas.push('public');
                diagnostics.possibleReason = `العنصر موجود في السكيمّا (public) وليس في السكيمّا المستهدفة (${targetSchema}). يرجى التثبت من تحديد (companyName / userId).`;
            }
        }

    } catch (err) {
        diagnostics.diagnosticError = err.message;
    }

    return diagnostics;
}

/**
 * دالة لتنظيف وتنسيق اسم السكيمّا بدعم اللغة العربية والأرقام والرموز
 */
function normalizeSchemaName(inputName) {
    if (!inputName) return '';
    let name = String(inputName).trim();
    if (name.startsWith('schema_')) {
        name = name.replace(/^schema_/, '');
    }
    // تحويل المسافات والرموز المتروكة إلى _
    name = name.replace(/[\s\W]+/g, '_').toLowerCase();
    // إزالة الشُرَط المتروكة في بداية أو نهاية النص
    name = name.replace(/^_+|_+$/g, '');
    
    return name ? `schema_${name}` : '';
}

export default async function handler(request, response) {
    // 1. إعدادات CORS
    response.setHeader('Access-Control-Allow-Credentials', 'true');
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    response.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-tenant-schema, tenant, user-id'
    );

    if (request.method === 'OPTIONS') return response.status(200).end();

    if (request.method !== 'POST' && request.method !== 'DELETE') {
        return response.status(405).json({ success: false, error: 'Method Not Allowed' });
    }

    // 2. الاتصال بـ Neon Postgres
    const baseConnectionString = process.env.DATABASE_URL;
    if (!baseConnectionString) {
        return response.status(500).json({ success: false, error: 'DATABASE_URL غير معرف' });
    }

    const separator = baseConnectionString.includes('?') ? '&' : '?';
    const finalConnectionString = `${baseConnectionString}${separator}sslmode=verify-full`;

    const client = new pg.Client({
        connectionString: finalConnectionString,
        ssl: { rejectUnauthorized: false }
    });

    try {
        await client.connect();

        // 3. تحليل البيانات القادمة من الفرونت
        const body = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : (request.body || {});
        const queryParams = request.query || {};
        const d = body.debtData || body.debt || body.updates || body.data || body;

        // استخراج الـ ID والاسم بأكبر قدر من المرونة
        const targetId = String(body.id || body.debtId || d.id || queryParams.id || '').trim();
        const targetName = String(body.personName || body.person_name || body.name || d.personName || d.person_name || queryParams.personName || '').trim();

        if (!targetId && !targetName) {
            return response.status(400).json({
                success: false,
                error: 'يرجى إرسال id أو personName المُراد حذفه.'
            });
        }

        // 4. تحديد السكيمّا المستهدفة
        const rawSchema = 
            request.headers['x-tenant-schema'] || 
            request.headers['tenant'] ||
            body.schemaName || 
            body.companyName || 
            body.company_name ||
            d.companyName ||
            d.company_name ||
            queryParams.companyName ||
            queryParams.schemaName;

        const userId = body.userId || d.userId || queryParams.userId || request.headers['user-id'];

        let targetSchema = normalizeSchemaName(rawSchema);

        // جلب السكيمّا الخاصة بالمستخدم إذا لم تكن ممررة بشكل مباشر
        if (!targetSchema && userId && userId !== 'guest') {
            const userRes = await client.query('SELECT company_name FROM public.app_users WHERE id::text = $1 LIMIT 1', [String(userId)]).catch(() => ({ rows: [] }));
            if (userRes.rows.length > 0 && userRes.rows[0].company_name) {
                targetSchema = normalizeSchemaName(userRes.rows[0].company_name);
            }
        }

        // استخدام السكيمّا الافتراضية إذا تعذر الوصول لسكيمّا محددة
        if (!targetSchema) targetSchema = 'public';

        // 5. ضمان وجود السكيمّا وضبط search_path
        await client.query(`CREATE SCHEMA IF NOT EXISTS "${targetSchema}"`);
        await client.query(`SET search_path TO "${targetSchema}", public`);

        // 6. تنفيذ الحذف
        let deleteQuery = '';
        let queryParamsArr = [];

        if (targetId) {
            deleteQuery = `DELETE FROM "${targetSchema}".debts WHERE id::text = $1 OR id::text LIKE $2 RETURNING *;`;
            queryParamsArr = [targetId, `%${targetId}%`];
        } else {
            deleteQuery = `DELETE FROM "${targetSchema}".debts WHERE LOWER(TRIM(person_name)) = LOWER(TRIM($1)) RETURNING *;`;
            queryParamsArr = [targetName];
        }

        let result = await client.query(deleteQuery, queryParamsArr);

        // 7. الآلية البديلة (Fallback): إذا لم يُعثر على الدين، ابحث في السكيمّات الأخرى المتاحة
        if (result.rowCount === 0 && targetId) {
            const allSchemasRes = await client.query(`
                SELECT table_schema 
                FROM information_schema.tables 
                WHERE table_name = 'debts' AND table_schema NOT IN ('pg_catalog', 'information_schema')
            `);

            for (const row of allSchemasRes.rows) {
                const schemaToSearch = row.table_schema;
                if (schemaToSearch === targetSchema) continue;

                const fallbackDelete = await client.query(
                    `DELETE FROM "${schemaToSearch}".debts WHERE id::text = $1 OR id::text LIKE $2 RETURNING *;`,
                    [targetId, `%${targetId}%`]
                ).catch(() => ({ rowCount: 0, rows: [] }));

                if (fallbackDelete.rowCount > 0) {
                    return response.status(200).json({
                        success: true,
                        message: `تم الحذف بنجاح من السكيمّا البديلة (${schemaToSearch})`,
                        deletedCount: fallbackDelete.rowCount,
                        deletedRows: fallbackDelete.rows,
                        actualSchema: schemaToSearch
                    });
                }
            }
        }

        // إذا تعذر الحذف بالكامل، يتم تشغيل التشخيص وتقديم التفاصيل
        if (result.rowCount === 0) {
            const diagnostics = await diagnoseNotFoundReason(client, targetSchema, targetId, targetName);

            return response.status(404).json({
                success: false,
                message: `لم يتم العثور على العنصر بـ (${targetId || targetName}) للحذف في السكيمّا (${targetSchema}).`,
                debugInfo: {
                    searchedFor: { id: targetId, personName: targetName },
                    targetSchema,
                    reason: diagnostics.possibleReason,
                    diagnostics
                }
            });
        }

        return response.status(200).json({
            success: true,
            message: 'تم الحذف بنجاح من قاعدة البيانات',
            deletedCount: result.rowCount,
            deletedRows: result.rows
        });

    } catch (error) {
        console.error('DATABASE ERROR ON DELETE:', error);
        return response.status(500).json({
            success: false,
            error: 'حدث خطأ أثناء الحذف: ' + error.message
        });
    } finally {
        await client.end().catch(err => console.error('Error closing client:', err));
    }
}
