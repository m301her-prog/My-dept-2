import pg from 'pg';

export default async function handler(request, response) {
    // إعدادات CORS
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    
    if (request.method === 'OPTIONS') return response.status(200).end();

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

        // 1. جلب كافة السكيمات المعرفة في الداتا بيز (الشركات)
        const schemasRes = await client.query(`
            SELECT schema_name 
            FROM information_schema.schemata 
            WHERE schema_name LIKE 'schema_%'
        `);
        
        const schemasSet = new Set(schemasRes.rows.map(r => r.schema_name));

        // 2. جلب أسماء الشركات من جدول app_users لضمان عدم تفويت أي شركة
        try {
            const usersRes = await client.query('SELECT DISTINCT company_name FROM public.app_users WHERE company_name IS NOT NULL');
            usersRes.rows.forEach(u => {
                let clean = u.company_name.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
                if (clean.startsWith('schema_')) clean = clean.replace('schema_', '');
                if (clean) schemasSet.add(`schema_${clean}`);
            });
        } catch (e) {
            console.log('ملاحظة: لم يتم جلب app_users أو أنه غير موجود');
        }

        const allSchemas = Array.from(schemasSet);
        if (allSchemas.length === 0) {
            allSchemas.push('public');
        }

        let allDebtsCombined = [];

        // 3. الدوران على كل السكيمات واستخراج الديون
        for (const schemaName of allSchemas) {
            try {
                await client.query(`SET search_path TO "${schemaName}", public`);
                const result = await client.query('SELECT * FROM debts ORDER BY id DESC');

                const schemaDebts = result.rows.map(row => ({
                    id: row.id,
                    type: row.type,
                    personName: row.person_name,
                    phone: row.phone,
                    amount: parseFloat(row.amount) || 0,
                    currency: row.currency || 'DZD',
                    dueDate: row.due_date,
                    notes: row.notes,
                    status: row.status,
                    isScheduled: row.is_scheduled || false,
                    scheduleType: row.schedule_type,
                    installmentsCount: row.installments_count || 0,
                    firstPaymentDate: row.first_payment_date,
                    companyName: schemaName.replace('schema_', '')
                }));

                allDebtsCombined = allDebtsCombined.concat(schemaDebts);
            } catch (err) {
                continue;
            }
        }

        return response.status(200).json({
            success: true,
            totalRecords: allDebtsCombined.length,
            debts: allDebtsCombined
        });

    } catch (error) {
        console.error('DATABASE ERROR ON ACTION API:', error);
        return response.status(500).json({
            success: false,
            error: 'فشل في جلب البيانات: ' + error.message
        });
    } finally {
        await client.end().catch(err => console.error('Error closing client:', err));
    }
}
