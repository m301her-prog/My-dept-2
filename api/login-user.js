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
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  // 2. ضبط الاتصال بـ Postgres (Neon) مع تفعيل الـ SSLmode بشكل صحيح
  const baseConnectionString = process.env.DATABASE_URL || '';
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
    // معالجة الـ body في حال كان قادماً كـ JSON String من CapacitorHttp
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {
        console.error('Failed to parse body string:', e);
      }
    }

    const { email, password } = body || {};

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'يرجى إدخال البريد الإلكتروني وكلمة المرور' });
    }

    const cleanEmail = email.toLowerCase().trim();

    await client.connect();

    // 3. جلب بيانات المستخدم مع company_name لبناء اسم الـ Schema
    const loginQuery = 'SELECT id, name, company_name, email, password, phone, is_admin, active FROM public.app_users WHERE LOWER(email) = $1 LIMIT 1';
    const result = await client.query(loginQuery, [cleanEmail]);

    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });
    }

    const dbUser = result.rows[0];

    // التحقق من حالة الحساب
    if (dbUser.active === false || dbUser.active === 'false') {
      return res.status(403).json({ success: false, error: 'هذا الحساب معطل، يرجى التواصل مع الإدارة' });
    }

    // مطابقة كلمة المرور (يدعم كلمة المرور العادية أو الـ Hash القادم من الفرونت إند)
    if (dbUser.password !== password) {
      return res.status(400).json({ success: false, error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });
    }

    // 4. استخراج اسم الـ Schema وتنسيقه ليكون ببادئة schema_
    const rawCompany = dbUser.company_name || '';
    let cleanCompany = rawCompany.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();

    if (cleanCompany.startsWith('schema_')) {
      cleanCompany = cleanCompany.replace('schema_', '');
    }

    const tenantSchema = cleanCompany ? `schema_${cleanCompany}` : 'public';

    // 5. إرجاع الاستجابة بتنسيق يطابق شروط الفرونت إند (إضافة success: true)
    return res.status(200).json({
      success: true,
      message: 'تم تسجيل الدخول بنجاح',
      tenantSchema: tenantSchema,
      schemaName: tenantSchema,
      user: {
        id: dbUser.id,
        name: dbUser.name,
        companyName: dbUser.company_name || '',
        company_name: dbUser.company_name || '',
        email: dbUser.email,
        phone: dbUser.phone || '',
        isAdmin: dbUser.is_admin === true || dbUser.is_admin === 'true',
        is_admin: dbUser.is_admin === true || dbUser.is_admin === 'true',
        active: dbUser.active === true || dbUser.active === 'true'
      }
    });

  } catch (error) {
    console.error('Login API Error:', error);
    return res.status(500).json({ success: false, error: 'حدث خطأ داخلي في الخادم، يرجى المحاولة لاحقاً' });
  } finally {
    await client.end().catch(err => console.error('Error closing client:', err));
  }
}
