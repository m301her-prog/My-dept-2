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
  Activity,
  Wallet,
  FileText,
  Download,
  CreditCard,
  X,
  Share2,
  PlusCircle,
  Layers,
  CheckCircle,
  DollarSign,
  Loader2
} from 'lucide-react';

export default function Home() {
  const {
    t,
    user,
    debts = [],
    statistics = { totalDebts: 0, paidRatio: 0, totalOwedToMe: 0, totalIOwe: 0, paidDebtsCount: 0, pendingDebtsCount: 0 },
    language,
    setLanguage,
    darkMode,
    setDarkMode,
    sendNotification,
    notificationsEnabled,
    updateDebt,
    loading // حالة التحميل إذا كانت متاحة في Context
  } = useApp();
  
  const navigate = useNavigate();

  // State للتحكم في نافذة إضافة قسط
  const [selectedDebt, setSelectedDebt] = useState(null);
  const [installmentAmount, setInstallmentAmount] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);

  // State للتحكم في نافذة إضافة دين جديد
  const [selectedAddDebt, setSelectedAddDebt] = useState(null);
  const [additionalDebtAmount, setAdditionalDebtAmount] = useState('');
  const [isAddDebtModalOpen, setIsAddDebtModalOpen] = useState(false);

  // حساب إجمالي عدد الأقساط المتبقية عبر جميع الديون بأمان
  const totalInstallmentsCount = (debts || []).reduce((acc, curr) => acc + (Number(curr.installmentsCount) || 0), 0);

  // دالة مزامنة البيانات غير المحفوظة عند عودة النت
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
            'x-tenant-schema': item.tenantSchema || ''
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
    if (!notificationsEnabled || !debts || debts.length === 0) return;

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

  const recentDebts = [...(debts || [])]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 5);

  const formatCurrency = (amount = 0, currency) => {
    const locale = language === 'ar' ? 'ar-DZ' : language === 'fr' ? 'fr-FR' : 'en-US';
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency || 'DZD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
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
    let isTempAppended = false;
    if (!document.body.contains(element)) {
      element.style.position = 'absolute';
      element.style.left = '-9999px';
      element.style.top = '0';
      element.style.width = '750px';
      document.body.appendChild(element);
      isTempAppended = true;
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    try {
      if (!Capacitor.isNativePlatform()) {
        await html2pdf().set(opt).from(element).save();
        return;
      }

      const pdfBase64 = await html2pdf()
        .set(opt)
        .from(element)
        .outputPdf('datauristring');

      const base64Data = pdfBase64.split(',')[1];

      const savedFile = await Filesystem.writeFile({
        path: fileName,
        data: base64Data,
        directory: Directory.Cache
      });

      await Share.share({
        title: fileName,
        text: 'تم استخراج ملف PDF بنجاح',
        url: savedFile.uri,
        dialogTitle: 'فتح أو مشاركة ملف PDF'
      });
    } catch (error) {
      console.error('حدث خطأ أثناء حفظ أو مشاركة الملف:', error);
    } finally {
      if (isTempAppended && document.body.contains(element)) {
        document.body.removeChild(element);
      }
    }
  };

  const handleDownloadTablePDF = async () => {
    // إنشاء نموذج صريح للجدول من البيانات مباشرة لتفادي مشاكل الأبعاد والصفحة البيضاء
    const printContainer = document.createElement('div');
    printContainer.style.padding = '20px';
    printContainer.style.background = '#ffffff';
    printContainer.style.color = '#000000';
    printContainer.style.direction = 'rtl';
    printContainer.style.fontFamily = 'sans-serif';

    const rowsHtml = recentDebts.map((debt, index) => `
      <tr style="border-bottom: 1px solid #e5e7eb; font-size: 13px;">
        <td style="padding: 10px; text-align: center;">${index + 1}</td>
        <td style="padding: 10px; font-weight: bold;">${debt.personName}</td>
        <td style="padding: 10px; text-align: center; font-weight: bold; color: ${debt.type === 'owed_to_me' ? '#059669' : '#dc2626'};">
          ${formatCurrency(debt.amount, debt.currency)}
        </td>
        <td style="padding: 10px; text-align: center;">${debt.installmentsCount || 0}</td>
        <td style="padding: 10px; text-align: center;">${debt.status === 'paid' ? 'تم السداد' : 'قيد الانتظار'}</td>
        <td style="padding: 10px; text-align: center;">${formatDate(debt.dueDate)}</td>
      </tr>
    `).join('');

    printContainer.innerHTML = `
      <div style="border: 2px solid #10b981; border-radius: 10px; padding: 15px;">
        <h2 style="text-align: center; color: #10b981; margin-bottom: 5px;">جدول النشاط الأخير والديون</h2>
        <p style="text-align: center; color: #666; font-size: 12px; margin-bottom: 15px;">تاريخ التصدير: ${formatDate(new Date())}</p>
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="background-color: #10b981; color: white; font-size: 13px;">
              <th style="padding: 8px;">#</th>
              <th style="padding: 8px; text-align: right;">الاسم</th>
              <th style="padding: 8px;">المبلغ</th>
              <th style="padding: 8px;">الأقساط</th>
              <th style="padding: 8px;">الحالة</th>
              <th style="padding: 8px;">تاريخ الاستحقاق</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    `;

    const fileName = `جدول_الديون_${new Date().toISOString().slice(0, 10)}.pdf`;
    const opt = {
      margin: 10,
      filename: fileName,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, logging: false },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
    };

    await saveAndExportPDF(printContainer, fileName, opt);
  };

  // دالة تفعيل زرار مشاركة بيانات العميل كـ نص عبر Capacitor Share أو Web Share
  const handleShareDebtDetails = async (debt) => {
    const typeText = debt.type === 'owed_to_me' ? 'مستحق لي' : 'مستحق علي';
    const statusText = debt.status === 'paid' ? 'تم السداد' : 'متبقي';
    
    const shareText = `تفاصيل الدين:\n` +
      `الاسم: ${debt.personName}\n` +
      `المبلغ: ${formatCurrency(debt.amount, debt.currency)}\n` +
      `نوع الدين: ${typeText}\n` +
      `تاريخ الاستحقاق: ${formatDate(debt.dueDate)}\n` +
      `الحالة: ${statusText}`;

    try {
      if (Capacitor.isNativePlatform()) {
        await Share.share({
          title: `دين ${debt.personName}`,
          text: shareText,
          dialogTitle: 'مشاركة تفاصيل الدين'
        });
      } else if (navigator.share) {
        await navigator.share({
          title: `دين ${debt.personName}`,
          text: shareText
        });
      } else {
        await navigator.clipboard.writeText(shareText);
        alert('تم نسخ تفاصيل الدين إلى الحافظة');
      }
    } catch (error) {
      console.error('خطأ أثناء المشاركة:', error);
    }
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
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    await saveAndExportPDF(checkElement, fileName, opt);
  };

  const handlePayInstallment = async () => {
    if (!installmentAmount || isNaN(installmentAmount) || installmentAmount <= 0) return;

    const amountPaid = parseFloat(installmentAmount);
    const newAmount = Math.max(0, selectedDebt.amount - amountPaid);
    
    const currentInstallmentsCount = Number(selectedDebt.installmentsCount) || 0;
    const newInstallmentsCount = Math.max(0, currentInstallmentsCount - 1);

    const updatedStatus = newAmount === 0 ? 'paid' : selectedDebt.status;

    const newHistoryItem = {
      id: Date.now(),
      type: 'installment',
      amount: amountPaid,
      date: new Date().toISOString(),
      note: 'تسديد قسط'
    };

    const updatedHistory = [...(selectedDebt.history || []), newHistoryItem];

    if (updateDebt) {
      updateDebt(selectedDebt.id, {
        ...selectedDebt,
        amount: newAmount,
        installmentsCount: newInstallmentsCount,
        status: updatedStatus,
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
              <span>الأقساط المتبقية: </span><strong>${newInstallmentsCount}</strong>
            </div>
            <div style="font-size: 15px;">
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
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    await saveAndExportPDF(receiptElement, fileName, opt);

    setIsModalOpen(false);
    setInstallmentAmount('');
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

  // شاشة تحميل مؤقتة عند الفتح الأول حتى تجهز البيانات
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col justify-center items-center">
        <Loader2 className="w-10 h-10 text-emerald-500 animate-spin mb-4" />
        <p className="text-gray-600 dark:text-gray-300 font-medium">جاري تحميل البيانات...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pb-24">
      {/* Header */}
      <header className="bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 text-white p-6 pb-20">
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-emerald-100 text-sm">{t('welcome')}</p>
            <h1 className="text-2xl font-bold">
              {user?.name || user?.email?.split('@')[0] || 'مرحباً بك'}
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
            <span>{statistics?.totalDebts || 0} {t('debts')}</span>
          </div>
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4" />
            <span>{statistics?.paidRatio || 0}% {t('paid')}</span>
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
              {formatCurrency(statistics?.totalOwedToMe || 0, 'DZD')}
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
              {formatCurrency(statistics?.totalIOwe || 0, 'DZD')}
            </p>
          </div>

          <div className="col-span-2 bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-xl border-l-4 border-blue-500 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                <Layers className="w-5 h-5 text-blue-500" />
              </div>
              <div>
                <span className="text-xs text-gray-500 dark:text-gray-400 font-medium block">إجمالي عدد الأقساط المتبقية</span>
                <span className="text-2xl font-bold text-blue-600 dark:text-blue-400">{totalInstallmentsCount} قسط</span>
              </div>
            </div>
          </div>

          <div className="col-span-2 bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-emerald-500" />
                <span className="text-sm text-gray-600 dark:text-gray-400 font-medium">{t('statistics')}</span>
              </div>
              <span className="text-2xl font-bold text-gray-900 dark:text-white">{statistics?.paidRatio || 0}%</span>
            </div>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
              <div
                className="bg-gradient-to-r from-emerald-400 to-teal-500 h-3 rounded-full transition-all duration-500"
                style={{ width: `${statistics?.paidRatio || 0}%` }}
              />
            </div>
            <div className="flex justify-between mt-3 text-sm">
              <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                {t('paidDebts')}: {statistics?.paidDebtsCount || 0}
              </span>
              <span className="text-yellow-600 dark:text-yellow-400 font-medium">
                {t('pendingDebts')}: {statistics?.pendingDebtsCount || 0}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Activity Table */}
      {recentDebts.length > 0 ? (
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
                      <td className="p-3 font-medium text-blue-600 dark:text-blue-400">
                        {debt.installmentsCount || 0}
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
                          <span className="text-[10px] font-bold border border-blue-400 px-0.5 rounded">PDF</span>
                        </button>

                        <button
                          onClick={() => handleShareDebtDetails(debt)}
                          title="مشاركة تفاصيل العميل"
                          className="flex items-center gap-1 p-1.5 bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400 rounded-lg hover:bg-amber-100 transition text-xs font-medium"
                        >
                          <Share2 className="w-4 h-4" />
                          <span>مشاركة</span>
                        </button>

                        <button
                          onClick={() => {
                            setSelectedDebt(debt);
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
      ) : (
        <div className="px-4 mb-6 text-center py-8 bg-white dark:bg-gray-800 rounded-2xl shadow-md">
          <p className="text-gray-500 dark:text-gray-400 text-sm">لا توجد ديون أو مسجلات سابقة حتى الآن.</p>
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
              الأقساط المتبقية: <span className="font-bold text-blue-600">{selectedDebt.installmentsCount || 0}</span>
            </p>

            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                مبلغ القسط المراد خصمه:
              </label>
              <input
                type="number"
                value={installmentAmount}
                onChange={(e) => setInstallmentAmount(e.target.value)}
                placeholder="أدخل مبلغ القسط..."
                className="w-full p-3 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={handlePayInstallment}
                className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white py-3 rounded-xl font-bold shadow-lg transition flex items-center justify-center gap-2"
              >
                <span>تسديد قسط ومشاركة</span>
                <Share2 className="w-4 h-4" />
                <span className="text-xs bg-emerald-700 px-1.5 py-0.5 rounded border border-emerald-400">PDF</span>
              </button>
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
              إضافة دين جديد للعميل
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              العميل: <span className="font-semibold text-gray-800 dark:text-gray-200">{selectedAddDebt.personName}</span>
              <br />
              الدين الحالي: <span className="font-bold text-emerald-600">{formatCurrency(selectedAddDebt.amount, selectedAddDebt.currency)}</span>
            </p>

            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                مبلغ الدين الإضافي:
              </label>
              <input
                type="number"
                value={additionalDebtAmount}
                onChange={(e) => setAdditionalDebtAmount(e.target.value)}
                placeholder="أدخل مبلغ الدين الجديد..."
                className="w-full p-3 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleAddNewDebt}
                className="flex-1 bg-purple-600 hover:bg-purple-700 text-white py-3 rounded-xl font-bold shadow-lg transition flex items-center justify-center gap-2"
              >
                <PlusCircle className="w-5 h-5" />
                <span>إضافة للمبلغ الحالي</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 px-4 py-2 shadow-lg z-40">
        <div className="flex items-center justify-around max-w-md mx-auto">
          <button onClick={() => navigate('/')} className="flex flex-col items-center py-2 text-emerald-500">
            <DollarSign className="w-6 h-6" />
            <span className="text-xs mt-1 font-medium">{t('home')}</span>
          </button>
          <button onClick={() => navigate('/debts')} className="flex flex-col items-center py-2 text-gray-400">
            <Bell className="w-6 h-6" />
            <span className="text-xs mt-1">{t('debts')}</span>
          </button>
          <button onClick={() => navigate('/debts/add')} className="relative -mt-8">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-xl">
              <Plus className="w-8 h-8 text-white" />
            </div>
          </button>
          <button onClick={() => navigate('/debts')} className="flex flex-col items-center py-2 text-gray-400">
            <Users className="w-6 h-6" />
            <span className="text-xs mt-1">{t('people')}</span>
          </button>
          <button onClick={() => navigate('/settings')} className="flex flex-col items-center py-2 text-gray-400">
            <Settings className="w-6 h-6" />
            <span className="text-xs mt-1">{t('settings')}</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
