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
  ChevronDown,
  ChevronUp,
  PlusCircle,
  CheckCircle2
} from 'lucide-react';
import { currencies } from '../i18n/translations.jsx';
import { LocalNotifications } from '@capacitor/local-notifications';

/**
 * Debt Form Page
 * Handles both adding and editing debts
 * Uses LocalNotifications for all local notification actions
 */
export default function DebtForm() {
  const { t, addDebt, updateDebt, deleteDebt, debts, showNotification, loading, language } = useApp();
  const navigate = useNavigate();
  const { id } = useParams();
  const isEditing = !!id;

  const existingDebt = isEditing ? debts.find(d => d.id === id) : null;

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
  const [showPaymentsSection, setShowPaymentsSection] = useState(false);
  const [paymentsList, setPaymentsList] = useState([]);
  const [newPayment, setNewPayment] = useState({ amount: '', type: 'record' }); // type: 'record' (إضافة دفعة) أو 'settle' (تسديد دفعة)

  // دالة مساعدة لإرسال إشعارات محلية فورية عبر مكتبة Capacitor
  const sendAndroidNotification = async (title, message) => {
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
            schedule: { at: new Date(Date.now() + 500) }, // إطلاق فوري (بعد نصف ثانية)
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
      
      // تحميل الدفعات المسجلة مسبقاً إن وجدت في بيانات الدين
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

  // معالجة إضافة أو تسديد دفعة داخل الجدول مع إطلاق إشعار محلي فوراً
  const handleAddPaymentAction = () => {
    const amt = parseFloat(newPayment.amount);
    if (!amt || amt <= 0) {
      showNotification(language === 'ar' ? 'الرجاء إدخال مبلغ دفعة صحيح' : 'Please enter a valid payment amount', 'error');
      return;
    }

    const paymentItem = {
      id: Date.now().toString(),
      amount: amt,
      type: newPayment.type,
      date: new Date().toISOString().split('T')[0]
    };

    setPaymentsList(prev => [paymentItem, ...prev]);
    
    // حساب المتبقي الإجمالي للدين ومواعيد السداد للإشعار المحلي
    const totalAmount = parseFloat(formData.amount) || 0;
    const paidAmount = [paymentItem, ...paymentsList]
      .filter(p => p.type === 'settle')
      .reduce((sum, p) => sum + p.amount, 0);
    const remainingAmount = Math.max(0, totalAmount - paidAmount);

    // إطلاق الإشعار المحلي التفاعلي حسب نوع العملية وبناء تفاصيل السداد والمواعيد القادمة
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
      // بناء هيكل البيانات المزدوج ليتوافق مع محرك الباك إند بأي صيغة متوقعة
      const debtData = {
        id: id || undefined,
        type: formData.type,
        personName: formData.personName,
        person_name: formData.personName, // إرسال نسختين للتوافق مع الباك إند
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
        installmentsCount: showScheduleCard ? parseInt(formData.installmentsCount) || 0 : 0,
        installments_count: showScheduleCard ? parseInt(formData.installmentsCount) || 0 : 0,
        firstPaymentDate: showScheduleCard ? formData.firstPaymentDate : null,
        first_payment_date: showScheduleCard ? formData.firstPaymentDate : null,
        paymentsList: paymentsList // إرسال مصفوفة الدفعات المحدثة إلى قاعدة البيانات
      };

      if (isEditing) {
        await updateDebt(id, debtData);
      } else {
        await addDebt(debtData);
        // إطلاق إشعار محلي عند إضافة دين جديد بنجاح
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
        </div>
      </header>

      <form onSubmit={handleSubmit} className="p-4 space-y-4">
        {/* Debt Type Toggle */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-lg">
          <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-4">
            {t('debtType')}
          </label>
          <div className="grid grid-cols-2 gap-3">
            {/* Owed to Me Button */}
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

            {/* I Owe Button */}
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

        {/* Person Name */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-lg">
          <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
            <User className="w-4 h-4" />
            {t('personName')}
            <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={formData.personName}
            onChange={(e) => handleChange('personName', e.target.value)}
            className={`w-full px-4 py-3.5 rounded-xl border-2 ${
              errors.personName
                ? 'border-red-500 bg-red-50 dark:bg-red-900/20'
                : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700'
            } text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition placeholder-gray-400`}
            placeholder={language === 'ar' ? 'اسم الشخص' : language === 'fr' ? 'Nom de la personne' : 'Person name'}
          />
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
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-lg">
          <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
            <DollarSign className="w-4 h-4" />
            {t('amount')}
            <span className="text-red-500">*</span>
          </label>
          <div className="flex gap-3">
            <input
              type="number"
              value={formData.amount}
              onChange={(e) => handleChange('amount', e.target.value)}
              className={`flex-1 px-4 py-3.5 rounded-xl border-2 ${
                errors.amount
                  ? 'border-red-500 bg-red-50 dark:bg-red-900/20'
                  : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700'
              } text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition placeholder-gray-400`}
              placeholder="0"
              min="0"
              step="0.01"
              inputMode="decimal"
            />
            <select
              value={formData.currency}
              onChange={(e) => handleChange('currency', e.target.value)}
              className="px-4 py-3.5 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition font-medium"
            >
              {currencies.map(c => (
                <option key={c} value={c}>{c}</option>
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

        {/* Status - Only for editing */}
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

        {/* الكارت المدمج الجديد: يجمع بين الجدولة وإدارة حركات الدفعات معاً بصورة مترابطة */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg overflow-hidden border border-gray-100 dark:border-gray-700">
          {/* رأس الكارت الرئيسي للتحكم بالجدولة والتقسيط */}
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
                {language === 'ar' ? 'جدولة الدين والتقسيط المتقدم' : language === 'fr' ? 'Planification et versements' : 'Debt Scheduling & Installments'}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {showScheduleCard
                  ? (language === 'ar' ? 'مفعّل - اضغط للتعطيل' : language === 'fr' ? 'Activé' : 'Enabled')
                  : (language === 'ar' ? 'اختياري - اضغط للتفعيل' : language === 'fr' ? 'Optionnel' : 'Optional - Tap to enable')}
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

          {/* محتوى كارت الجدولة والحركات المرتبطة */}
          {showScheduleCard && (
            <div className="p-5 space-y-5 bg-slate-50/30 dark:bg-slate-900/10 animate-in slide-in-from-top-2 duration-200">
              {/* اختيار نوع التكرار */}
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  {language === 'ar' ? 'نوع الجدولة / التكرار' : language === 'fr' ? 'Type de planification' : 'Schedule Type'}
                  <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { value: 'daily', labelAr: 'يومي', labelFr: 'Quotidien', labelEn: 'Daily' },
                    { value: 'weekly', labelAr: 'أسبوعي', labelFr: 'Hebdo', labelEn: 'Weekly' },
                    { value: 'monthly', labelAr: 'شهري', labelFr: 'Mensuel', labelEn: 'Monthly' },
                    { value: 'specific', labelAr: 'تاريخ محدد', labelFr: 'Date fixe', labelEn: 'Specific' }
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
                      {language === 'ar' ? option.labelAr : language === 'fr' ? option.labelFr : option.labelEn}
                    </button>
                  ))}
                </div>
              </div>

              {/* عدد الدفعات وتاريخ أول دفعة */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">
                    {language === 'ar' ? 'عدد الدفعات' : language === 'fr' ? 'Nombre de versements' : 'Number of Installments'}
                    <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    value={formData.installmentsCount}
                    onChange={(e) => handleChange('installmentsCount', e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition placeholder-gray-400 text-sm"
                    placeholder={language === 'ar' ? 'مثال: 12' : 'e.g., 12'}
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

              {/* قسم إدارة وحركات دفعات الدين المعجل المرتبط هيكلياً */}
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
                  {/* أزرار اختيار نوع الدفعة (إضافة / تسديد) */}
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
                      {language === 'ar' ? 'تسديد دفعة الآن' : 'Settle Installment'}
                    </button>
                  </div>

                  {/* حقل الإدخال وزر الحفظ */}
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <input
                        type="number"
                        value={newPayment.amount}
                        onChange={(e) => setNewPayment(prev => ({ ...prev, amount: e.target.value }))}
                        placeholder={language === 'ar' ? 'أدخل قيمة الدفعة...' : 'Amount...'}
                        className="w-full pl-3 pr-12 py-2.5 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white rounded-xl border border-gray-200 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400">
                        {formData.currency}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={handleAddPaymentAction}
                      className="px-4 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-bold rounded-xl text-xs shadow hover:opacity-90 active:scale-95 transition-all flex items-center justify-center"
                    >
                      {language === 'ar' ? 'حفظ الحركة' : 'Apply'}
                    </button>
                  </div>

                  {/* جدول عرض الحركات المسجلة والمربوطة بالجدولة */}
                  <div className="overflow-x-auto rounded-xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-700">
                    <table className="w-full text-xs text-start">
                      <thead className="text-[10px] text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-600 uppercase font-bold">
                        <tr>
                          <th scope="col" className="px-3 py-2 text-start">{language === 'ar' ? 'التاريخ' : 'Date'}</th>
                          <th scope="col" className="px-3 py-2 text-start">{language === 'ar' ? 'النوع' : 'Type'}</th>
                          <th scope="col" className="px-3 py-2 text-end">{language === 'ar' ? 'المبلغ' : 'Amount'}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-600">
                        {paymentsList.map((p) => (
                          <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-600/50 transition-colors">
                            <td className="px-3 py-2 text-gray-600 dark:text-gray-300 whitespace-nowrap">{p.date}</td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                p.type === 'record'
                                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                                  : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                              }`}>
                                {p.type === 'record' 
                                  ? (language === 'ar' ? 'إضافة' : 'Added') 
                                  : (language === 'ar' ? 'تسديد' : 'Settled')}
                              </span>
                            </td>
                            <td className={`px-3 py-2 text-end font-bold ${
                              p.type === 'record' ? 'text-emerald-600' : 'text-blue-600'
                            }`}>
                              {p.amount.toFixed(2)} {formData.currency}
                            </td>
                          </tr>
                        ))}
                        {paymentsList.length === 0 && (
                          <tr>
                            <td colSpan="3" className="px-3 py-4 text-center text-gray-400 dark:text-gray-500">
                              {language === 'ar' ? 'لا توجد حركات دفع مسجلة بعد' : 'No payments registered yet'}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 pt-2">
          {isEditing && (
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              className="p-3.5 bg-red-50 text-red-500 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30 rounded-xl transition shadow-sm flex items-center justify-center"
              disabled={loading}
            >
              <Trash2 className="w-5 h-5" />
            </button>
          )}
          <button
            type="submit"
            className="flex-1 bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-bold py-3.5 px-4 rounded-xl shadow-lg hover:opacity-90 active:scale-[0.98] transition-all flex items-center justify-center gap-2 text-base"
            disabled={loading}
          >
            <Save className="w-5 h-5" />
            {loading ? t('saving') : t('save')}
          </button>
        </div>
      </form>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 max-w-sm w-full shadow-2xl text-center">
            <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mx-auto mb-4 text-red-500">
              <AlertCircle className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
              {language === 'ar' ? 'هل أنت متأكد من الحذف؟' : 'Confirm Delete'}
            </h3>
            <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">
              {language === 'ar' ? 'لا يمكن التراجع عن هذا الإجراء وسيتم مسح كافة البيانات.' : 'This action cannot be undone.'}
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 py-2.5 px-4 rounded-xl border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition"
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="flex-1 py-2.5 px-4 rounded-xl bg-red-500 text-white font-bold hover:bg-red-600 shadow-md transition"
              >
                {t('delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
