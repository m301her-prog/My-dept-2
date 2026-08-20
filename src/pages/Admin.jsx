import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Users,
  Mail,
  Calendar,
  Shield,
  UserCheck,
  Trash2,
  DollarSign,
  Search,
  Building2,
  Phone,
  MessageCircle
} from 'lucide-react';

/**
 * Admin Dashboard Page
 * For admin users only - manage all registered users/companies
 * Uses independent direct API for isolation
 */
export default function Admin() {
  const {
    t,
    user,
    isAdmin,
    deleteUser,
    showNotification,
    language
  } = useApp();
  
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [localUsers, setLocalUsers] = useState([]);
  const [localLoading, setLocalLoading] = useState(false);

  // رابط الـ API المستقل
  const ADMIN_API_URL = '';

  // دالة جلب الحسابات المستقلة (GET)
  const fetchAdminUsers = async () => {
    if (!ADMIN_API_URL) return;
    setLocalLoading(true);
    try {
      const response = await fetch(ADMIN_API_URL);
      if (!response.ok) throw new Error('فشلت عملية جلب الحسابات من السيرفر');
      const data = await response.json();
      if (data.success) {
        setLocalUsers(data.users || []);
        // حفظ نسخة احتياطية في الكاش المحلي
        localStorage.setItem('admin_cached_users', JSON.stringify(data.users));
      }
    } catch (error) {
      console.error("خطأ جلب البيانات المستقل:", error);
      // استرجاع البيانات الاحتياطية في حال انقطاع السيرفر
      const cached = localStorage.getItem('admin_cached_users');
      if (cached) setLocalUsers(JSON.parse(cached));
    } finally {
      setLocalLoading(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) {
      navigate('/');
      return;
    }
    fetchAdminUsers();
  }, [isAdmin, navigate]);

  if (!isAdmin) {
    return null;
  }

  // فحص دقيق للحالة النشطة للمستخدم
  const checkIsActive = (u) => u.active === true || u.active === 'true' || u.active === 1 || u.status === 'active';

  const activeUsers = localUsers.filter(u => checkIsActive(u)).length;

  const formatDate = (dateString) => {
    const locale = language === 'ar' ? 'ar-EG' : language === 'fr' ? 'fr-FR' : 'en-US';
    return new Date(dateString).toLocaleDateString(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  // دالة الـ Capture للاتصال الخارجي وتنبيه تطبيق الأندرويد
  const triggerAndroidCapture = (eventName, data) => {
    try {
      if (window.Android && window.Android.captureEvent) {
        window.Android.captureEvent(eventName, JSON.stringify(data));
      } else if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.Android) {
        window.webkit.messageHandlers.Android.postMessage({ event: eventName, data });
      }
      console.log(`[Capture triggered]: ${eventName}`, data);
    } catch (e) {
      console.error("Android capture failed:", e);
    }
  };

  // التعامل مع التفعيل والتعطيل مباشرة عبر الـ API الجديد (POST)
  const handleToggleStatus = async (userId, currentStatus) => {
    if (!ADMIN_API_URL) return;
    setLocalLoading(true);
    const isCurrentlyActive = currentStatus === true || currentStatus === 'true' || currentStatus === 1;
    const nextStatus = !isCurrentlyActive; 

    try {
      const response = await fetch(ADMIN_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, active: nextStatus })
      });

      if (!response.ok) {
        throw new Error('فشل تحديث حالة المستخدم على السيرفر');
      }

      const data = await response.json();

      if (data.success) {
        // تحديث الحالة محلياً في الواجهة فوراً
        setLocalUsers(prev => prev.map(u => u.id === userId ? { ...u, active: nextStatus } : u));
        
        // إرسال إشارة الاتصال الخارجي للأندرويد
        triggerAndroidCapture('USER_STATUS_CHANGED', { userId, active: nextStatus });

        showNotification(
          nextStatus
            ? (language === 'ar' ? 'تم تفعيل الحساب بنجاح' : language === 'fr' ? 'Utilisateur activé' : 'User activated')
            : (language === 'ar' ? 'تم تعطيل الحساب بنجاح' : language === 'fr' ? 'Utilisateur désactivé' : 'User deactivated'),
          'success'
        );
      }
    } catch (error) {
      showNotification(error.message || 'حدث خطأ أثناء تحديث الحالة', 'error');
    } finally {
      setLocalLoading(false);
    }
  };

  const handleDeleteUser = async (userId, userName) => {
    const confirmed = window.confirm(
      language === 'ar' ? `هل أنت متأكد من حذف ${userName}؟`
      : language === 'fr' ? `Supprimer ${userName} ?`
      : `Delete ${userName}?`
    );

    if (confirmed) {
      try {
        await deleteUser(userId);
        setLocalUsers(prev => prev.filter(u => u.id !== userId));
        triggerAndroidCapture('USER_DELETED', { userId });

        showNotification(
          language === 'ar' ? 'تم حذف المستخدم'
          : language === 'fr' ? 'Utilisateur supprimé'
          : 'User deleted',
          'success'
        );
      } catch (error) {
        showNotification(error.message, 'error');
      }
    }
  };

  // تصفية المستخدمين بناءً على مصفوفة الحسابات المستقلة
  const filteredUsers = localUsers.filter(u => {
    const searchLower = searchTerm.toLowerCase();
    return (
      (u.company_name && u.company_name.toLowerCase().includes(searchLower)) ||
      (u.name && u.name.toLowerCase().includes(searchLower)) ||
      (u.email && u.email.toLowerCase().includes(searchLower)) ||
      (u.phone && u.phone.includes(searchLower))
    );
  });

  const adminStats = {
    totalUsers: localUsers.length,
    activeUsers,
    totalDebts: localUsers.reduce((sum, u) => {
      const userDebts = JSON.parse(localStorage.getItem(`user_${u.id}_debts`) || '[]');
      return sum + userDebts.length;
    }, 0)
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pb-8" dir={language === 'ar' ? 'rtl' : 'ltr'}>
      {/* Header */}
      <header className="bg-gradient-to-r from-purple-600 to-indigo-700 text-white p-4 sticky top-0 z-10 shadow-lg">
        <div className="flex items-center gap-3 mb-2">
          <button
            onClick={() => navigate('/')}
            className="p-2 rounded-xl hover:bg-white/20 transition"
          >
            <ArrowLeft className={`w-5 h-5 ${language === 'ar' ? 'rotate-180' : ''}`} />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold">{t('admin')} (Nawh AI)</h1>
            <p className="text-purple-200 text-sm">{user?.email}</p>
          </div>
          <div className="p-2 rounded-xl bg-white/20">
            <Shield className="w-5 h-5" />
          </div>
        </div>
      </header>

      {/* Statistics Cards */}
      <div className="px-4 mt-4">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border-l-4 border-purple-500">
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-5 h-5 text-purple-500" />
              <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">{t('totalUsers')}</span>
            </div>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{adminStats.totalUsers}</p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border-l-4 border-emerald-500">
            <div className="flex items-center gap-2 mb-2">
              <UserCheck className="w-5 h-5 text-emerald-500" />
              <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">{t('activeUsers')}</span>
            </div>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{adminStats.activeUsers}</p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border-l-4 border-blue-500 col-span-2 md:col-span-1">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="w-5 h-5 text-blue-500" />
              <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">{t('totalDebts')}</span>
            </div>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{adminStats.totalDebts}</p>
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div className="px-4 mb-4">
        <div className="relative">
          <Search className={`absolute top-3 w-5 h-5 text-gray-400 ${language === 'ar' ? 'right-3' : 'left-3'}`} />
          <input
            type="text"
            placeholder={language === 'ar' ? 'ابحث باسم الشركة، العميل، الهاتف أو البريد...' : 'Search company, name, phone or email...'}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={`w-full p-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 outline-none transition ${language === 'ar' ? 'pr-10' : 'pl-10'}`}
          />
        </div>
      </div>

      {/* Users & Companies List */}
      <div className="px-4">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm overflow-hidden border border-gray-100 dark:border-gray-700">
          <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
            <h2 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <Building2 className="w-5 h-5 text-purple-500" />
              {language === 'ar' ? 'الحسابات والشركات المسجلة' : 'Comptes & Entreprises'}
            </h2>
            <button
              onClick={fetchAdminUsers}
              disabled={localLoading}
              className="text-sm text-purple-500 hover:underline font-medium disabled:opacity-50"
            >
              {localLoading ? (language === 'ar' ? 'جاري التحميل...' : 'Chargement...') : (language === 'ar' ? 'تحديث الفوري' : 'Actualiser')}
            </button>
          </div>

          {filteredUsers.length > 0 ? (
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {filteredUsers.map(u => {
                const isUserActive = checkIsActive(u);
                
                // 🛑 تم التعديل لتطابق بياناتك المحمية:
                const isProtectedAdmin = u.is_admin || u.isAdmin || u.email === 'nawh@nawh.com' || u.name === 'admin301';

                return (
                  <div
                    key={u.id}
                    className="p-5 hover:bg-gray-50 dark:hover:bg-gray-750 transition"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      
                      {/* Left: Info & Branding */}
                      <div className="flex items-center gap-4 flex-1 min-w-0">
                        <div className={`w-14 h-14 rounded-xl flex items-center justify-center font-bold text-white text-lg shadow-sm shrink-0 ${
                          isUserActive
                            ? 'bg-gradient-to-br from-purple-500 to-indigo-600'
                            : 'bg-gray-400 dark:bg-gray-600'
                        }`}>
                          {((u.company_name?.[0] || u.companyName?.[0] || u.name?.[0] || u.email?.[0] || 'C')).toUpperCase()}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-extrabold text-base text-gray-900 dark:text-white truncate">
                              {u.company_name || u.companyName || u.name || 'شركة غير مسمى'}
                            </h3>
                            
                            {isProtectedAdmin && (
                              <span className="px-2 py-0.5 rounded text-xs font-bold bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400">
                                مدير النظام (Admin)
                              </span>
                            )}
                            
                            <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                              isUserActive 
                                ? 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400' 
                                : 'bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400'
                            }`}>
                              {isUserActive 
                                ? (language === 'ar' ? 'نشط' : 'Actif') 
                                : (language === 'ar' ? 'معطل' : 'Inactif')}
                            </span>
                          </div>

                          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 font-medium">
                            {language === 'ar' ? 'المدير:' : 'Admin:'} {u.name || 'لا يوجد'}
                          </p>
                          
                          <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400 mt-1 flex-wrap">
                            <span className="flex items-center gap-1">
                              <Mail className="w-3.5 h-3.5 shrink-0" />
                              <span className="truncate">{u.email}</span>
                            </span>

                            {u.phone && (
                              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-mono text-xs">
                                <Phone className="w-3 h-3 shrink-0" />
                                <span>{u.phone}</span>
                              </span>
                            )}
                          </div>

                          {(u.created_at || u.createdAt) && (
                            <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500 mt-1">
                              <Calendar className="w-3 h-3" />
                              <span>{language === 'ar' ? 'تاريخ التسجيل:' : 'Inscrit le :'} {formatDate(u.created_at || u.createdAt)}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Right: Controls */}
                      <div className="flex items-center gap-3 self-end sm:self-center shrink-0">
                        {/* زر مراسلة الواتساب مباشرة إذا كان للمستخدم رقم هاتف */}
                        {u.phone && (
                          <a
                            href={`https://wa.me/${u.phone.replace(/[^0-9]/g, '')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-2 rounded-xl bg-emerald-50 text-emerald-600 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400 transition"
                            title="مراسلة عبر الواتساب"
                          >
                            <MessageCircle className="w-4 h-4" />
                          </a>
                        )}

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={localLoading || isProtectedAdmin}
                            onClick={() => handleToggleStatus(u.id, u.active)}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:opacity-40 disabled:cursor-not-allowed ${
                              isUserActive ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'
                            }`}
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                isUserActive 
                                  ? (language === 'ar' ? '-translate-x-6' : 'translate-x-6') 
                                  : (language === 'ar' ? '-translate-x-1' : 'translate-x-1')
                              }`}
                            />
                          </button>
                        </div>

                        {!isProtectedAdmin && (
                          <button
                            onClick={() => handleDeleteUser(u.id, u.company_name || u.companyName || u.name || 'User')}
                            disabled={localLoading}
                            className="p-2 rounded-xl bg-gray-100 text-gray-600 hover:bg-red-100 hover:text-red-600 dark:bg-gray-700 dark:text-gray-400 dark:hover:bg-red-900/30 dark:hover:text-red-400 transition disabled:opacity-50"
                            title={t('deleteUser')}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>

                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-12 text-center">
              <Users className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
              <p className="text-gray-500 dark:text-gray-400 font-medium">
                {language === 'ar' ? 'لم يتم العثور على أي حسابات تطابق البحث' : t('noUsers')}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="text-center text-sm text-gray-400 dark:text-gray-500 mt-6">
        <p>Nawh AI Admin Panel v1.2.0</p>
      </div>
    </div>
  );
}
