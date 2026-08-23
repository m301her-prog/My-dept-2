import pg from 'pg';

const baseConnectionString = process.env.DATABASE_URL;
let pool;

if (baseConnectionString) {
    const separator = baseConnectionString.includes('?') ? '&' : '?';
    const finalConnectionString = `${baseConnectionString}${separator}sslmode=verify-full`;

    pool = new pg.Pool({
        connectionString: finalConnectionString,
        ssl: { rejectUnauthorized: false },
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000
    });
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS,DELETE');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-tenant-schema, x-user-id'
    );

    if (req.method === 'OPTIONS') return res.status(200).end();

    if (!pool) {
        return res.status(500).json({ success: false, error: 'DATABASE_URL غير معرف' });
    }

    const client = await pool.connect();

    try {
        let body = req.body || {};
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (e) {}
        }

        const d = body.debtData || body.debt || body.updates || body.data || body;

        // 1. استخراج معايير البحث
        const deleteId = body.id || body.debtId || d.id || d._id;
        const personName = body.personName || body.person_name || body.name || d.personName || d.person_name || d.name;
        const personPhone = body.personPhone || body.person_phone || body.phone || d.personPhone || d.person_phone || d.phone;

        if (!deleteId && !personName && !personPhone) {
            return res.status(400).json({ 
                success: false, 
                error: 'يلزم إرسال المعرف (id) أو الاسم أو الهاتف' 
            });
        }

        // 2. جلب جميع الـ Schemas الموجودة في قاعدة البيانات تلقائياً
        const schemasResult = await client.query(`
            SELECT schema_name 
            FROM information_schema.schemata 
            WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        `);

        const allSchemas = schemasResult.rows.map(r => r.schema_name);

        let deletedRecord = null;
        let foundInSchema = null;

        // 3. البحث والحذف في كل Schemas قاعدة البيانات حتى نجد السجل
        for (const schemaName of allSchemas) {
            await client.query(`SET search_path TO "${schemaName}";`);

            // التأكد من أن هذه السكيمّا تحتوي على جدول debts
            const tableExists = await client.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = $1 AND table_name = 'debts'
                );
            `, [schemaName]);

            if (!tableExists.rows[0].exists) continue;

            // تجهيز شروط الحذف
            let conditions = [];
            let params = [];
            let idx = 1;

            if (deleteId) {
                conditions.push(`id = $${idx}`);
                params.push(String(deleteId).trim());
                idx++;
            }

            if (personName) {
                conditions.push(`(LOWER(TRIM(person_name)) = LOWER(TRIM($${idx})) OR LOWER(TRIM("personName")) = LOWER(TRIM($${idx})))`);
                params.push(String(personName));
                idx++;
            }

            if (personPhone) {
                conditions.push(`(phone = $${idx} OR person_phone = $${idx} OR "personPhone" = $${idx})`);
                params.push(String(personPhone).trim());
                idx++;
            }

            const deleteQuery = `
                DELETE FROM debts 
                WHERE ${conditions.join(' OR ')}
                RETURNING *;
            `;

            const result = await client.query(deleteQuery, params);

            if (result.rowCount > 0) {
                deletedRecord = result.rows[0];
                foundInSchema = schemaName;
                break; // تم الحذف بنجاح
            }
        }

        // 4. النتيجة
        if (!deletedRecord) {
            return res.status(404).json({
                success: false,
                searchedSchemas: allSchemas,
                error: `لم يتم العثور على العنصر بالمعرف (${deleteId || personName}) داخل أي Schema في قاعدة البيانات!`
            });
        }

        return res.status(200).json({ 
            success: true, 
            message: 'تم الحذف بنجاح!',
            schemaUsed: foundInSchema, 
            deletedData: deletedRecord
        });

    } catch (error) {
        console.error(`[DELETE ERROR]:`, error);
        return res.status(500).json({ success: false, error: error.message });
    } finally {
        client.release();
    }
}
