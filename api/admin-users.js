import pg from 'pg';

export default async function handler(req, res) {
  // إعداد نص الاتصال بقاعدة البيانات مع تفعيل SSL لـ Neon
  const baseConnectionString = process.env.DATABASE_URL;
  const separator = baseConnectionString.includes('?') ? '&' : '?';
  const finalConnectionString = `${baseConnectionString}${separator}sslmode=verify-full`;

  const client = new pg.Client({
    connectionString: finalConnectionString,
    ssl: { 
      rejectUnauthorized: false 
    }
  });

  try {
    // الاتصال بقاعدة البيانات
    await client.connect();

    // ==========================================
    // 1. مهمة جلب جميع الحسابات (GET Request)
    // ==========================================
    if (req.method === 'GET') {
      // جلب المستخدمين وترتيبهم من الأحدث للأقدم
      const getUsersQuery = `
        SELECT id, name, company_name, email, phone, is_admin, active, created_at 
        FROM app_users 
        ORDER BY created_at DESC;
      `;
      const result = await client.query(getUsersQuery);

      return res.status(200).json({
        success: true,
        users: result.rows
      });
    }

    // ==========================================
    // 2. مهمة التعطيل والتفعيل (POST Request)
    // ==========================================
    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') {
        try {
          body = JSON.parse(body);
        } catch (e) {
          console.error('Failed to parse body string:', e);
        }
      }

      if (!body || body.userId === undefined || body.active === undefined) {
        return res.status(400).json({ error: 'بيانات ناقصة، يرجى إرسال userId و active' });
      }

      const { userId, active } = body;
      // تحويل القيمة صراحة إلى Boolean لضمان التوافق مع Postgres
      const isTrueActive = active === true || active === 'true' || active === 1 || active === '1';

      const updateQuery = `
        UPDATE app_users 
        SET active = $1 
        WHERE id = $2
        RETURNING id, name, email, active;
      `;
      
      const result = await client.query(updateQuery, [isTrueActive, userId]);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'المستخدم غير موجود في قاعدة البيانات' });
      }

      return res.status(200).json({
        success: true,
        message: isTrueActive ? 'تم تفعيل الحساب بنجاح' : 'تم تعطيل الحساب بنجاح',
        user: result.rows[0]
      });
    }

    // إذا تم استدعاء الـ API بطريقة أخرى (مثل PUT أو DELETE)
    return res.status(405).json({ error: 'Method Not Allowed' });

  } catch (error) {
    console.error('Admin API Error:', error);
    return res.status(500).json({ error: 'حدث خطأ في الخادم، يرجى المحاولة لاحقاً' });
  } finally {
    // إغلاق الاتصال بأمان
    await client.end().catch(err => console.error('Error closing client:', err));
  }
}
