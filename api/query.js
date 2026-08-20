import pg from 'pg';

export default async function handler(req, res) {
  // 1. تفعيل إعدادات CORS الكاملة
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-tenant-schema'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // استقبال اسم السكيمّا الخاصة بالحساب/الشركة من الـ body أو الـ headers
  const { schemaName } = req.body;
  const targetSchema = schemaName || req.headers['x-tenant-schema'];

  if (!targetSchema) {
    return res.status(400).json({ error: 'اسم السكيمّا (schemaName) مطلوب لتأسيس الحساب' });
  }

  // 2. إعداد الاتصال الآمن مع Neon لتجنب مشاكل الـ SSL في تطبيقات الهاتف
  const baseConnectionString = process.env.DATABASE_URL;
  const separator = baseConnectionString.includes('?') ? '&' : '?';
  const finalConnectionString = `${baseConnectionString}${separator}sslmode=verify-full`;

  const client = new pg.Client({
    connectionString: finalConnectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    // تنظيف اسم السكيمّا لحصرها في الحروف والأرقام وتحويلها لـ lowercase
    const cleanSchema = targetSchema.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
    
    // 🔥 أ) إنشاء السكيمّا مع وضع علامات تنصيص مزدوجة صريحة لإجبار نيون على إنشائها فوراً
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${cleanSchema}"`);
    
    // 🔥 ب) ضبط مسار البحث للجلسة الحالية لتشير للسكيمّا الجديدة المحمية
    await client.query(`SET search_path TO "${cleanSchema}", public`);

    // 🔥 ج) إنشاء جدول الديون بالإشارة الصريحة المقيدة الحتمية لاسم السكيمّا 
    await client.query(`
      CREATE TABLE IF NOT EXISTS "${cleanSchema}".debts (
        id TEXT PRIMARY KEY,
        person_name TEXT NOT NULL,
        type TEXT NOT NULL,          -- دائن أو مدين (owed_to_me / i_owe)
        status TEXT NOT NULL,        -- حالة الدين (pending / paid / partially_paid)
        amount NUMERIC DEFAULT 0,    -- المبلغ المستحق
        currency TEXT DEFAULT 'DZD', -- العملة
        phone TEXT,                  -- رقم الهاتف (للواتساب)
        due_date DATE,               -- تاريخ الاستحقاق
        notes TEXT,                  -- الملاحظات والبيانات الإضافية
        is_scheduled BOOLEAN DEFAULT FALSE, -- هل الدين مجدول/مقسط؟
        schedule_type TEXT,          -- نوع الجدولة (يومي، أسبوعي، شهري...)
        installments_count INT DEFAULT 0,  -- عدد الدفعات
        first_payment_date DATE      -- تاريخ أول دفعة
      );
    `);
    
    // إرجاع استجابة نجاح التأسيس للواجهة الأمامية
    return res.status(200).json({
      success: true,
      schemaName: cleanSchema,
      message: `تم إنشاء وتأسيس السكيمّا [${cleanSchema}] وجداول الديون بنجاح وبشكل معزول.`
    });

  } catch (error) {
    console.error('Schema Initialization Error:', error);
    return res.status(500).json({ error: error.message });
  } finally {
    // إغلاق الاتصال بأمان
    await client.end().catch(err => console.error('Error closing client:', err));
  }
}
