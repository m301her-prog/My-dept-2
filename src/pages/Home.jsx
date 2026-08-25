import { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { useNavigate } from 'react-router-dom';
import html2pdf from 'html2pdf.js';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Capacitor } from '@capacitor/core';
import {
  TrendingUp,
  TrendingDown,
  Plus,
  Users,
  Settings,
  Bell,
  Calendar,
  ChevronLeft,
  DollarSign,
  Clock,
  CheckCircle,
  AlertTriangle,
  Activity,
  Wallet,
  FileText,
  Download,
  CreditCard,
  X,
  Share2,
  PlusCircle
} from 'lucide-react';

export default function Home() {
  const {
    t,
    user,
    isAdmin,
    debts = [],
    statistics = { totalDebts: 0, paidRatio: 0, totalOwedToMe: 0, totalIOwe: 0, paidDebtsCount: 0, pendingDebtsCount: 0 },
    language,
    setLanguage,
    darkMode,
    setDarkMode,
    sendNotification,
    notificationsEnabled,
    openWhatsApp,
    updateDebt 
  } = useApp();
  
  const navigate = useNavigate();

  // State للتحكم في نافذة إضافة قسط
  const [selectedDebt, setSelectedDebt] = useState(null);
  const [installmentAmount, setInstallmentAmount] = useState('');
  const [customInstallmentCount, setCustomInstallmentCount] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);

  // State للتحكم في نافذة إضافة دين جديد (زيادة على المبلغ الحالي)
  const [selectedAddDebt, setSelectedAddDebt] = useState(null);
  const [additionalDebtAmount, setAdditionalDebtAmount] = useState('');
  const [isAddDebtModalOpen, setIsAddDebtModalOpen] = useState(false);

  // --- دالة مزامنة البيانات غير المحفوظة عند عودة النت ---
  const syncOfflineData = async () => {
    const offlineQueue = JSON.parse(localStorage.getItem('pending_offline_debts') || '[]');
    if (offlineQueue.length === 0) return;

    const remainingQueue = [];

    for (const item of offlineQueue) {
      try {
        const response = await fetch('/api/your-backend-endpoint', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-tenant-schema': item.tenantSchema || '',
            'x-installment-count': item.installmentsCount ? String(item.installmentsCount) : ''
          },
          body: JSON.stringify(item)
        });

        const result = await response.json();
        if (!result.success) {
          remainingQueue.push(item);
        }
      } catch (err) {
        remainingQueue.push(item);
      }
    }

    localStorage.setItem('pending_offline_debts', JSON.stringify(remainingQueue));
  };

  useEffect(() => {
    if (navigator.onLine) {
      syncOfflineData();
    }

    const handleOnline = () => {
      syncOfflineData();
    };

    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  useEffect(() => {
    if (!notificationsEnabled) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    debts.forEach(debt => {
      if (debt.status === 'paid') return;

      const dueDate = new Date(debt.dueDate);
      dueDate.setHours(0, 0, 0, 0);

      const diffDays = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));

      if (diffDays === 0) {
        sendNotification(t('paymentReminder'), `${t('dueToday')}: ${debt.personName} - ${formatCurrency(debt.amount, debt.currency)}`);
      } else if (diffDays === 1) {
        sendNotification(t('paymentReminder'), `${t('dueTomorrow')}: ${debt.personName} - ${formatCurrency(debt.amount, debt.currency)}`);
      } else if (diffDays < 0) {
        sendNotification(t('overdueNotice'), `${debt.personName} - ${formatCurrency(debt.amount, debt.currency)}`);
      }
    });
  }, [debts, t, notificationsEnabled, sendNotification]);

  const recentDebts = debts
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 5);

  const formatCurrency = (amount, currency) => {
    const locale = language === 'ar' ? 'ar-DZ' : language === 'fr' ? 'fr-FR' : 'en-US';
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency || 'DZD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount || 0);
  };

  const formatDate = (dateString) => {
    const locale = language === 'ar' ? 'ar-DZ' : language === 'fr' ? 'fr-FR' : 'en-US';
    return new Date(dateString).toLocaleDateString(locale, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const getStatusColor = (debt) => {
    if (debt.status === 'paid') return 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400';
    const dueDate = new Date(debt.dueDate);
    if (dueDate < new Date()) return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400';
    return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400';
  };

  const saveAndExportPDF = async (element, fileName, opt) => {
    if (!Capacitor.isNativePlatform()) {
      html2pdf().set(opt).from(element).save();
      return;
    }

    try {
      const pdfBase64 = await html2pdf()
        .set(opt)
        .from(element)
        .outputPdf('datauristring');

      const base64Data = pdfBase64.split(',')[1];

      const savedFile = await Filesystem.writeFile({
        path: fileName,
        data: base64Data,
        directory: Directory.Documents
      });

      await Share.share({
        title: fileName,
        text: 'تم استخراج ملف PDF بنجاح',
        url: savedFile.uri,
        dialogTitle: 'فتح أو مشاركة ملف PDF'
      });
    } catch (error) {
      console.error('حدث خطأ أثناء حفظ الملف على أندرويد:', error);
    }
  };

  const handleDownloadTablePDF = async () => {
    const element = document.getElementById('debts-table-container');
    const fileName = `جدول_الديون_${new Date().toISOString().slice(0, 10)}.pdf`;
    const opt = {
      margin: 10,
      filename: fileName,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
    };

    await saveAndExportPDF(element, fileName, opt);
  };

  const handlePrintCheckPDF = async (debt) => {
    const history = debt.history || [];
    const installments = history.filter(h => h.type === 'installment' || h.type === 'payment');

    const historyRows = history.length > 0 ? history.map((item, index) => `
      <tr style="border-bottom: 1px solid #e5e7eb; font-size: 13px;">
        <td style="padding: 8px; text-align: center;">${index + 1}</td>
        <td style="padding: 8px; text-align: center;">${formatDate(item.date || new Date())}</td>
        <td style="padding: 8px; text-align: center; color: ${item.type === 'add' ? '#dc2626' : '#16a34a'}; font-weight: bold;">
          ${item.type === 'add' ? 'إضافة دين (+)' : 'سداد قسط (-)'}
        </td>
        <td style="padding: 8px; text-align: center; font-weight: bold;">
          ${formatCurrency(item.amount, debt.currency)}
        </td>
        <td style="padding: 8px; text-align: center;">${item.note || '-'}</td>
      </tr>
    `).join('') : `
      <tr>
        <td colspan="5" style="padding: 12px; text-align: center; color: #6b7280; font-size: 13px;">لا توجد حركة أقساط سابقة سجلت لهذا الدين</td>
      </tr>
    `;

    const checkElement = document.createElement('div');
    checkElement.innerHTML = `
      <div style="padding: 20px; font-family: sans-serif; direction: rtl; text-align: right; background: #fff;">
        <div style="border: 3px solid #059669; padding: 25px; border-radius: 15px; background: #f0fdf4; max-width: 750px; margin: auto;">
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #059669; padding-bottom: 12px; margin-bottom: 20px;">
            <div>
              <h2 style="color: #059669; margin: 0; font-size: 22px;">شيك إثبات وسجل دين</h2>
              <span style="font-size: 12px; color: #666;">كشف حساب تفصيلي للشخص</span>
            </div>
            <span style="font-size: 13px; color: #333; background: #fff; padding: 4px 10px; border-radius: 6px; border: 1px solid #059669;">تاريخ التقرير: ${formatDate(new Date())}</span>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 20px; background: #fff; padding: 15px; border-radius: 10px; border: 1px solid #e5e7eb;">
            <div style="font-size: 15px;">
              <span style="color: #555;">الاسم / الطرف الثاني: </span><strong style="color: #111;">${debt.personName}</strong>
            </div>
            <div style="font-size: 15px;">
              <span style="color: #555;">نوع الدين: </span><strong>${debt.type === 'owed_to_me' ? 'مستحق لي (له)' : 'مستحق علي (عليه)'}</strong>
            </div>
            <div style="font-size: 15px;">
              <span style="color: #555;">تاريخ الاستحقاق: </span><strong>${formatDate(debt.dueDate)}</strong>
            </div>
            <div style="font-size: 15px;">
              <span style="color: #555;">الحالة الحالية: </span><strong style="color: ${debt.status === 'paid' ? '#16a34a' : '#d97706'};">${debt.status === 'paid' ? 'تم السداد بالكامل' : 'متبقي'}</strong>
            </div>
            <div style="font-size: 15px; grid-column: span 2;">
              <span style="color: #555;">عدد الأقساط المتبقية: </span><strong style="color: #059669;">${debt.installmentsCount !== undefined ? debt.installmentsCount : '-'}</strong>
            </div>
          </div>

          <div style="margin-bottom: 20px; background: #e6f4ea; padding: 15px; border-radius: 10px; display: flex; justify-content: space-between; align-items: center; border: 1px solid #a7f3d0;">
            <div>
              <div style="font-size: 13px; color: #047857;">المبلغ الحالي / المتبقي للدفعة:</div>
              <div style="font-size: 22px; font-weight: bold; color: #065f46;">${formatCurrency(debt.amount, debt.currency)}</div>
            </div>
            <div style="text-align: left;">
              <div style="font-size: 13px; color: #047857;">عدد الأقساط المسددة:</div>
              <div style="font-size: 18px; font-weight: bold; color: #065f46;">${installments.length}</div>
            </div>
          </div>

          <h3 style="font-size: 16px; color: #059669; margin-bottom: 10px;">جدول الأقساط والتحركات (السجل)</h3>
          <table style="width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; margin-bottom: 20px; border: 1px solid #d1d5db;">
            <thead>
              <tr style="background: #059669; color: #fff; font-size: 13px;">
                <th style="padding: 8px; text-align: center;">#</th>
                <th style="padding: 8px; text-align: center;">التاريخ</th>
                <th style="padding: 8px; text-align: center;">نوع العملية</th>
                <th style="padding: 8px; text-align: center;">المبلغ</th>
                <th style="padding: 8px; text-align: center;">ملاحظات</th>
              </tr>
            </thead>
            <tbody>
              ${historyRows}
            </tbody>
          </table>

          <div style="display: flex; justify-content: space-between; margin-top: 30px; border-top: 1px dashed #059669; padding-top: 15px;">
            <p style="margin: 0; font-size: 14px;">توقيع المحرر: ...................</p>
            <p style="margin: 0; font-size: 14px;">توقيع المستلم: ...................</p>
          </div>
        </div>
      </div>
    `;

    const fileName = `شيك_دين_${debt.personName}.pdf`;
    const opt = {
      margin: 10,
      filename: fileName,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    await saveAndExportPDF(checkElement, fileName, opt);
  };

  const handlePayInstallment = async () => {
    if (!installmentAmount || isNaN(installmentAmount) || installmentAmount <= 0) return;

    const amountPaid = parseFloat(installmentAmount);
    const newAmount = Math.max(0, selectedDebt.amount - amountPaid);
    const updatedStatus = newAmount === 0 ? 'paid' : selectedDebt.status;

    const currentInstallmentsCount = customInstallmentCount !== '' 
      ? parseInt(customInstallmentCount, 10) 
      : (selectedDebt.installmentsCount !== undefined ? selectedDebt.installmentsCount : 0);
      
    const newInstallmentsCount = Math.max(0, currentInstallmentsCount - 1);

    const newHistoryItem = {
      id: Date.now(),
      type: 'installment',
      amount: amountPaid,
      date: new Date().toISOString(),
      note: `تسديد قسط (المتبقي: ${newInstallmentsCount} قسط)`
    };

    const updatedHistory = [...(selectedDebt.history || []), newHistoryItem];

    try {
      await fetch('/api/your-backend-endpoint', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-installment-count': String(newInstallmentsCount)
        },
        body: JSON.stringify({
          debtId: selectedDebt.id,
          installmentPaid: amountPaid,
          remainingInstallments: newInstallmentsCount
        })
      });
    } catch (e) {
      // التعامل مع حالة الأوفلاين
    }

    if (updateDebt) {
      updateDebt(selectedDebt.id, {
        ...selectedDebt,
        amount: newAmount,
        status: updatedStatus,
        installmentsCount: newInstallmentsCount,
        history: updatedHistory
      });
    }

    const historyRows = updatedHistory.map((item, index) => `
      <tr style="border-bottom: 1px solid #e5e7eb; font-size: 13px;">
        <td style="padding: 8px; text-align: center;">${index + 1}</td>
        <td style="padding: 8px; text-align: center;">${formatDate(item.date || new Date())}</td>
        <td style="padding: 8px; text-align: center; color: ${item.type === 'add' ? '#dc2626' : '#16a34a'}; font-weight: bold;">
          ${item.type === 'add' ? 'إضافة دين (+)' : 'سداد قسط (-)'}
        </td>
        <td style="padding: 8px; text-align: center; font-weight: bold;">
          ${formatCurrency(item.amount, selectedDebt.currency)}
        </td>
        <td style="padding: 8px; text-align: center;">${item.note || '-'}</td>
      </tr>
    `).join('');

    const receiptElement = document.createElement('div');
    receiptElement.innerHTML = `
      <div style="padding: 20px; font-family: sans-serif; direction: rtl; text-align: right; background: #fff;">
        <div style="border: 3px solid #2563eb; padding: 25px; border-radius: 15px; background: #eff6ff; max-width: 750px; margin: auto;">
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #2563eb; padding-bottom: 10px; margin-bottom: 20px;">
            <div>
              <h2 style="color: #2563eb; margin: 0; font-size: 22px;">شيك وتوصيل سداد قسط</h2>
              <span style="font-size: 12px; color: #666;">وصل إثبات عملية دفع وتحديث الحساب</span>
            </div>
            <span style="font-size: 13px; color: #333; background: #fff; padding: 4px 10px; border-radius: 6px; border: 1px solid #2563eb;">التاريخ: ${formatDate(new Date())}</span>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px; background: #fff; padding: 12px; border-radius: 10px; border: 1px solid #dbeafe;">
            <div style="font-size: 15px;">
              <span>اسم العميل / الطرف: </span><strong style="color: #111;">${selectedDebt.personName}</strong>
            </div>
            <div style="font-size: 15px;">
              <span>المبلغ المدفوع (القسط الحالي): </span><strong style="color: #16a34a;">${formatCurrency(amountPaid, selectedDebt.currency)}</strong>
            </div>
            <div style="font-size: 15px;">
              <span>المبلغ المتبقي الكلي: </span><strong style="color: #dc2626;">${formatCurrency(newAmount, selectedDebt.currency)}</strong>
            </div>
            <div style="font-size: 15px;">
              <span>عدد الأقساط المتبقية: </span><strong style="color: #2563eb;">${newInstallmentsCount}</strong>
            </div>
            <div style="font-size: 15px; grid-column: span 2;">
              <span>حالة الدين: </span><strong>${updatedStatus === 'paid' ? 'مكتمل السداد' : 'قيد السداد'}</strong>
            </div>
          </div>

          <h3 style="font-size: 15px; color: #2563eb; margin-bottom: 8px;">جدول وحركات الأقساط كاملة</h3>
          <table style="width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; margin-bottom: 20px; border: 1px solid #cbd5e1;">
            <thead>
              <tr style="background: #2563eb; color: #fff; font-size: 13px;">
                <th style="padding: 8px; text-align: center;">#</th>
                <th style="padding: 8px; text-align: center;">التاريخ</th>
                <th style="padding: 8px; text-align: center;">العملية</th>
                <th style="padding: 8px; text-align: center;">المبلغ</th>
                <th style="padding: 8px; text-align: center;">البيان</th>
              </tr>
            </thead>
            <tbody>
              ${historyRows}
            </tbody>
          </table>

          <div style="display: flex; justify-content: space-between; margin-top: 25px; border-top: 1px dashed #2563eb; padding-top: 15px;">
            <p style="margin: 0; font-size: 14px;">توقيع المستلم: ...................</p>
            <p style="margin: 0; font-size: 14px;">توقيع الدافع: ...................</p>
          </div>
        </div>
      </div>
    `;

    const fileName = `شيك_سداد_${selectedDebt.personName}.pdf`;
    const opt = {
      margin: 10,
      filename: fileName,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    await saveAndExportPDF(receiptElement, fileName, opt);

    setIsModalOpen(false);
    setInstallmentAmount('');
    setCustomInstallmentCount('');
    setSelectedDebt(null);
  };

  const handleAddNewDebt = () => {
    if (!additionalDebtAmount || isNaN(additionalDebtAmount) || additionalDebtAmount <= 0) return;

    const addedAmount = parseFloat(additionalDebtAmount);
    const newTotalAmount = Number(selectedAddDebt.amount) + addedAmount;

    const newHistoryItem = {
      id: Date.now(),
      type: 'add',
      amount: addedAmount,
      date: new Date().toISOString(),
      note: 'إضافة دين جديد'
    };

    const updatedHistory = [...(selectedAddDebt.history || []), newHistoryItem];

    if (updateDebt) {
      updateDebt(selectedAddDebt.id, {
        ...selectedAddDebt,
        amount: newTotalAmount,
        status: selectedAddDebt.status === 'paid' ? 'pending' : selectedAddDebt.status,
        history: updatedHistory
      });
    }

    setIsAddDebtModalOpen(false);
    setAdditionalDebtAmount('');
    setSelectedAddDebt(null);
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pb-24">
      {/* Header */}
      <header className="bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 text-white p-6 pb-20">
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-emerald-100 text-sm">{t('welcome')}</p>
            <h1 className="text-2xl font-bold">
              {user?.name || user?.email?.split('@')[0]}
            </h1>
            <p className="text-emerald-100 text-sm mt-1">
              {language === 'ar' ? 'كيف حالك اليوم؟' : ''}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex bg-white/20 rounded-xl p-1 backdrop-blur-sm">
              {['ar', 'fr', 'en'].map(lang => (
                <button
                  key={lang}
                  onClick={() => setLanguage(lang)}
                  className={`px-3 py-1.5 text-xs rounded-lg font-medium transition ${
                    language === lang
                      ? 'bg-white text-emerald-600 shadow'
                      : 'text-white hover:bg-white/10'
                  }`}
                >
                  {lang === 'ar' ? 'AR' : lang === 'fr' ? 'FR' : 'EN'}
                </button>
              ))}
            </div>

            <button
              onClick={() => setDarkMode(!darkMode)}
              className="p-2.5 rounded-xl bg-white/20 hover:bg-white/30 transition"
              title={darkMode ? t('lightMode') : t('darkMode')}
            >
              {darkMode ? (
                <div className="w-5 h-5 rounded-full bg-yellow-400" />
              ) : (
                <div className="w-5 h-5 rounded-full bg-gray-800 border-2 border-gray-600" />
              )}
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4" />
            <span>{statistics.totalDebts} {t('debts')}</span>
          </div>
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4" />
            <span>{statistics.paidRatio}% {t('paid')}</span>
          </div>
        </div>
      </header>

      {/* Stats Cards */}
      <div className="px-4 -mt-14 mb-6">
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-xl border-l-4 border-emerald-500 hover:scale-[1.02] transition-transform">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-emerald-500" />
              </div>
              <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">{t('owedToMe')}</span>
            </div>
            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              {formatCurrency(statistics.totalOwedToMe, 'DZD')}
            </p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-xl border-l-4 border-red-500 hover:scale-[1.02] transition-transform">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <TrendingDown className="w-5 h-5 text-red-500" />
              </div>
              <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">{t('iOwe')}</span>
            </div>
            <p className="text-2xl font-bold text-red-600 dark:text-red-400">
              {formatCurrency(statistics.totalIOwe, 'DZD')}
            </p>
          </div>

          <div className="col-span-2 bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-emerald-500" />
                <span className="text-sm text-gray-600 dark:text-gray-400 font-medium">{t('statistics')}</span>
              </div>
              <span className="text-2xl font-bold text-gray-900 dark:text-white">{statistics.paidRatio}%</span>
            </div>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
              <div
                className="bg-gradient-to-r from-emerald-400 to-teal-500 h-3 rounded-full transition-all duration-500"
                style={{ width: `${statistics.paidRatio}%` }}
              />
            </div>
            <div className="flex justify-between mt-3 text-sm">
              <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                {t('paidDebts')}: {statistics.paidDebtsCount}
              </span>
              <span className="text-yellow-600 dark:text-yellow-400 font-medium">
                {t('pendingDebts')}: {statistics.pendingDebtsCount}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Activity Table */}
      {recentDebts.length > 0 && (
        <div className="px-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="flex items-center gap-2 text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              <Activity className="w-4 h-4" />
              {t('recentActivity')}
            </h2>
            
            <button
              onClick={handleDownloadTablePDF}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg shadow transition font-medium"
            >
              <Download className="w-4 h-4" />
              <span>تحميل الجدول</span>
              <Share2 className="w-3.5 h-3.5 opacity-80" />
              <span className="text-[10px] bg-emerald-700 px-1 rounded">PDF</span>
            </button>
          </div>

          <div id="debts-table-container" className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg overflow-hidden p-2">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm text-gray-700 dark:text-gray-200">
                <thead className="bg-gray-100 dark:bg-gray-700 text-xs uppercase text-gray-600 dark:text-gray-300">
                  <tr>
                    <th className="p-3">الاسم</th>
                    <th className="p-3">المبلغ</th>
                    <th className="p-3">الأقساط</th>
                    <th className="p-3">الحالة</th>
                    <th className="p-3">إجراءات (مشاركة PDF / أقساط / إضافة)</th>
                  </tr>
                </thead>
                <tbody>
                  {recentDebts.map((debt) => (
                    <tr key={debt.id} className="border-b border-gray-100 dark:border-gray-700">
                      <td className="p-3 font-semibold">{debt.personName}</td>
                      <td className={`p-3 font-bold ${debt.type === 'owed_to_me' ? 'text-emerald-500' : 'text-red-500'}`}>
                        {formatCurrency(debt.amount, debt.currency)}
                      </td>
                      <td className="p-3 font-semibold text-blue-600 dark:text-blue-400">
                        {debt.installmentsCount !== undefined ? debt.installmentsCount : '-'}
                      </td>
                      <td className="p-3">
                        <span className={`text-xs px-2 py-1 rounded-full ${getStatusColor(debt)}`}>
                          {debt.status === 'paid' ? t('paid') : t('pending')}
                        </span>
                      </td>
                      <td className="p-3 flex items-center gap-2">
                        <button
                          onClick={() => handlePrintCheckPDF(debt)}
                          title="عرض ومشاركة الشيك PDF"
                          className="flex items-center gap-1 p-1.5 bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 rounded-lg hover:bg-blue-100 transition text-xs font-medium"
                        >
                          <FileText className="w-4 h-4" />
                          <Share2 className="w-3.5 h-3.5" />
                          <span className="text-[10px] font-bold border border-blue-400 px-0.5 rounded">PDF</span>
                        </button>

                        <button
                          onClick={() => {
                            setSelectedDebt(debt);
                            setCustomInstallmentCount(debt.installmentsCount !== undefined ? String(debt.installmentsCount) : '');
                            setIsModalOpen(true);
                          }}
                          title="إضافة قسط واستخراج شيك سداد"
                          className="flex items-center gap-1 p-1.5 bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400 rounded-lg hover:bg-emerald-100 transition text-xs font-medium"
                        >
                          <CreditCard className="w-4 h-4" />
                          <span>قسط</span>
                        </button>

                        <button
                          onClick={() => {
                            setSelectedAddDebt(debt);
                            setIsAddDebtModalOpen(true);
                          }}
                          title="إضافة دين جديد يزيد على الحالي"
                          className="flex items-center gap-1 p-1.5 bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400 rounded-lg hover:bg-purple-100 transition text-xs font-medium"
                        >
                          <PlusCircle className="w-4 h-4" />
                          <span>دين جديد</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Modal إضافة قسط وخصمه */}
      {isModalOpen && selectedDebt && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-md w-full p-6 shadow-2xl relative">
            <button
              onClick={() => setIsModalOpen(false)}
              className="absolute left-4 top-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
              خصم قسط من الدين
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              العميل: <span className="font-semibold text-gray-800 dark:text-gray-200">{selectedDebt.personName}</span>
              <br />
              إجمالي الدين الحالي: <span className="font-bold text-emerald-600">{formatCurrency(selectedDebt.amount, selectedDebt.currency)}</span>
              <br />
              عدد الأقساط الحالية: <span className="font-bold text-blue-600">{selectedDebt.installmentsCount !== undefined ? selectedDebt.installmentsCount : '-'}</span>
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  تعديل/فتح إجمالي عدد الأقساط (Header: x-installment-count):
                </label>
                <input
                  type="number"
                  value={customInstallmentCount}
                  onChange={(e) => setCustomInstallmentCount(e.target.value)}
                  placeholder="عدد الأقساط الكلي..."
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  مبلغ القسط المراد خصمه:
                </label>
                <input
                  type="number"
                  value={installmentAmount}
                  onChange={(e) => setInstallmentAmount(e.target.value)}
                  placeholder="المبلغ..."
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={handlePayInstallment}
                  className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white font-medium py-2 rounded-xl transition text-sm shadow"
                >
                  تأكيد الخصم وطباعة PDF
                </button>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-4 py-2 rounded-xl text-sm font-medium"
                >
                  إلغاء
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal إضافة دين جديد */}
      {isAddDebtModalOpen && selectedAddDebt && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-md w-full p-6 shadow-2xl relative">
            <button
              onClick={() => setIsAddDebtModalOpen(false)}
              className="absolute left-4 top-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
              إضافة دين جديد على الحساب
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              العميل: <span className="font-semibold text-gray-800 dark:text-gray-200">{selectedAddDebt.personName}</span>
              <br />
              المبلغ الحالي: <span className="font-bold text-red-500">{formatCurrency(selectedAddDebt.amount, selectedAddDebt.currency)}</span>
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  المبلغ الإضافي المراد زيادته:
                </label>
                <input
                  type="number"
                  value={additionalDebtAmount}
                  onChange={(e) => setAdditionalDebtAmount(e.target.value)}
                  placeholder="المبلغ الإضافي..."
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white text-sm focus:ring-2 focus:ring-purple-500 outline-none"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleAddNewDebt}
                  className="flex-1 bg-purple-600 hover:bg-purple-700 text-white font-medium py-2 rounded-xl transition text-sm shadow"
                >
                  إضافة وإعادة تفعيل الدين
                </button>
                <button
                  onClick={() => setIsAddDebtModalOpen(false)}
                  className="bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-4 py-2 rounded-xl text-sm font-medium"
                >
                  إلغاء
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
