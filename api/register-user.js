import pg from 'pg';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const baseConnectionString = process.env.DATABASE_URL;
  if (!baseConnectionString) {
    return res.status(500).json({ error: 'DATABASE_URL غير معرف في متغيرات البيئة' });
  }

  const separator = baseConnectionString.includes('?') ? '&' : '?';
  const finalConnectionString = `${baseConnectionString}${separator}sslmode=verify-full`;

  const client = new pg.Client({
    connectionString: finalConnectionString,
    ssl: { rejectUnauthorized: false }
  });

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

    await client.connect();

    // بداية المعاملة (Transaction) لضمان تنفيذ كل الخطوات
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

    // =========================================================
    // إنشاء اسم السكيمّا بناءً على اسم الشركة (مع تنظيف وتطهير الاسم)
    // =========================================================
    // تحويل اسم الشركة لحروف صغيرة واستبدال المسافات والرموز بـ _
    let sanitizedCompany = finalCompanyName
      .toString()
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');

    // إذا كان اسم الشركة بالعربي أو رموز فقط، يتم الدمج مع الـ userId للحفاظ على فرادتها وصحتها في Postgres
    let rawSchemaName = sanitizedCompany
      ? `company_${sanitizedCompany}`
      : `company_${userId}`;

    // إضافة الـ userId كـ suffix أخير لمنع تصادفات الأسماء بين شركات تحمل نفس الاسم
    const schemaName = `${rawSchemaName}_${userId.replace('usr_', '')}`;

    // =========================================================
    // تحديد صلاحية الأدمن بشكل آمن يمنع توقف السيرفر
    // =========================================================
    const isAdmin = cleanEmail === 'nawh@nawh.com' || (name && name.toString().trim() === 'admin301');

    // إذا كان الحساب الأدمن ولم يتم إرسال رقم هاتف من الواجهة، يتم اعتماد رقم الواتساب الافتراضي
    const finalPhone = phone || (isAdmin ? '201091288031' : '');

    const createdAt = new Date().toISOString();

    // 3. إنشاء الـ Schema الخاصة بالشركة باستخدام quote_ident لمنع SQL Injection
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${pg.Client.prototype.escapeIdentifier(schemaName)}`);

    // 4. إدراج الحساب الجديد في الجدول الرئيسي واسترجاع الحساب الذي تم إنشاؤه
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

    // تأكيد وتنفيذ العمليات
    await client.query('COMMIT');

    const createdUser = insertResult.rows[0];

    // تجميع كائن المستخدم بالصيغتين (is_admin و isAdmin) للتوافق التام مع الواجهة الأمامية (Frontend)
    const formattedUser = {
      ...createdUser,
      companyName: createdUser.company_name,
      isAdmin: createdUser.is_admin,
      schemaName: schemaName
    };

    // إرجاع كائن استجابة مكتمل
    return res.status(200).json({
      success: true,
      message: 'تم إنشاء الحساب والـ Schema الخاصة بالشركة بنجاح',
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
    if (client) await client.end().catch(err => console.error('Error closing client:', err));
  }
}
