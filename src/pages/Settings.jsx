import { useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Sun,
  Moon,
  Globe,
  Bell,
  MessageCircle,
  LogOut,
  ChevronRight,
  ChevronLeft,
  Smartphone,
  Trash,
  User,
  HelpCircle,
  Download,
  FileText
} from 'lucide-react';
import { LocalNotifications } from '@capacitor/local-notifications';
import jsPDF from 'jspdf';
import 'jspdf-autotable';

/**
 * Settings Page
 * Dark mode, language switching, notifications control, account settings
 * Real PDF generation from database for cash clients with outstanding debts
 */
export default function Settings() {
  const {
    t,
    user,
    debts,
    darkMode,
    setDarkMode,
    language,
    setLanguage,
    notificationsEnabled,
    setNotificationsEnabled,
    whatsappEnabled,
    setWhatsappEnabled,
    logout,
    requestNotificationPermission,
    showNotification
  } = useApp();
  const navigate = useNavigate();

  const handleNotificationToggle = async () => {
    if (!notificationsEnabled) {
      const granted = await requestNotificationPermission();
      if (granted) {
        setNotificationsEnabled(true);
        showNotification(t('enableNotifications'), 'success');

        try {
          const hasPermission = await LocalNotifications.checkPermissions();
          if (hasPermission.display === 'granted') {
            await LocalNotifications.schedule({
              notifications: [
                {
                  title: language === 'ar' ? 'تم تفعيل إشعارات الديون' : 'Debt Notifications Enabled',
                  body: language === 'ar' ? 'ستصلك تنبيهات عند إضافة دين جديد، أو سداد، أو إرسال رسائل الواتساب.' : 'You will receive notifications for new debts, payments, and WhatsApp messages.',
                  id: 1,
                  schedule: { at: new Date(Date.now() + 1000) },
                  sound: null,
                  attachments: null,
                  actionTypeId: "",
                  extra: {
                    actions: ['add_debt', 'pay_debt', 'send_whatsapp']
                  }
                }
              ]
            });
          }
        } catch (error) {
          console.error('Error scheduling local notification:', error);
        }
      } else {
        showNotification(
          language === 'ar' ? 'ما قدرناش نفعّلو الإشعارات' :
          language === 'fr' ? 'Autorisation refusée' : 'Permission denied', 
          'error'
        );
      }
    } else {
      setNotificationsEnabled(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  // دالة إنشاء وتحميل ملف PDF حقيقي من قاعدة البيانات للعملاء الذين عليهم ديون غير مسددة
  const handleDownloadPDF = () => {
    try {
      const pendingDebts = (debts || []).filter(d => d.status !== 'paid');

      if (pendingDebts.length === 0) {
        showNotification(
          language === 'ar' ? 'لا توجد ديون غير مسددة لتصديرها' : 'No pending debts found to export',
          'error'
        );
        return;
      }

      const doc = new jsPDF({
        orientation: 'p',
        unit: 'mm',
        format: 'a4'
      });

      const isAr = language === 'ar';
      const title = isAr ? 'تقرير ديون العملاء غير المسددة' : 'Outstanding Debts Report';
      const dateStr = new Date().toLocaleDateString();

      // عنوان التقرير
      doc.setFontSize(18);
      doc.text(title, 105, 15, { align: 'center' });
      doc.setFontSize(10);
      doc.text(`${isAr ? 'التاريخ' : 'Date'}: ${dateStr}`, 105, 22, { align: 'center' });

      // تحضير أعمدة وصفوف الجدول
      const tableColumn = isAr 
        ? ['الملاحظات', 'تاريخ الاستحقاق', 'المبلغ', 'نوع الدين', 'اسم العميل']
        : ['Customer Name', 'Debt Type', 'Amount', 'Due Date', 'Notes'];

      const tableRows = pendingDebts.map(debt => {
        const typeLabel = debt.type === 'owed_to_me' 
          ? (isAr ? 'له (مستحق)' : 'Owed to me') 
          : (isAr ? 'عليه (مطلوب)' : 'I owe');
          
        return isAr ? [
          debt.notes || '-',
          new Date(debt.dueDate).toLocaleDateString(),
          `${debt.amount} ${debt.currency || 'DZD'}`,
          typeLabel,
          debt.personName
        ] : [
          debt.personName,
          typeLabel,
          `${debt.amount} ${debt.currency || 'DZD'}`,
          new Date(debt.dueDate).toLocaleDateString(),
          debt.notes || '-'
        ];
      });

      // رسم الجدول بالبيانات المجلوبة
      doc.autoTable({
        head: [tableColumn],
        body: tableRows,
        startY: 30,
        styles: { halign: isAr ? 'right' : 'left', fontStyle: 'bold' },
        headStyles: { fillColor: [16, 185, 129] } // لون زمردي متناسق مع الواجهة
      });

      // حفظ وتحميل ملف الـ PDF
      doc.save(`debts_report_${Date.now()}.pdf`);

      showNotification(
        isAr ? 'تم تحميل تقرير PDF بنجاح' : 'PDF report downloaded successfully',
        'success'
      );
    } catch (error) {
      console.error('Error generating PDF:', error);
      showNotification(
        language === 'ar' ? 'حدث خطأ أثناء إنشاء ملف PDF' : 'Error generating PDF file',
        'error'
      );
    }
  };

  const languages = [
    { code: 'ar', name: language === 'ar' ? 'العربية' : 'Arabic', flag: '🇸🇦', subtitle: language === 'ar' ? 'مرحباً بك!' : 'Marhaba!' },
    { code: 'fr', name: t('french'), flag: '🇫🇷', subtitle: 'Bonjour!' },
    { code: 'en', name: t('english'), flag: '🇬🇧', subtitle: 'Hello!' }
  ];

  const isRtl = language === 'ar';

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pb-8" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Header */}
      <header className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white p-4 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="p-2 rounded-xl hover:bg-white/20 transition"
          >
            <ArrowLeft className={`w-5 h-5 ${isRtl ? 'rotate-180' : ''}`} />
          </button>
          <h1 className="text-xl font-bold">{t('settings')}</h1>
        </div>
      </header>

      <div className="p-4 space-y-4">
        {/* Profile Section */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-lg">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-white text-2xl font-bold shadow-lg">
              {(user?.name?.[0] || user?.email?.[0] || 'U').toUpperCase()}
            </div>
            <div className="flex-1">
              <h2 className="font-bold text-gray-900 dark:text-white text-lg">
                {user?.name || 'User'}
              </h2>
              <p className="text-gray-500 dark:text-gray-400 text-sm">
                {user?.email}
              </p>
            </div>
            <div className="p-2 rounded-xl bg-gray-100 dark:bg-gray-700">
              <User className="w-5 h-5 text-gray-500" />
            </div>
          </div>
        </div>

        {/* Appearance Section */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
            <h3 className="font-bold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider text-start">
              {t('appearance')}
            </h3>
          </div>

          {/* Dark Mode Toggle */}
          <button
            onClick={() => setDarkMode(!darkMode)}
            className="w-full px-5 py-4 flex items-center gap-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition"
          >
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
              darkMode ? 'bg-gray-700' : 'bg-yellow-100'
            }`}>
              {darkMode ? (
                <Moon className="w-6 h-6 text-yellow-400" />
              ) : (
                <Sun className="w-6 h-6 text-yellow-600" />
              )}
            </div>
            <div className="flex-1 text-start">
              <p className="font-bold text-gray-900 dark:text-white">
                {darkMode ? t('darkMode') : t('lightMode')}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {darkMode
                  ? (language === 'ar' ? 'الوضع الداكن' : language === 'fr' ? 'Mode nuit' : 'Night mode')
                  : (language === 'ar' ? 'الوضع الفاتح' : language === 'fr' ? 'Mode jour' : 'Day mode')}
              </p>
            </div>
            <div className={`w-14 h-8 rounded-full transition-colors ${
              darkMode ? 'bg-emerald-500' : 'bg-gray-300'
            } relative`}>
              <div className={`absolute top-1 w-6 h-6 bg-white rounded-full shadow transition-transform ${
                darkMode ? (isRtl ? '-translate-x-7' : 'translate-x-7') : (isRtl ? '-translate-x-1' : 'translate-x-1')
              }`} />
            </div>
          </button>
        </div>

        {/* Language Section */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
            <h3 className="font-bold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider flex items-center gap-2 text-start">
              <Globe className="w-4 h-4" />
              {t('language')}
            </h3>
          </div>

          {languages.map((lang, index) => (
            <button
              key={lang.code}
              onClick={() => setLanguage(lang.code)}
              className={`w-full px-5 py-4 flex items-center gap-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition ${
                index !== languages.length - 1 ? 'border-b border-gray-100 dark:border-gray-700' : ''
              }`}
            >
              <div className="w-12 h-12 rounded-xl bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-2xl">
                {lang.flag}
              </div>
              <div className="flex-1 text-start">
                <p className="font-bold text-gray-900 dark:text-white">
                  {lang.name}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {lang.subtitle}
                </p>
              </div>
              {language === lang.code && (
                <div className="w-7 h-7 rounded-full bg-emerald-500 flex items-center justify-center">
                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
            </button>
          ))}
        </div>

        {/* Notifications Section */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
            <h3 className="font-bold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider text-start">
              {t('notifications')}
            </h3>
          </div>

          {/* Push/Local Notifications */}
          <div className="px-5 py-4 flex items-center gap-4 border-b border-gray-100 dark:border-gray-700">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
              notificationsEnabled ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-gray-100 dark:bg-gray-700'
            }`}>
              <Bell className={`w-6 h-6 ${
                notificationsEnabled ? 'text-emerald-500' : 'text-gray-400'
              }`} />
            </div>
            <div className="flex-1 text-start">
              <p className="font-bold text-gray-900 dark:text-white">
                {t('enableNotifications')}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {notificationsEnabled
                  ? (language === 'ar' ? 'مفعّل' : language === 'fr' ? 'Activé' : 'Enabled')
                  : (language === 'ar' ? 'معطّل' : language === 'fr' ? 'Désactivé' : 'Disabled')}
              </p>
            </div>
            <button
              onClick={handleNotificationToggle}
              className={`w-14 h-8 rounded-full transition-colors ${
                notificationsEnabled ? 'bg-emerald-500' : 'bg-gray-300'
              } relative`}
            >
              <div className={`absolute top-1 w-6 h-6 bg-white rounded-full shadow transition-transform ${
                notificationsEnabled ? (isRtl ? '-translate-x-7' : 'translate-x-7') : (isRtl ? '-translate-x-1' : 'translate-x-1')
              }`} />
            </button>
          </div>

          {/* WhatsApp Reminder */}
          <div className="px-5 py-4 flex items-center gap-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
              whatsappEnabled ? 'bg-green-100 dark:bg-green-900/30' : 'bg-gray-100 dark:bg-gray-700'
            }`}>
              <MessageCircle className={`w-6 h-6 ${
                whatsappEnabled ? 'text-green-500' : 'text-gray-400'
              }`} />
            </div>
            <div className="flex-1 text-start">
              <p className="font-bold text-gray-900 dark:text-white">
                {t('enableWhatsapp')}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {whatsappEnabled
                  ? (language === 'ar' ? 'مفعّل' : language === 'fr' ? 'Activé' : 'Enabled')
                  : (language === 'ar' ? 'معطّل' : language === 'fr' ? 'Désactivé' : 'Disabled')}
              </p>
            </div>
            <button
              onClick={() => setWhatsappEnabled(!whatsappEnabled)}
              className={`w-14 h-8 rounded-full transition-colors ${
                whatsappEnabled ? 'bg-emerald-500' : 'bg-gray-300'
              } relative`}
            >
              <div className={`absolute top-1 w-6 h-6 bg-white rounded-full shadow transition-transform ${
                whatsappEnabled ? (isRtl ? '-translate-x-7' : 'translate-x-7') : (isRtl ? '-translate-x-1' : 'translate-x-1')
              }`} />
            </button>
          </div>
        </div>

        {/* App Info Section */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
            <h3 className="font-bold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider text-start">
              {language === 'ar' ? 'التطبيق' : language === 'fr' ? 'Application' : 'Application'}
            </h3>
          </div>

          {/* App Version */}
          <div className="px-5 py-4 flex items-center gap-4 border-b border-gray-100 dark:border-gray-700">
            <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <Smartphone className="w-6 h-6 text-blue-500" />
            </div>
            <div className="flex-1 text-start">
              <p className="font-bold text-gray-900 dark:text-white">Debts Manager</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">v1.0.0</p>
            </div>
          </div>

          {/* Help */}
          <button className="w-full px-5 py-4 flex items-center gap-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition">
            <div className="w-12 h-12 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
              <HelpCircle className="w-6 h-6 text-purple-500" />
            </div>
            <div className="flex-1 text-start">
              <p className="font-bold text-gray-900 dark:text-white">{t('contactSupport')}</p>
            </div>
            {isRtl ? <ChevronLeft className="w-5 h-5 text-gray-400" /> : <ChevronRight className="w-5 h-5 text-gray-400" />}
          </button>
        </div>

        {/* PDF Export Section Only */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg overflow-hidden p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="font-bold text-gray-900 dark:text-white text-lg text-start">
                {language === 'ar' ? 'تصدير تقرير الديون' : language === 'fr' ? 'Exporter le rapport des dettes' : 'Export Debts Report'}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 text-start">
                {language === 'ar' ? 'تصدير كافة الديون غير المسددة كملف PDF' : language === 'fr' ? 'Télécharger les dettes non payées sous forme de PDF' : 'Download all pending debts as PDF'}
              </p>
            </div>

            <button
              onClick={handleDownloadPDF}
              className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold transition shadow-md hover:shadow-lg active:scale-95"
            >
              <Download className="w-5 h-5" />
              <span>{language === 'ar' ? 'تحميل جدول PDF' : language === 'fr' ? 'Télécharger PDF' : 'Download PDF'}</span>
            </button>
          </div>
        </div>

        {/* Logout Button */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg overflow-hidden">
          <button
            onClick={handleLogout}
            className="w-full px-5 py-4 flex items-center gap-4 hover:bg-red-50 dark:hover:bg-red-900/20 transition text-red-500"
          >
            <div className="w-12 h-12 rounded-xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <LogOut className="w-6 h-6" />
            </div>
            <div className="flex-1 text-start">
              <p className="font-bold text-lg">
                {t('logout')}
              </p>
            </div>
            {isRtl ? <ChevronLeft className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
          </button>
        </div>

        {/* Clear Data */}
        <button
          onClick={() => {
            if (window.confirm(t('confirmDelete'))) {
              localStorage.clear();
              window.location.reload();
            }
          }}
          className="w-full py-4 rounded-2xl border-2 border-red-500 text-red-500 font-bold hover:bg-red-50 dark:hover:bg-red-900/20 transition flex items-center justify-center gap-3"
        >
          <Trash className="w-5 h-5" />
          {t('clearData')}
        </button>
      </div>
    </div>
  );
}
