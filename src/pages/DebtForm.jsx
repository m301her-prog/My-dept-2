import { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Save,
  Calendar,
  User,
  DollarSign,
  FileText,
  Phone,
  Trash2,
  AlertCircle,
  Info,
  Clock,
  Repeat,
  PlusCircle,
  CheckCircle2,
  Plus
} from 'lucide-react';
import { currencies as contextCurrencies } from '../i18n/translations.jsx';
import { LocalNotifications } from '@capacitor/local-notifications';

// قائمة بأشهر العملات مع أسمائها بالعربية
const POPULAR_CURRENCIES = [
  { code: 'DZD', name: 'دينار جزائري (DZD)' },
  { code: 'USD', name: 'دولار أمريكي (USD)' },
  { code: 'EUR', name: 'يورو (EUR)' },
  { code: 'SAR', name: 'ريال سعودي (SAR)' },
  { code: 'AED', name: 'درهم إماراتي (AED)' },
  { code: 'EGP', name: 'جنيه مصري (EGP)' },
  { code: 'MAD', name: 'درهم مغربي (MAD)' },
  { code: 'TND', name: 'دينار تونسي (TND)' },
  { code: 'QAR', name: 'ريال قطري (QAR)' },
  { code: 'KWD', name: 'دينار كويتي (KWD)' },
  { code: 'BHD', name: 'دينار بحريني (BHD)' },
  { code: 'OMR', name: 'ريال عماني (OMR)' },
  { code: 'GBP', name: 'جنيه إسترليني (GBP)' },
  { code: 'CAD', name: 'دولار كندي (CAD)' },
  { code: 'AUD', name: 'دولار أسترالي (AUD)' },
  { code: 'JPY', name: 'ين ياباني (JPY)' },
  { code: 'CHF', name: 'فرنك سويسري (CHF)' }
];

/**
 * Debt Form Page
 * Handles both adding and editing debts
 * Uses standard crypto.randomUUID for robust unique ID generation
 */
