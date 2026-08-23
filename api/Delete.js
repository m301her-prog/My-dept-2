import pg from 'pg';

export default async function handler(req, res) {
  // 1. إعدادات CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-tenant-schema, x-user-id'
  );

  if (req.method === 'OPTIONS') return res.status(200).end();
  
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

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

  try {
    let body = req.body || {};
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) {}
    }

    const d = body.debtData || body.debt || body.updates || body.data || body;
    
    // استخراج معرف الدين (id) والمرشحات
    const targetId = body.id || body.debtId || d.id || d._id || req.query?.id || req.query?.debtId;
    let userId = body.userId || body.user_id || d.userId || d.user_id || req.headers['x-user-id'] || null;
    let finalCompanyName = body.companyName || body.company_name || body.company || d.companyName || d.company_name || d.company;
    let targetSchema = req.headers['x-tenant-schema'];

    if (!targetId) {
      return res.status(400).json({ success: false, error: 'المعرف (id) مطلوب لعملية الحذف' });
    }

    await client.connect();

    // 2. المحاولة الأولى: تخمين السكيمّا من اسم الشركة أو userId
    if (!targetSchema && !finalCompanyName && userId) {
      const userRes = await client.query(
        'SELECT company_name FROM public.app_users WHERE id = $1 LIMIT 1',
        [userId]
      );
      if (userRes.rows.length > 0) {
        finalCompanyName = userRes.rows[0].company_name;
      }
    }

    let guessedSchema = targetSchema;
    if (!guessedSchema && finalCompanyName) {
      const sanitizedCompany = finalCompanyName.toString().trim().replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
      if (sanitizedCompany) guessedSchema = `schema_${sanitizedCompany}`;
    }
    if (!guessedSchema && userId) {
      const cleanUser = userId.toString().trim().replace('usr_', '').replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
      if (cleanUser) guessedSchema = `schema_user_${cleanUser}`;
    }

    const deleteQuery = `DELETE FROM debts WHERE id = $1 RETURNING *;`;
    let deletedRecord = null;
    let actualSchemaUsed = null;

    // 3. كود التنفيذ الأول في السكيمّا المتوقعة
    if (guessedSchema) {
      const cleanSchema = guessedSchema.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
      try {
        await client.query(`SET search_path TO "${cleanSchema}";`);
        const resPrimary = await client.query(deleteQuery, [targetId]);
        if (resPrimary.rowCount > 0) {
          deletedRecord = resPrimary.rows[0];
          actualSchemaUsed = cleanSchema;
        }
      } catch (e) {
        // تجاهل الخطأ في حال كانت السكيمّا غير موجودة والترخيص للمحيط الشامل
      }
    }

    // 💡 4. الحل الجذري (Fallback Scan): البحث في جميع السكيمات التي تبدأ بـ schema_ في حال فشل التخمين
    if (!deletedRecord) {
      const allSchemasResult = await client.query(`
        SELECT schema_name 
        FROM information_schema.schemata 
        WHERE schema_name LIKE 'schema_%';
      `);

      for (const row of allSchemasResult.rows) {
        const schemaName = row.schema_name;
        if (schemaName === actualSchemaUsed) continue;

        try {
          await client.query(`SET search_path TO "${schemaName}";`);
          const scanRes = await client.query(deleteQuery, [targetId]);
          if (scanRes.rowCount > 0) {
            deletedRecord = scanRes.rows[0];
            actualSchemaUsed = schemaName;
            break; // اخرج فور إيجاد السجل وحذفه
          }
        } catch (err) {
          // السكيمّا قد لا تحتوي على جدول debts
          continue;
        }
      }
    }

    // 5. إرجاع النتيجة
    if (!deletedRecord) {
      return res.status(404).json({
        success: false,
        error: 'لم يتم العثور على السجل في أي سكيمّا مسجلة في النظام (ربما تم حذفه مسبقاً)',
        targetId: targetId
      });
    }

    return res.status(200).json({
      success: true,
      message: 'تم الحذف بنجاح',
      schemaUsed: actualSchemaUsed,
      deletedDebt: deletedRecord
    });

  } catch (error) {
    console.error('[DATABASE ERROR ON DELETE]:', error);
    return res.status(500).json({ success: false, error: error.message });
  } finally {
    if (client) {
      await client.end().catch(err => console.error('Error closing client:', err));
    }
  }
}
