import { useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { useNavigate } from 'react-router-dom';
import { Wallet, Eye, EyeOff, User, Mail, Lock, Phone, Building2 } from 'lucide-react';

/**
 * Authentication Page
 * Direct API Call Version for Debugging
 */
export default function Auth() {
  const { t, login, showNotification, language } = useApp();
  const navigate = useNavigate();
  const [isLogin, setIsLogin] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [loadingLocal, setLoadingLocal] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    companyName: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: ''
  });
  const [errors, setErrors] = useState({});

  const validateForm = () => {
    const newErrors = {};

    if (!formData.email || !formData.email.includes('@')) {
      newErrors.email = language === 'ar' ? 'البريد الإلكتروني غير صالح' :
                        language === 'fr' ? 'Email invalide' : 'Invalid email';
    }

    if (!formData.password || formData.password.length < 4) {
      newErrors.password = language === 'ar' ? 'كلمة المرور قصيرة جداً' :
                           language === 'fr' ? 'Mot de passe trop court' : 'Password too short';
    }

    if (!isLogin) {
      if (!formData.name) {
        newErrors.name = language === 'ar' ? 'الاسم مطلوب' :
                         language === 'fr' ? 'Nom requis' : 'Name required';
      }

      if (!formData.companyName) {
        newErrors.companyName = language === 'ar' ? 'اسم الشركة مطلوب' :
                                language === 'fr' ? 'Nom de l\'entreprise requis' : 'Company name required';
      }

      if (formData.password !== formData.confirmPassword) {
        newErrors.confirmPassword = language === 'ar' ? 'كلمتا المرور غير متطابقتين' :
                                    language === 'fr' ? 'Mots de passe différents' : 'Passwords do not match';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) return;
    setLoadingLocal(true);
    setErrors({});

    try {
      let loggedUser = null;

      if (isLogin) {
        loggedUser = await login(formData.email, formData.password);
      } else {
        const targetUrl = 'https://my-dept-2.vercel.app/api/register-user';
        console.log('🚀 جاري إرسال الطلب إلى:', targetUrl);
        console.log('📦 البيانات المرسلة:', {
          name: formData.name,
          companyName: formData.companyName,
          email: formData.email,
          password: formData.password,
          phone: formData.phone
        });

        // استدعاء مباشر ومستقل تماماً بدون Context
        const response = await fetch(targetUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            name: formData.name,
            companyName: formData.companyName,
            email: formData.email,
            password: formData.password,
            phone: formData.phone
          })
        });

        console.log('📡 كود استجابة السيرفر Status:', response.status);

        const data = await response.json();
        console.log('📥 البيانات المستقبلة من السيرفر:', data);

        if (!response.ok) {
          throw new Error(data.error || `خطأ من السيرفر برقم: ${response.status}`);
        }

        loggedUser = data.user;
        if (showNotification) {
          showNotification('تم إنشاء الحساب بنجاح', 'success');
        }
      }

      if (
        loggedUser?.is_active === false || 
        loggedUser?.status === 'disabled' || 
        loggedUser?.is_disabled === true ||
        loggedUser?.status === 'inactive'
      ) {
        setErrors({ submit: 'ACCOUNT_DISABLED' });
        setLoadingLocal(false);
        return;
      }

      const cleanEmail = formData.email.trim().toLowerCase();
      const cleanName = formData.name ? formData.name.trim() : '';

      const isSystemAdmin = 
        cleanEmail === 'nawh@nawh.com' || 
        cleanEmail === 'admin@debts.dz' || 
        cleanName === 'admin301' ||
        loggedUser?.is_admin === true ||
        loggedUser?.isAdmin === true;

      if (isSystemAdmin) {
        navigate('/admin');
      } else {
        navigate('/');
      }
    } catch (error) {
      console.error('❌ تفاصيل الخطأ الكلية (Catch):', error);
      const errorMsg = error.message || '';
      
      if (
        errorMsg.toLowerCase().includes('disabled') || 
        errorMsg.includes('معطل') || 
        errorMsg.includes('غلق') ||
        errorMsg.toLowerCase().includes('banned') ||
        errorMsg.toLowerCase().includes('inactive')
      ) {
        setErrors({ submit: 'ACCOUNT_DISABLED' });
      } else {
        setErrors({ submit: `فشل الاتصال: ${errorMsg}` });
      }
    } finally {
      setLoadingLocal(false);
    }
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const toggleMode = () => {
    setIsLogin(!isLogin);
    setErrors({});
    setFormData({
      name: '',
      companyName: '',
      email: formData.email,
      phone: '',
      password: '',
      confirmPassword: ''
    });
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return t('goodMorning');
    if (hour < 18) return t('hello');
    return t('goodEvening');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 shadow-2xl mb-4 transform hover:scale-105 transition-transform">
            <Wallet className="w-12 h-12 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            {t('appName')}
          </h1>
          <p className="text-gray-600 dark:text-gray-400 text-lg">
            {getGreeting()}
          </p>
          <p className="text-emerald-600 dark:text-emerald-400 font-medium mt-1">
            {isLogin ? t('loginTitle') : t('registerTitle')}
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl overflow-hidden">
          <div className="flex border-b border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={() => !isLogin && setIsLogin(true)}
              className={`flex-1 py-4 text-center font-semibold transition ${
                isLogin
                  ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 border-b-2 border-emerald-500'
                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              {t('login')}
            </button>
            <button
              type="button"
              onClick={() => isLogin && setIsLogin(false)}
              className={`flex-1 py-4 text-center font-semibold transition ${
                !isLogin
                  ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 border-b-2 border-emerald-500'
                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              {t('register')}
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            {!isLogin && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  <User className="inline w-4 h-4 mr-2" />
                  {t('name')}
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => handleChange('name', e.target.value)}
                  className={`w-full px-4 py-3.5 rounded-xl border-2 ${
                    errors.name
                      ? 'border-red-500 bg-red-50 dark:bg-red-900/20'
                      : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700'
                  } text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all`}
                  placeholder={language === 'ar' ? 'اسمك' : language === 'fr' ? 'Votre nom' : 'Your name'}
                />
                {errors.name && (
                  <p className="mt-2 text-sm text-red-500 dark:text-red-400">{errors.name}</p>
                )}
              </div>
            )}

            {!isLogin && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  <Building2 className="inline w-4 h-4 mr-2" />
                  {language === 'ar' ? 'اسم الشركة' : language === 'fr' ? 'Nom de l\'entreprise' : 'Company Name'}
                </label>
                <input
                  type="text"
                  value={formData.companyName}
                  onChange={(e) => handleChange('companyName', e.target.value)}
                  className={`w-full px-4 py-3.5 rounded-xl border-2 ${
                    errors.companyName
                      ? 'border-red-500 bg-red-50 dark:bg-red-900/20'
                      : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700'
                  } text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all`}
                  placeholder={language === 'ar' ? 'اسم شركتك أو نشاطك التجاري' : language === 'fr' ? 'Nom de votre entreprise' : 'Your company name'}
                />
                {errors.companyName && (
                  <p className="mt-2 text-sm text-red-500 dark:text-red-400">{errors.companyName}</p>
                )}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                <Mail className="inline w-4 h-4 mr-2" />
                {t('email')}
              </label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => handleChange('email', e.target.value)}
                className={`w-full px-4 py-3.5 rounded-xl border-2 ${
                  errors.email
                    ? 'border-red-500 bg-red-50 dark:bg-red-900/20'
                    : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700'
                } text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all`}
                placeholder="example@email.com"
                dir="ltr"
              />
              {errors.email && (
                <p className="mt-2 text-sm text-red-500 dark:text-red-400">{errors.email}</p>
              )}
            </div>

            {!isLogin && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  <Phone className="inline w-4 h-4 mr-2" />
                  {t('phone')}
                </label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => handleChange('phone', e.target.value)}
                  className="w-full px-4 py-3.5 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                  placeholder={language === 'ar' ? 'رقم الهاتف (اختياري)' : '+213...'}
                  dir="ltr"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                <Lock className="inline w-4 h-4 mr-2" />
                {t('password')}
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={formData.password}
                  onChange={(e) => handleChange('password', e.target.value)}
                  className={`w-full px-4 py-3.5 pr-12 rounded-xl border-2 ${
                    errors.password
                      ? 'border-red-500 bg-red-50 dark:bg-red-900/20'
                      : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700'
                  } text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all`}
                  placeholder={language === 'ar' ? 'كلمة مرور قوية' : '••••••••'}
                  dir="ltr"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
              {errors.password && (
                <p className="mt-2 text-sm text-red-500 dark:text-red-400">{errors.password}</p>
              )}
            </div>

            {!isLogin && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  <Lock className="inline w-4 h-4 mr-2" />
                  {t('confirmPassword')}
                </label>
                <input
                  type="password"
                  value={formData.confirmPassword}
                  onChange={(e) => handleChange('confirmPassword', e.target.value)}
                  className={`w-full px-4 py-3.5 rounded-xl border-2 ${
                    errors.confirmPassword
                      ? 'border-red-500 bg-red-50 dark:bg-red-900/20'
                      : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700'
                  } text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all`}
                  placeholder="••••••••"
                  dir="ltr"
                />
                {errors.confirmPassword && (
                  <p className="mt-2 text-sm text-red-500 dark:text-red-400">{errors.confirmPassword}</p>
                )}
              </div>
            )}

            {errors.submit && (
              <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-center">
                <p className="font-semibold">{errors.submit}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loadingLocal}
              className="w-full py-4 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-bold text-lg shadow-lg hover:from-emerald-600 hover:to-teal-700 focus:ring-4 focus:ring-emerald-300 dark:focus:ring-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:scale-[1.02] active:scale-[0.98]"
            >
              {loadingLocal ? (
                <span className="flex items-center justify-center gap-3">
                  <div className="w-6 h-6 border-3 border-white border-t-transparent rounded-full animate-spin" />
                  {t('loading')}
                </span>
              ) : (
                isLogin ? t('login') : t('register')
              )}
            </button>

            <div className="text-center pt-4 border-t border-gray-100 dark:border-gray-700">
              <p className="text-gray-500 dark:text-gray-400">
                {isLogin ? t('noAccount') : t('hasAccount')}
                <button
                  type="button"
                  onClick={toggleMode}
                  className="mr-2 font-bold text-emerald-600 dark:text-emerald-400 hover:underline"
                >
                  {isLogin ? t('register') : t('login')}
                </button>
              </p>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
