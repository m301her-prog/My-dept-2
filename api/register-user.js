import pg from 'pg';

// استخدام Pool بدلاً من Client لتسريع الاتصال ومنع تجاوز الاتصالات في Serverless
const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
  // 1. إضافة هيدرز CORS كاملة لمنع حظر الطلب من المتصفح
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // 2. الرد الفوري على طلبات OPTIONS التمهيدية (حل مشكلة Failed to fetch الأساسية)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  if (!process.env.DATABASE_URL) {
    return res.status(500).json({ error: 'DATABASE_URL غير معرف في متغيرات البيئة' });
  }

  const client = await pool.connect();

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {
        console.error('Failed to parse body string:', e);
      }
    }

    const { name, companyName, company_name, email, password, phone } = body || {};
    const finalCompanyName = companyName || company_name;

    if (!name || !finalCompanyName || !email || !password) {
      return res.status(400).json({ 
        error: 'يرجى ملء جميع الحقول الأساسية (الاسم، اسم الشركة، البريد، كلمة المرور)' 
      });
    }

    const cleanEmail = email.toLowerCase().trim();

    // بداية المعاملة (Transaction)
    await client.query('BEGIN');

    // 1. إنشاء جدول الحسابات الرئيسي إن لم يكن موجوداً
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.app_users (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        company_name VARCHAR(150) NOT NULL,
        email VARCHAR(150) UNIQUE NOT NULL,
        password VARCHAR(100) NOT NULL,
        phone VARCHAR(50),
        is_admin BOOLEAN DEFAULT FALSE,
        active BOOLEAN DEFAULT TRUE,
        created_at VARCHAR(50) NOT NULL
      );
    `);

    // 2. التحقق من تكرار البريد
    const checkResult = await client.query(
      'SELECT id FROM public.app_users WHERE LOWER(email) = $1 LIMIT 1', 
      [cleanEmail]
    );

    if (checkResult.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'هذا البريد الإلكتروني مسجل بالفعل' });
    }

    const userId = 'usr_' + Math.random().toString(36).substring(2, 11);

    const isAdmin = cleanEmail === 'nawh@nawh.com' || (name && name.toString().trim() === 'admin301');
    const finalPhone = phone || (isAdmin ? '201091288031' : '');
    const createdAt = new Date().toISOString();

    // 3. إنشاء اسم Schema فريد للشركة
    const schemaName = `tenant_${userId}`;

    // 4. إنشاء الـ Schema الخاصة بالشركة
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${schemaName}`);

    // 5. إدراج الحساب الجديد في الجدول الرئيسي
    const insertQuery = `
      INSERT INTO public.app_users (id, name, company_name, email, password, phone, is_admin, active, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, name, company_name, email, phone, is_admin, active, created_at;
    `;
    
    const insertResult = await client.query(insertQuery, [
      userId, 
      name, 
      finalCompanyName, 
      cleanEmail, 
      password, 
      finalPhone, 
      isAdmin, 
      true, 
      createdAt
    ]);

    await client.query('COMMIT');

    const createdUser = insertResult.rows[0];

    const formattedUser = {
      ...createdUser,
      companyName: createdUser.company_name,
      isAdmin: createdUser.is_admin
    };

    return res.status(200).json({
      success: true,
      message: 'تم إنشاء الحساب والـ Schema الخاصة به بنجاح',
      userId: userId,
      schemaName: schemaName,
      isAdmin: isAdmin,
      user: formattedUser
    });

  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('Registration API Error:', error);
    return res.status(500).json({ error: error.message || 'حدث خطأ أثناء إنشاء الحساب والـ Schema' });
  } finally {
    if (client) client.release(); // إرجاع الاتصال للـ Pool بدلاً من إغلاقه
  }
}
