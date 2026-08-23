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
    
    // استخراج معرف الدين المراد حذفه
    const targetId = body.id || body.debtId || d.id || d._id || req.query?.id || req.query?.debtId;
    
    // استخراج بيانات الشركة والمستخدم والمعرفات المتاحة
    let userId = body.userId || body.user_id || d.userId || d.user_id || req.headers['x-user-id'] || null;
    let finalCompanyName = body.companyName || body.company_name || body.company || d.companyName || d.company_name || d.company;
    let targetSchema = req.headers['x-tenant-schema'];

    if (!targetId) {
      return res.status(400).json({ success: false, error: 'المعرف (id) مطلوب لعملية الحذف' });
    }

    await client.connect();

    // 2. إذا لم يرسل الفرونت اسم الشركة ولكن أرسل userId، نجلب اسم الشركة من جدول app_users الرئيسي
    if (!targetSchema && !finalCompanyName && userId) {
      const userRes = await client.query(
        'SELECT company_name FROM public.app_users WHERE id = $1 LIMIT 1',
        [userId]
      );
      if (userRes.rows.length > 0) {
        finalCompanyName = userRes.rows[0].company_name;
      }
    }

    // 💡 3. مطابقة معادلة بناء اسم الـ Schema تماماً كما في كود التسجيل
    let schemaName = targetSchema;

    if (!schemaName || schemaName.trim() === '') {
      const sanitizedCompany = finalCompanyName ? finalCompanyName.toString().trim().replace(/[^a-zA-Z0-9_]/g, '').toLowerCase() : '';
      
      const cleanUser = userId ? userId.toString().trim().replace('usr_', '').replace(/[^a-zA-Z0-9_]/g, '').toLowerCase() : '';

      if (sanitizedCompany) {
        schemaName = `schema_${sanitizedCompany}`;
      } else if (cleanUser) {
        schemaName = `schema_user_${cleanUser}`;
      }
    }

    if (!schemaName) {
      return res.status(400).json({ 
        success: false, 
        error: 'لم يتم تحديد السكيمّا أو اسم الشركة أو userId للوصول إلى قاعدة البيانات الصحيحة' 
      });
    }

    const cleanSchema = schemaName.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();

    // 💡 4. التوجه إلى السكيمّا المحددة وتنفيذ عملية الحذف
    await client.query(`SET search_path TO "${cleanSchema}";`);

    const deleteQuery = `DELETE FROM debts WHERE id = $1 RETURNING *;`;
    const result = await client.query(deleteQuery, [targetId]);

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'لم يتم العثور على السجل المطلوب حذفه داخل هذه السكيمّا',
        schemaUsed: cleanSchema,
        targetId: targetId
      });
    }

    return res.status(200).json({
      success: true,
      message: 'تم الحذف بنجاح',
      schemaUsed: cleanSchema,
      deletedDebt: result.rows[0],
      rowCount: result.rowCount
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
