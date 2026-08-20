import { useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Calendar,
  Phone,
  MessageCircle,
  Edit,
  CheckCircle,
  Clock,
  AlertTriangle,
  FileText,
  DollarSign,
  Share2,
  Copy,
  PlusCircle
} from 'lucide-react';
import { LocalNotifications } from '@capacitor/local-notifications';

/**
 * Debt Detail Page
 * Shows full debt information with actions: edit, mark paid, WhatsApp
 * Integrates with @capacitor/local-notifications for user feedback actions
 */
export default function DebtDetail() {
  const { t, debts, updateDebt, language, openWhatsApp, showNotification } = useApp();
  const navigate = useNavigate();
  const { id } = useParams();

  const [paymentAmount, setPaymentAmount] = useState('');

  const debt = debts.find(d => d.id === id);

  // دالة مساعدة لإرسال إشعارات محلية فورية عبر مكتبة Capacitor
  const sendLocalNotification = async (title, message) => {
    try {
      // التحقق من الإذن وطلبه إذا لم يكن ممنوحاً
      const permStatus = await LocalNotifications.checkPermissions();
      if (permStatus.display !== 'granted') {
        await LocalNotifications.requestPermissions();
      }

      // إطلاق الإشعار المحلي فوراً
      await LocalNotifications.schedule({
        notifications: [
          {
            title: title,
            body: message,
            id: Math.floor(Math.random() * 100000),
            schedule: { at: new Date(Date.now() + 500) }, // إطلاق فوري بعد نصف ثانية
            sound: 'default',
            actionTypeId: '',
            extra: null
          }
        ]
      });
    } catch (error) {
      console.error('Error sending local notification via Capacitor:', error);
    }
  };

  if (!debt) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
            <DollarSign className="w-10 h-10 text-gray-400" />
          </div>
          <p className="text-gray-500 dark:text-gray-400 mb-4">{t('noDebts')}</p>
          <button
            onClick={() => navigate('/debts')}
            className="px-6 py-3 bg-emerald-500 text-white rounded-xl font-bold hover:bg-emerald-600 transition"
          >
            {t('debts')}
          </button>
        </div>
      </div>
    );
  }

  const formatCurrency = (amount, currency) => {
    const locale = language === 'ar' ? 'ar-DZ' : language === 'fr' ? 'fr-FR' : 'en-US';
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency || 'DZD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  const formatDate = (dateString) => {
    const locale = language === 'ar' ? 'ar-DZ' : language === 'fr' ? 'fr-FR' : 'en-US';
    return new Date(dateString).toLocaleDateString(locale, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const dueDate = new Date(debt.dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isOverdue = dueDate < today && debt.status !== 'paid';
  const daysUntilDue = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));

  // WhatsApp reminder with LocalNotification trigger
  const handleWhatsApp = () => {
    const message = `${t('whatsappGreeting')}\n\n${t('whatsappBody')}\n${t('personName')}: ${debt.personName}\n${t('amount')}: ${formatCurrency(debt.amount, debt.currency)}\n${t('dueDate')}: ${formatDate(debt.dueDate)}${debt.notes ? '\n\n' + t('notes') + ': ' + debt.notes : ''}\n\n${t('whatsappClosing')}`;
    openWhatsApp(debt.phone || '', message);
    
    // إرسال إشعار محلي يفيد بفتح مشاركة الواتساب بنجاح
    const notifTitle = language === 'ar' ? 'تذكير الواتساب' : 'WhatsApp Reminder';
    const notifBody = language === 'ar' 
      ? `تم فتح محادثة لتذكير ${debt.personName} بمبلغ ${formatCurrency(debt.amount, debt.currency)}.`
      : `Opened WhatsApp chat to remind ${debt.personName} of ${formatCurrency(debt.amount, debt.currency)}.`;
    
    sendLocalNotification(notifTitle, notifBody);
  };

  // Mark as paid with LocalNotification trigger
  const markAsPaid = async () => {
    try {
      await updateDebt(debt.id, { status: 'paid' });
      showNotification(t('debtUpdated'), 'success');
      
      // إرسال إشعار محلي فوري يفيد بتحديث حالة الدين كمسدد بنجاح
      const notifTitle = language === 'ar' ? 'تحديث حالة الدين' : 'Debt Status Updated';
      const notifBody = language === 'ar'
        ? `تم تسوية الدين وتعيينه كمسدد بنجاح لصالح ${debt.personName}.`
        : `The debt for ${debt.personName} has been successfully marked as paid.`;
        
      sendLocalNotification(notifTitle, notifBody);
    } catch (error) {
      showNotification(error.message, 'error');
    }
  };

  // دالة التعامل مع إضافة قسط تسديد وخصمه من الأصل
  const handleAddPayment = async (e) => {
    e.preventDefault();
    const parsedPayment = parseFloat(paymentAmount);

    if (isNaN(parsedPayment) || parsedPayment <= 0) {
      showNotification(
        language === 'ar' ? 'يرجى إدخال مبلغ قسط صحيح' : 'Please enter a valid payment amount',
        'error'
      );
      return;
    }

    if (parsedPayment > debt.amount) {
      showNotification(
        language === 'ar' ? 'المبلغ المدخل أكبر من أصل الدين الحالي' : 'Payment amount exceeds current debt amount',
        'error'
      );
      return;
    }

    const newAmount = debt.amount - parsedPayment;
    const isFullyPaid = newAmount <= 0;

    try {
      await updateDebt(debt.id, {
        amount: newAmount,
        status: isFullyPaid ? 'paid' : debt.status
      });

      setPaymentAmount('');

      const successMsg = language === 'ar'
        ? `تم خصم قسط بقيمة ${formatCurrency(parsedPayment, debt.currency)} بنجاح.`
        : `Successfully deducted payment of ${formatCurrency(parsedPayment, debt.currency)}.`;
      
      showNotification(successMsg, 'success');

      const notifTitle = language === 'ar' ? 'تسديد قسط' : 'Partial Payment Made';
      const notifBody = language === 'ar'
        ? `تم خصم ${formatCurrency(parsedPayment, debt.currency)} من دين ${debt.personName}. المتبقي: ${formatCurrency(newAmount, debt.currency)}`
        : `Deducted ${formatCurrency(parsedPayment, debt.currency)} from ${debt.personName}. Remaining: ${formatCurrency(newAmount, debt.currency)}`;

      sendLocalNotification(notifTitle, notifBody);
    } catch (error) {
      showNotification(error.message, 'error');
    }
  };

  // Copy debt details
  const handleCopy = () => {
    const text = `${t('personName')}: ${debt.personName}\n${t('amount')}: ${formatCurrency(debt.amount, debt.currency)}\n${t('dueDate')}: ${formatDate(debt.dueDate)}\n${t('status')}: ${debt.status === 'paid' ? t('paid') : t('pending')}${debt.notes ? '\n' + t('notes') + ': ' + debt.notes : ''}`;
    navigator.clipboard.writeText(text);
    showNotification(language === 'ar' ? 'تما نسخ' : language === 'fr' ? 'Copié !' : 'Copied!', 'success');
  };

  const getStatusIcon = () => {
    if (debt.status === 'paid') return <CheckCircle className="w-6 h-6 text-emerald-500" />;
    if (isOverdue) return <AlertTriangle className="w-6 h-6 text-red-500" />;
    return <Clock className="w-6 h-6 text-yellow-500" />;
  };

  const getStatusColor = () => {
    if (debt.status === 'paid') return 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400';
    if (isOverdue) return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400';
    return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400';
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pb-28">
      {/* Header */}
      <header className={`p-4 text-white ${
        debt.type === 'owed_to_me'
          ? 'bg-gradient-to-br from-emerald-500 to-teal-600'
          : 'bg-gradient-to-br from-red-500 to-rose-600'
      }`}>
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-xl hover:bg-white/20 transition"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold flex-1">{debt.personName}</h1>
          <button
            onClick={() => navigate(`/debts/${id}/edit`)}
            className="p-2 rounded-xl hover:bg-white/20 transition"
          >
            <Edit className="w-5 h-5" />
          </button>
        </div>

        {/* Amount Display */}
        <div className="text-center py-8">
          <p className="text-white/80 text-sm mb-2">
            {debt.type === 'owed_to_me' ? t('owedToMe') : t('iOwe')}
          </p>
          <p className="text-5xl font-bold mb-4">
            {formatCurrency(debt.amount, debt.currency)}
          </p>
          <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold ${getStatusColor()}`}>
            {getStatusIcon()}
            {debt.status === 'paid'
              ? t('paid')
              : isOverdue
                ? t('overdue')
                : t('pending')}
          </div>
        </div>
      </header>

      {/* Details Cards */}
      <div className="p-4 space-y-4 -mt-4">
        {/* Payment Input Card */}
        {debt.status !== 'paid' && (
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-lg">
            <h3 className="font-bold text-gray-900 dark:text-white text-md mb-3 flex items-center gap-2">
              <PlusCircle className="w-5 h-5 text-emerald-500" />
              {language === 'ar' ? 'إضافة قسط تسديد' : language === 'fr' ? 'Ajouter un paiement' : 'Add Installment Payment'}
            </h3>
            <form onSubmit={handleAddPayment} className="flex gap-2">
              <input
                type="number"
                step="any"
                min="0.01"
                max={debt.amount}
                placeholder={language === 'ar' ? 'مبلغ القسط...' : 'Installment amount...'}
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                className="flex-1 px-4 py-3 rounded-xl bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
              />
              <button
                type="submit"
                className="px-5 py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-xl transition shadow-md"
              >
                {language === 'ar' ? 'خصم' : language === 'fr' ? 'Déduire' : 'Deduct'}
              </button>
            </form>
          </div>
        )}

        {/* Type Card */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-lg">
          <div className="flex items-center gap-4">
            <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${
              debt.type === 'owed_to_me'
                ? 'bg-emerald-100 dark:bg-emerald-900/30'
                : 'bg-red-100 dark:bg-red-900/30'
            }`}>
              {debt.type === 'owed_to_me' ? (
                <TrendingUp className="w-7 h-7 text-emerald-500" />
              ) : (
                <TrendingDown className="w-7 h-7 text-red-500" />
              )}
            </div>
            <div className="flex-1">
              <p className="text-sm text-gray-500 dark:text-gray-400">{t('debtType')}</p>
              <p className="font-bold text-gray-900 dark:text-white text-lg">
                {debt.type === 'owed_to_me' ? t('owedToMe') : t('iOwe')}
              </p>
            </div>
          </div>
        </div>

        {/* Due Date Card */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-lg">
          <div className="flex items-center gap-4">
            <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${
              isOverdue ? 'bg-red-100 dark:bg-red-900/30' : 'bg-blue-100 dark:bg-blue-900/30'
            }`}>
              <Calendar className={`w-7 h-7 ${isOverdue ? 'text-red-500' : 'text-blue-500'}`} />
            </div>
            <div className="flex-1">
              <p className="text-sm text-gray-500 dark:text-gray-400">{t('dueDate')}</p>
              <p className="font-bold text-gray-900 dark:text-white">
                {formatDate(debt.dueDate)}
              </p>
            </div>
            {debt.status !== 'paid' && (
              <div className={`text-right ${
                isOverdue ? 'text-red-500' : 'text-yellow-600 dark:text-yellow-400'
              }`}>
                <p className="text-2xl font-bold">
                  {isOverdue ? Math.abs(daysUntilDue) : daysUntilDue}
                </p>
                <p className="text-xs font-medium">
                  {isOverdue
                    ? (language === 'ar' ? 'يوم متأخر' : language === 'fr' ? 'jours de retard' : 'days overdue')
                    : (language === 'ar' ? 'يوم متبقي' : language === 'fr' ? 'jours restants' : 'days left')}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Phone Card */}
        {debt.phone && (
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-lg">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                <Phone className="w-7 h-7 text-purple-500" />
              </div>
              <div className="flex-1">
                <p className="text-sm text-gray-500 dark:text-gray-400">{t('phone')}</p>
                <p className="font-bold text-gray-900 dark:text-white text-lg" dir="ltr">
                  {debt.phone}
                </p>
              </div>
              <a
                href={`tel:${debt.phone}`}
                className="p-3 rounded-xl bg-blue-100 dark:bg-blue-900/30 text-blue-500 hover:bg-blue-200 dark:hover:bg-blue-900/50 transition"
              >
                <Phone className="w-6 h-6" />
              </a>
            </div>
          </div>
        )}

        {/* Notes Card */}
        {debt.notes && (
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-lg">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 rounded-xl bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                <FileText className="w-7 h-7 text-gray-500" />
              </div>
              <div className="flex-1">
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">{t('notes')}</p>
                <p className="text-gray-900 dark:text-white whitespace-pre-wrap">
                  {debt.notes}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Creation Info */}
        <div className="text-center text-sm text-gray-400 dark:text-gray-500 py-2">
          {t('recentActivity')}: {formatDate(debt.createdAt)}
        </div>

        {/* Copy Button */}
        <button
          onClick={handleCopy}
          className="w-full py-3 rounded-xl border-2 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition flex items-center justify-center gap-2"
        >
          <Copy className="w-5 h-5" />
          {language === 'ar' ? 'انسخ التفاصيل' : language === 'fr' ? 'Copier les détails' : 'Copy Details'}
        </button>
      </div>

      {/* Fixed Action Buttons */}
      <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 p-4 shadow-lg">
        <div className="flex gap-3 max-w-md mx-auto">
          {debt.status !== 'paid' && (
            <button
              onClick={markAsPaid}
              className="flex-1 py-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-bold shadow-lg hover:shadow-xl transition flex items-center justify-center gap-2"
            >
              <CheckCircle className="w-5 h-5" />
              {t('markAsPaid')}
            </button>
          )}
          {debt.phone && (
            <button
              onClick={handleWhatsApp}
              className="py-4 px-6 rounded-xl bg-green-500 text-white font-bold shadow-lg hover:bg-green-600 transition flex items-center justify-center gap-2"
            >
              <MessageCircle className="w-5 h-5" />
              WhatsApp
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