export default function DebtForm() {
  const { t, addDebt, updateDebt, deleteDebt, debts, showNotification, loading, language } = useApp();
  const navigate = useNavigate();
  const { id } = useParams();
  const isEditing = !!id;

  const existingDebt = isEditing ? debts.find(d => d.id === id) : null;

  // دمج عملات السياق مع القائمة المحددة وتصفية التكرارات بناءً على كود العملة
  const extraCurrencies = (contextCurrencies || [])
    .filter(c => !POPULAR_CURRENCIES.some(pc => pc.code === c))
    .map(c => ({ code: c, name: c }));

  const allCurrencies = [...POPULAR_CURRENCIES, ...extraCurrencies];

  // دالة موحدة ومعتمدة لتوليد ID فريد ومستقر لضمان حذف البيانات بشكل آمن
  const generateUniqueId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'debt_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 9);
  };

  const [formData, setFormData] = useState({
    type: 'owed_to_me',
    personName: '',
    phone: '',
    amount: '',
    currency: 'DZD',
    dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    notes: '',
    status: 'pending',
    isScheduled: false,
    scheduleType: 'monthly',
    installmentsCount: '',
    firstPaymentDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    scheduleData: null
  });

  const [errors, setErrors] = useState({});
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showScheduleCard, setShowScheduleCard] = useState(false);

  // إدارة الدفعات المضافة والمسددة داخلياً في الشاشة
  const [paymentsList, setPaymentsList] = useState([]);
  const [newPayment, setNewPayment] = useState({ amount: '', type: 'record' });

  // دالة مساعدة لإرسال إشعارات محلية فورية عبر مكتبة Capacitor
  const sendAndroidNotification = async (title, message) => {
    try {
      const permStatus = await LocalNotifications.checkPermissions();
      if (permStatus.display !== 'granted') {
        await LocalNotifications.requestPermissions();
      }

      await LocalNotifications.schedule({
        notifications: [
          {
            title: title,
            body: message,
            id: Math.floor(Math.random() * 100000),
            schedule: { at: new Date(Date.now() + 500) },
            sound: 'default',
            actionTypeId: '',
            extra: null
          }
        ]
      });
    } catch (error) {
      console.error('Error sending local notification:', error);
    }
  };

  // Load existing debt data for editing
  useEffect(() => {
    if (existingDebt) {
      setFormData({
        type: existingDebt.type,
        personName: existingDebt.personName || existingDebt.person_name || '',
        phone: existingDebt.phone || '',
        amount: existingDebt.amount ? existingDebt.amount.toString() : '',
        currency: existingDebt.currency || 'DZD',
        dueDate: existingDebt.dueDate ? existingDebt.dueDate.split('T')[0] : (existingDebt.due_date ? existingDebt.due_date.split('T')[0] : ''),
        notes: existingDebt.notes || '',
        status: existingDebt.status || 'pending',
        isScheduled: existingDebt.isScheduled || existingDebt.is_scheduled || false,
        scheduleType: existingDebt.scheduleType || existingDebt.schedule_type || 'monthly',
        installmentsCount: (existingDebt.installmentsCount || existingDebt.installments_count)?.toString() || '',
        firstPaymentDate: existingDebt.firstPaymentDate || existingDebt.first_payment_date
          ? (existingDebt.firstPaymentDate || existingDebt.first_payment_date).split('T')[0]
          : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        scheduleData: existingDebt.scheduleData || null
      });
      setShowScheduleCard(existingDebt.isScheduled || existingDebt.is_scheduled || false);

      if (existingDebt.paymentsList || existingDebt.payments_list) {
        setPaymentsList(existingDebt.paymentsList || existingDebt.payments_list);
      }
    }
  }, [existingDebt]);

  // Validation
  const validate = () => {
    const newErrors = {};

    if (!formData.personName.trim()) {
      newErrors.personName = language === 'ar' ? 'الاسم مطلوب' :
                             language === 'fr' ? 'Le nom est requis' : 'Name is required';
    }

    if (!formData.amount || parseFloat(formData.amount) <= 0) {
      newErrors.amount = language === 'ar' ? 'المبلغ غير صالح' :
                         language === 'fr' ? 'Montant invalide' : 'Invalid amount';
    }

    if (!formData.dueDate) {
      newErrors.dueDate = language === 'ar' ? 'التاريخ مطلوب' :
                          language === 'fr' ? 'Date requise' : 'Date is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // معالجة إضافة/تسديد دفعة بـ ID فريد قياسي
  const handleAddPaymentAction = () => {
    const amt = parseFloat(newPayment.amount);
    if (!amt || amt <= 0) {
      showNotification(language === 'ar' ? 'الرجاء إدخال مبلغ دفعة صحيح' : 'Please enter a valid payment amount', 'error');
      return;
    }

    const paymentItem = {
      id: generateUniqueId(),
      amount: amt,
      type: newPayment.type,
      date: new Date().toISOString().split('T')[0]
    };

    setPaymentsList(prev => [paymentItem, ...prev]);

    const totalAmount = parseFloat(formData.amount) || 0;
    const paidAmount = [paymentItem, ...paymentsList]
      .filter(p => p.type === 'settle')
      .reduce((sum, p) => sum + p.amount, 0);
    const remainingAmount = Math.max(0, totalAmount - paidAmount);

    if (newPayment.type === 'record') {
      const msgAr = `تم تسجيل إضافة دفعة بمبلغ ${amt} ${formData.currency}. المتبقي الإجمالي: ${remainingAmount} ${formData.currency}. تاريخ الاستحقاق القادم: ${formData.dueDate}`;
      const msgEn = `Payment installment of ${amt} ${formData.currency} added. Total remaining: ${remainingAmount} ${formData.currency}. Next due: ${formData.dueDate}`;

      showNotification(language === 'ar' ? `تم تسجيل إضافة دفعة بمبلغ ${amt} ${formData.currency} بنجاح` : `Payment installment of ${amt} ${formData.currency} added successfully`, 'success');
      sendAndroidNotification(language === 'ar' ? 'تحديث مواعيد الدفعات' : 'Installments Schedule Update', language === 'ar' ? msgAr : msgEn);
    } else {
      const msgAr = `تم تسديد دفعة بمبلغ ${amt} ${formData.currency}. المتبقي للسداد: ${remainingAmount} ${formData.currency}. يرجى الالتزام بموعد السداد النهائي في ${formData.dueDate}`;
      const msgEn = `Settle payment of ${amt} ${formData.currency} recorded. Remaining: ${remainingAmount} ${formData.currency}. Final due date: ${formData.dueDate}`;

      showNotification(language === 'ar' ? `تم تسديد دفعة بمبلغ ${amt} ${formData.currency} بنجاح` : `Settle payment of ${amt} ${formData.currency} recorded successfully`, 'success');
      sendAndroidNotification(language === 'ar' ? 'إشعار سداد دفعة ومواعيد الاستحقاق' : 'Payment Settlement & Due Dates', language === 'ar' ? msgAr : msgEn);
    }

    setNewPayment(prev => ({ ...prev, amount: '' }));
  };

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validate()) return;

    try {
      const count = showScheduleCard ? parseInt(formData.installmentsCount) || 0 : 0;
      let generatedScheduleItems = [];

      // توليد جدول الدفعات والتواريخ عند تفعيل الجدولة
      if (showScheduleCard && count > 0) {
        const totalAmt = parseFloat(formData.amount);
        const installmentAmt = Number((totalAmt / count).toFixed(2));
        const startDate = new Date(formData.firstPaymentDate || formData.dueDate);

        for (let i = 0; i < count; i++) {
          const itemDate = new Date(startDate);

          if (formData.scheduleType === 'daily') {
            itemDate.setDate(startDate.getDate() + i);
          } else if (formData.scheduleType === 'weekly') {
            itemDate.setDate(startDate.getDate() + (i * 7));
          } else if (formData.scheduleType === 'monthly') {
            itemDate.setMonth(startDate.getMonth() + i);
          }

          generatedScheduleItems.push({
            id: generateUniqueId(),
            installmentNumber: i + 1,
            amount: i === count - 1 ? Number((totalAmt - (installmentAmt * (count - 1))).toFixed(2)) : installmentAmt,
            dueDate: itemDate.toISOString().split('T')[0],
            status: 'pending'
          });
        }
      }

      const debtData = {
        id: id || generateUniqueId(),
        type: formData.type,
        personName: formData.personName,
        person_name: formData.personName,
        phone: formData.phone || null,
        amount: parseFloat(formData.amount),
        currency: formData.currency,
        dueDate: formData.dueDate,
        due_date: formData.dueDate,
        notes: formData.notes || null,
        status: formData.status,
        isScheduled: showScheduleCard,
        is_scheduled: showScheduleCard,
        scheduleType: showScheduleCard ? formData.scheduleType : null,
        schedule_type: showScheduleCard ? formData.scheduleType : null,
        installmentsCount: count,
        installments_count: count,
        firstPaymentDate: showScheduleCard ? formData.firstPaymentDate : null,
        first_payment_date: showScheduleCard ? formData.firstPaymentDate : null,
        scheduleData: showScheduleCard ? generatedScheduleItems : null,
        schedule_data: showScheduleCard ? generatedScheduleItems : null,
        paymentsList: paymentsList
      };

      if (isEditing) {
        await updateDebt(id, debtData);
      } else {
        await addDebt(debtData);

        const debtTypeString = formData.type === 'owed_to_me'
          ? (language === 'ar' ? 'مستحق لك من' : 'owed to you by')
          : (language === 'ar' ? 'متوجب عليك لصالح' : 'you owe to');

        const notifTitle = language === 'ar' ? 'تم إضافة دين جديد بنجاح' : 'New Debt Registered';
        const notifMessage = language === 'ar'
          ? `تم تسجيل دين جديد بمبلغ ${formData.amount} ${formData.currency} ${debtTypeString} ${formData.personName}. تاريخ الاستحقاق: ${formData.dueDate}`
          : `New debt of ${formData.amount} ${formData.currency} ${debtTypeString} ${formData.personName} has been created. Due date: ${formData.dueDate}`;

        sendAndroidNotification(notifTitle, notifMessage);
      }

      navigate(-1);
    } catch (error) {
      showNotification(error.message, 'error');
    }
  };

  // Handle delete
  const handleDelete = async () => {
    try {
      await deleteDebt(id);
      navigate('/debts');
    } catch (error) {
      showNotification(error.message, 'error');
    }
  };

  // Handle input change
  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  // إضافة دين سريع لنفس الشخص
  const handleQuickAddForPerson = () => {
    if (!formData.personName.trim()) {
      showNotification(language === 'ar' ? 'الرجاء إدخال اسم العميل أولاً' : 'Please enter person name first', 'error');
      return;
    }
    setFormData(prev => ({
      ...prev,
      amount: '',
      notes: '',
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    }));
    showNotification(
      language === 'ar'
        ? `جاهز لإضافة دين جديد للعميل: ${formData.personName}`
        : `Ready to add new debt for: ${formData.personName}`,
      'info'
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pb-8">
      {/* Header */}
      <header className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white p-4 sticky top-0 z-10 shadow-lg">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="p-2 rounded-xl hover:bg-white/20 transition"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold flex-1">
            {isEditing ? t('editDebt') : t('addDebt')}
          </h1>
          {isEditing && (
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              className="p-2 rounded-xl hover:bg-red-500/20 text-red-100 hover:text-white transition"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          )}
        </div>
      </header>

      <form onSubmit={handleSubmit} className="p-4 space-y-4">
        {/* Debt Type Toggle */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-lg">
          <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-4">
            {t('debtType')}
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => handleChange('type', 'owed_to_me')}
              className={`p-5 rounded-xl border-2 transition-all flex flex-col items-center gap-3 ${
                formData.type === 'owed_to_me'
                  ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 shadow-lg'
                  : 'border-gray-200 dark:border-gray-700 hover:border-emerald-300'
              }`}
            >
              <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${
                formData.type === 'owed_to_me'
                  ? 'bg-emerald-100 dark:bg-emerald-800/30'
                  : 'bg-gray-100 dark:bg-gray-700'
              }`}>
                <TrendingUp className={`w-7 h-7 ${
                  formData.type === 'owed_to_me' ? 'text-emerald-500' : 'text-gray-400'
                }`} />
              </div>
              <span className={`font-bold text-sm ${
                formData.type === 'owed_to_me'
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-gray-600 dark:text-gray-400'
              }`}>
                {language === 'ar' ? 'المستحق لي' : t('owedToMe')}
              </span>
            </button>

            <button
              type="button"
              onClick={() => handleChange('type', 'i_owe')}
              className={`p-5 rounded-xl border-2 transition-all flex flex-col items-center gap-3 ${
                formData.type === 'i_owe'
                  ? 'border-red-500 bg-red-50 dark:bg-red-900/20 shadow-lg'
                  : 'border-gray-200 dark:border-gray-700 hover:border-red-300'
              }`}
            >
              <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${
                formData.type === 'i_owe'
                  ? 'bg-red-100 dark:bg-red-800/30'
                  : 'bg-gray-100 dark:bg-gray-700'
              }`}>
                <TrendingDown className={`w-7 h-7 ${
                  formData.type === 'i_owe' ? 'text-red-500' : 'text-gray-400'
                }`} />
              </div>
              <span className={`font-bold text-sm ${
                formData.type === 'i_owe'
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-gray-600 dark:text-gray-400'
              }`}>
                {language === 'ar' ? 'المتوجب عليّ' : t('iOwe')}
              </span>
            </button>
          </div>
        </div>

        {/* Person Name with Quick Add Button */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-lg">
          <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-3 flex items-center justify-between">
            <span className="flex items-center gap-2">
              <User className="w-4 h-4" />
              {t('personName')}
              <span className="text-red-500">*</span>
            </span>
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={formData.personName}
              onChange={(e) => handleChange('personName', e.target.value)}
              className={`flex-1 px-4 py-3.5 rounded-xl border-2 ${
                errors.personName
                  ? 'border-red-500 bg-red-50 dark:bg-red-900/20'
                  : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700'
              } text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition placeholder-gray-400`}
              placeholder={language === 'ar' ? 'اسم الشخص' : language === 'fr' ? 'Nom de la personne' : 'Person name'}
            />
            <button
              type="button"
              onClick={handleQuickAddForPerson}
              title={language === 'ar' ? 'إضافة دين إضافي لهذا العميل' : 'Add another debt for this person'}
              className="px-4 py-3.5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border-2 border-emerald-500/30 hover:border-emerald-500 rounded-xl font-bold flex items-center justify-center gap-1 transition-all active:scale-95"
            >
              <Plus className="w-5 h-5" />
              <span className="text-xs hidden sm:inline">
                {language === 'ar' ? 'دين جديد' : 'Add Debt'}
              </span>
            </button>
          </div>
          {errors.personName && (
            <p className="mt-2 text-sm text-red-500 font-medium">{errors.personName}</p>
          )}
        </div>

        {/* Phone */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-lg">
          <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
            <Phone className="w-4 h-4" />
            {t('phone')}
            <span className="text-xs text-gray-400 font-normal">({language === 'ar' ? 'اختياري - للواتساب' : language === 'fr' ? 'optionnel' : 'optional'})</span>
          </label>
          <input
            type="tel"
            value={formData.phone}
            onChange={(e) => handleChange('phone', e.target.value)}
            className="w-full px-4 py-3.5 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition placeholder-gray-400"
            placeholder={language === 'ar' ? 'مثال: +213555123456' : '+213...'}
            dir="ltr"
          />
        </div>

        {/* Amount & Currency */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-lg overflow-hidden">
          <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
            <DollarSign className="w-4 h-4" />
            {t('amount')}
            <span className="text-red-500">*</span>
          </label>
          <div className="flex items-center gap-2 w-full">
            <input
              type="number"
              value={formData.amount}
              onChange={(e) => handleChange('amount', e.target.value)}
              className={`flex-1 min-w-[120px] px-3.5 py-3 rounded-xl border-2 ${
                errors.amount
                  ? 'border-red-500 bg-red-50 dark:bg-red-900/20'
                  : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700'
              } text-gray-900 dark:text-white text-base font-semibold focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition placeholder-gray-400`}
              placeholder="0"
              min="0"
              step="0.01"
              inputMode="decimal"
            />
            <select
              value={formData.currency}
              onChange={(e) => handleChange('currency', e.target.value)}
              className="w-32 shrink-0 px-2 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition text-sm font-bold truncate"
            >
              {allCurrencies.map(c => (
                <option key={c.code} value={c.code}>
                  {c.code} - {c.name}
                </option>
              ))}
            </select>
          </div>
          {errors.amount && (
            <p className="mt-2 text-sm text-red-500 font-medium">{errors.amount}</p>
          )}
        </div>

        {/* Due Date */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-lg">
          <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
            <Calendar className="w-4 h-4" />
            {t('dueDate')}
            <span className="text-red-500">*</span>
          </label>
          <input
            type="date"
            value={formData.dueDate}
            onChange={(e) => handleChange('dueDate', e.target.value)}
            className={`w-full px-4 py-3.5 rounded-xl border-2 ${
              errors.dueDate
                ? 'border-red-500 bg-red-50 dark:bg-red-900/20'
                : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition'
            }`}
          />
          {errors.dueDate && (
            <p className="mt-2 text-sm text-red-500 font-medium">{errors.dueDate}</p>
          )}
        </div>

        {/* Notes */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-lg">
          <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
            <FileText className="w-4 h-4" />
            {t('notes')}
          </label>
          <textarea
            value={formData.notes}
            onChange={(e) => handleChange('notes', e.target.value)}
            rows="3"
            className="w-full px-4 py-3.5 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition placeholder-gray-400"
            placeholder={language === 'ar' ? 'ملاحظات إضافية...' : 'Additional notes...'}
          />
        </div>

        {/* Status */}
        {isEditing && (
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-lg">
            <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
              <Info className="w-4 h-4" />
              {t('status')}
            </label>
            <select
              value={formData.status}
              onChange={(e) => handleChange('status', e.target.value)}
              className="w-full px-4 py-3.5 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition font-medium"
            >
              <option value="pending">{t('pending')}</option>
              <option value="paid">{t('paid')}</option>
              <option value="partially_paid">{t('partiallyPaid')}</option>
            </select>
          </div>
        )}

        {/* Scheduling & Payments Section */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg overflow-hidden border border-gray-100 dark:border-gray-700">
          <button
            type="button"
            onClick={() => setShowScheduleCard(!showScheduleCard)}
            className="w-full px-5 py-4 flex items-center gap-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition border-b border-gray-100 dark:border-gray-700"
          >
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
              showScheduleCard ? 'bg-blue-100 dark:bg-blue-900/30' : 'bg-gray-100 dark:bg-gray-700'
            }`}>
              <Repeat className={`w-6 h-6 ${showScheduleCard ? 'text-blue-500' : 'text-gray-400'}`} />
            </div>
            <div className="flex-1 text-start">
              <p className="font-bold text-gray-900 dark:text-white">
                {language === 'ar' ? 'جدولة الدين والتقسيط المتقدم' : 'Debt Scheduling & Installments'}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {showScheduleCard
                  ? (language === 'ar' ? 'مفعّل - اضغط للتعطيل' : 'Enabled')
                  : (language === 'ar' ? 'اختياري - اضغط للتفعيل' : 'Optional - Tap to enable')}
              </p>
            </div>
            <div className={`w-14 h-8 rounded-full transition-colors ${
              showScheduleCard ? 'bg-blue-500' : 'bg-gray-300'
            } relative flex-shrink-0`}>
              <div className={`absolute top-1 w-6 h-6 bg-white rounded-full shadow transition-transform ${
                showScheduleCard ? 'translate-x-7' : 'translate-x-1'
              }`} />
            </div>
          </button>

          {showScheduleCard && (
            <div className="p-5 space-y-5 bg-slate-50/30 dark:bg-slate-900/10 animate-in slide-in-from-top-2 duration-200">
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  {language === 'ar' ? 'نوع الجدولة / التكرار' : 'Schedule Type'}
                  <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { value: 'daily', labelAr: 'يومي', labelEn: 'Daily' },
                    { value: 'weekly', labelAr: 'أسبوعي', labelEn: 'Weekly' },
                    { value: 'monthly', labelAr: 'شهري', labelEn: 'Monthly' },
                    { value: 'specific', labelAr: 'تاريخ محدد', labelEn: 'Specific' }
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => handleChange('scheduleType', option.value)}
                      className={`py-3 px-2 rounded-xl border-2 transition-all text-center text-xs font-bold ${
                        formData.scheduleType === option.value
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                          : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-blue-300'
                      }`}
                    >
                      {language === 'ar' ? option.labelAr : option.labelEn}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">
                    {language === 'ar' ? 'عدد الدفعات' : 'Number of Installments'}
                    <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    value={formData.installmentsCount}
                    onChange={(e) => handleChange('installmentsCount', e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition placeholder-gray-400 text-sm"
                    placeholder="12"
                    min="1"
                    max="99"
                  />
                  {formData.amount && formData.installmentsCount && (
                    <p className="mt-1.5 text-xs text-blue-600 dark:text-blue-400 font-bold">
                      {language === 'ar'
                        ? `قيمة القسط الإفتراضي: ${(parseFloat(formData.amount) / (parseInt(formData.installmentsCount) || 1)).toFixed(2)} ${formData.currency}`
                        : `Installment: ${(parseFloat(formData.amount) / (parseInt(formData.installmentsCount) || 1)).toFixed(2)} ${formData.currency}`}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    {language === 'ar' ? 'تاريخ الدفعة الأولى' : 'First Payment Date'}
                    <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={formData.firstPaymentDate}
                    onChange={(e) => handleChange('firstPaymentDate', e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition text-sm"
                  />
                </div>
              </div>

              {/* إدارة حركة الدفعات */}
              <div className="pt-4 border-t border-dashed border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-start">
                    <p className="font-bold text-gray-900 dark:text-white text-xs flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                      {language === 'ar' ? 'إدارة وحركة دفعات الدين المعجل' : 'Debt Installments Management'}
                    </p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">
                      {language === 'ar' ? `المسجلة حالياً: (${paymentsList.length}) دفعة` : `Total registered: (${paymentsList.length})`}
                    </p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setNewPayment(prev => ({ ...prev, type: 'record' }))}
                      className={`py-2.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 border ${
                        newPayment.type === 'record'
                          ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 shadow-sm'
                          : 'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-transparent'
                      }`}
                    >
                      <PlusCircle className="w-3.5 h-3.5" />
                      {language === 'ar' ? 'إضافة دفعة سابقة' : 'Add Installment'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewPayment(prev => ({ ...prev, type: 'settle' }))}
                      className={`py-2.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 border ${
                        newPayment.type === 'settle'
                          ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800 shadow-sm'
                          : 'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-transparent'
                      }`}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {language === 'ar' ? 'تسديد دفعة' : 'Settle Payment'}
                    </button>
                  </div>

                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={newPayment.amount}
                      onChange={(e) => setNewPayment(prev => ({ ...prev, amount: e.target.value }))}
                      placeholder={language === 'ar' ? 'مبلغ الدفعة' : 'Payment amount'}
                      className="flex-1 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-xs"
                      min="0"
                      step="0.01"
                    />
                    <button
                      type="button"
                      onClick={handleAddPaymentAction}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs transition"
                    >
                      {language === 'ar' ? 'تأكيد' : 'Confirm'}
                    </button>
                  </div>

                  {/* قائمة الدفعات المسجلة */}
                  {paymentsList.length > 0 && (
                    <div className="mt-3 space-y-1.5 max-h-36 overflow-y-auto pr-1">
                      {paymentsList.map((p) => (
                        <div key={p.id} className="flex items-center justify-between p-2 bg-white dark:bg-gray-700/60 rounded-lg text-xs border border-gray-100 dark:border-gray-600">
                          <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full ${p.type === 'settle' ? 'bg-blue-500' : 'bg-emerald-500'}`}></span>
                            <span className="font-bold text-gray-800 dark:text-gray-200">{p.amount} {formData.currency}</span>
                            <span className="text-[10px] text-gray-400">({p.type === 'settle' ? (language === 'ar' ? 'تسديد' : 'Settle') : (language === 'ar' ? 'إضافة' : 'Record')})</span>
                          </div>
                          <span className="text-[10px] text-gray-400">{p.date}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-4 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white rounded-2xl font-bold shadow-lg flex items-center justify-center gap-2 transition disabled:opacity-50"
        >
          <Save className="w-5 h-5" />
          <span>{loading ? t('saving') : (isEditing ? t('updateDebt') : t('saveDebt'))}</span>
        </button>
      </form>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-3xl p-6 max-w-sm w-full space-y-4 text-center shadow-2xl">
            <div className="w-12 h-12 bg-red-100 dark:bg-red-900/30 text-red-500 rounded-2xl flex items-center justify-center mx-auto">
              <AlertCircle className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">
              {language === 'ar' ? 'حذف الدين' : 'Delete Debt'}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {language === 'ar' ? 'هل أنت تأكد من رغبتك في حذف هذا الدين؟ لا يمكن التراجع عن هذا الإجراء.' : 'Are you sure you want to delete this debt? This action cannot be undone.'}
            </p>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="py-3 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 font-bold rounded-xl hover:bg-gray-200 transition text-sm"
              >
                {language === 'ar' ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="py-3 bg-red-500 text-white font-bold rounded-xl hover:bg-red-600 transition text-sm shadow-md shadow-red-500/20"
              >
                {language === 'ar' ? 'تأكيد الحذف' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
