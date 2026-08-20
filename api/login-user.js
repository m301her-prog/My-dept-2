import pg from 'pg';

export default async function handler(req, res) {
  // 1. إعدادات CORS الكاملة لضمان اتصال تطبيق الهاتف والـ WebView بدون حظر
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // التعامل مع طلبات التحقق المسبق لـ CORS
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // 2. ضبط الاتصال بـ Postgres (Neon) مع تفعيل الـ SSLmode بشكل صحيح
  const baseConnectionString = process.env.DATABASE_URL || '';
  const separator = baseConnectionString.includes('?') ? '&' : '?';
  const finalConnectionString = `${baseConnectionString}${separator}sslmode=verify-full`;

  const client = new pg.Client({
    connectionString: finalConnectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'يرجى إدخال البريد الإلكتروني وكلمة المرور' });
    }

    const cleanEmail = email.toLowerCase().trim();

    await client.connect();

    // 3. جلب بيانات المستخدم مع company_name لبناء اسم الـ Schema
    const loginQuery = 'SELECT id, name, company_name, email, password, phone, is_admin, active FROM public.app_users WHERE LOWER(email) = $1 LIMIT 1';
    const result = await client.query(loginQuery, [cleanEmail]);

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });
    }

    const dbUser = result.rows[0];

    if (dbUser.password !== password) {
      return res.status(400).json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });
    }

    // 4. استخراج اسم الـ Schema وتنسيقه ليكون ببادئة schema_ مطابقاً للوحة Neon
    const rawCompany = dbUser.company_name || '';
    let cleanCompany = rawCompany.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();

    if (cleanCompany.startsWith('schema_')) {
      cleanCompany = cleanCompany.replace('schema_', '');
    }

    const tenantSchema = cleanCompany ? `schema_${cleanCompany}` : 'public';

    // 5. إرجاع البيانات بالأسماء المطلوبة للفرونت إند شاملة tenantSchema
    return res.status(200).json({
      message: 'تم تسجيل الدخول بنجاح',
      tenantSchema: tenantSchema, // يُرجع مثلاً: schema_lil
      user: {
        id: dbUser.id,
        name: dbUser.name,
        companyName: dbUser.company_name || '',
        email: dbUser.email,
        phone: dbUser.phone || '',
        isAdmin: dbUser.is_admin === true || dbUser.is_admin === 'true',
        active: dbUser.active === true || dbUser.active === 'true'
      }
    });

  } catch (error) {
    console.error('Login API Error:', error);
    return res.status(500).json({ error: 'حدث خطأ داخلي في الخادم، يرجى المحاولة لاحقاً' });
  } finally {
    // إغلاق الاتصال لضمان عدم استهلاك موارد قاعدة البيانات في البيئة السحابية
    await client.end().catch(err => console.error('Error closing client:', err));
  }
}
