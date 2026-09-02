import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { useNavigate } from 'react-router-dom';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
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
  Loader2,
  RefreshCw
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
    loading,
    fetchDebtsData
  } = useApp();

  const navigate = useNavigate();

  const [selectedDebt, setSelectedDebt] = useState(null);
  const [installmentAmount, setInstallmentAmount] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [selectedAddDebt, setSelectedAddDebt] = useState(null);
  const [additionalDebtAmount, setAdditionalDebtAmount] = useState('');
  const [isAddDebtModalOpen, setIsAddDebtModalOpen] = useState(false);

  const totalInstallmentsCount = (debts || []).reduce((acc, curr) => acc + (Number(curr.installmentsCount) || 0), 0);

  const loadCustomerDataImmediately = useCallback(async () => {
    try {
      if (fetchDebtsData && typeof fetchDebtsData === 'function') {
        await fetchDebtsData();
      }
    } catch (error) {
      console.error('خطأ أثناء إظهار بيانات العملاء فوراً:', error);
    }
  }, [fetchDebtsData]);

  useEffect(() => {
    loadCustomerDataImmediately();
  }, [user, loadCustomerDataImmediately]);

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

  /**
   * دالة المساعدة لمعالجة وحفظ ملف الـ PDF الناتج عبر Capacitor أو المتصفح
   */
  const handlePDFOutput = async (doc, fileName) => {
    try {
      if (!Capacitor.isNativePlatform()) {
        doc.save(fileName);
      } else {
        const pdfBase64 = doc.output('datauristring').split(',')[1];
        const cleanFileName = fileName.replace(/[/\\?%*:|"<>]/g, '_');

        const savedFile = await Filesystem.writeFile({
          path: cleanFileName,
          data: pdfBase64,
          directory: Directory.Cache
        });

        await Share.share({
          title: cleanFileName,
          text: 'تم توليد ملف PDF بنجاح',
          url: savedFile.uri,
          dialogTitle: 'فتح أو مشاركة ملف PDF'
        });
      }
    } catch (error) {
      console.error('خطأ في استخراج/مشاركة PDF:', error);
    }
  };

  /**
   * توليد جدول الديون برمجياً بدلاً من تصوير الشاشة
   */
  const handleDownloadTablePDF = async () => {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    doc.setFontSize(16);
    doc.text('Debts Summary / جدول الديون', 14, 15);

    const tableHeaders = [['Person Name', 'Amount', 'Installments', 'Status']];
    const tableData = recentDebts.map(debt => [
      debt.personName || '-',
      `${debt.amount} ${debt.currency || 'DZD'}`,
      debt.installmentsCount || '0',
      debt.status === 'paid' ? 'Paid' : 'Pending'
    ]);

    doc.autoTable({
      startY: 25,
      head: tableHeaders,
      body: tableData,
      theme: 'grid',
      styles: { fontSize: 10, cellPadding: 3 },
      headStyles: { fillColor: [16, 185, 129], textColor: [255, 255, 255] }
    });

    await handlePDFOutput(doc, `Debts_Report_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  /**
   * توليد الشيك مباشرة في الذاكرة
   */
  const handlePrintCheckPDF = async (debt) => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    doc.setFontSize(18);
    doc.text('STATEMENT / DEBT CHECK', 105, 20, { align: 'center' });

    doc.setFontSize(10);
    doc.text(`Date: ${formatDate(new Date())}`, 14, 30);
    doc.text(`Client: ${debt.personName}`, 14, 38);
    doc.text(`Type: ${debt.type === 'owed_to_me' ? 'Owed to me' : 'I owe'}`, 14, 46);
    doc.text(`Total Amount: ${debt.amount} ${debt.currency || 'DZD'}`, 14, 54);
    doc.text(`Status: ${debt.status === 'paid' ? 'Paid' : 'Pending'}`, 14, 62);

    const history = debt.history || [];
    const tableHeaders = [['#', 'Date', 'Type', 'Amount', 'Note']];
    const tableData = history.map((item, index) => [
      index + 1,
      formatDate(item.date || new Date()),
      item.type === 'add' ? 'Addition (+)' : 'Payment (-)',
      `${item.amount} ${debt.currency || 'DZD'}`,
      item.note || '-'
    ]);

    doc.autoTable({
      startY: 70,
      head: tableHeaders,
      body: tableData,
      theme: 'grid',
      headStyles: { fillColor: [31, 41, 55], textColor: [255, 255, 255] }
    });

    await handlePDFOutput(doc, `Check_${debt.personName}.pdf`);
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

    // توليد وصل التسديد برمجياً
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    doc.setFontSize(16);
    doc.text('PAYMENT RECEIPT', 105, 20, { align: 'center' });

    doc.setFontSize(10);
    doc.text(`Client: ${selectedDebt.personName}`, 14, 32);
    doc.text(`Paid Amount: ${amountPaid} ${selectedDebt.currency || 'DZD'}`, 14, 40);
    doc.text(`Remaining Amount: ${newAmount} ${selectedDebt.currency || 'DZD'}`, 14, 48);
    doc.text(`Date: ${formatDate(new Date())}`, 14, 56);

    const tableHeaders = [['#', 'Date', 'Type', 'Amount', 'Note']];
    const tableData = updatedHistory.map((item, index) => [
      index + 1,
      formatDate(item.date || new Date()),
      item.type === 'add' ? 'Addition (+)' : 'Payment (-)',
      `${item.amount} ${selectedDebt.currency || 'DZD'}`,
      item.note || '-'
    ]);

    doc.autoTable({
      startY: 65,
      head: tableHeaders,
      body: tableData,
      theme: 'grid',
      headStyles: { fillColor: [16, 185, 129], textColor: [255, 255, 255] }
    });

    await handlePDFOutput(doc, `Receipt_${selectedDebt.personName}.pdf`);

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

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col justify-center items-center">
        <Loader2 className="w-10 h-10 text-emerald-500 animate-spin mb-4" />
        <p className="text-gray-600 dark:text-gray-300 font-medium">جاري تحميل بيانات العملاء...</p>
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
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={loadCustomerDataImmediately}
              className="p-2 rounded-xl bg-white/20 hover:bg-white/30 transition flex items-center gap-1 text-xs"
              title="تحديث بيانات العملاء فوراً"
            >
              <RefreshCw className="w-4 h-4" />
            </button>

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
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-xl border-l-4 border-emerald-500">
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

          <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-xl border-l-4 border-red-500">
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
                <span className="text-xs text-gray-500 dark:text-gray-400 font-medium block">إجمالي الأقساط المتبقية</span>
                <span className="text-2xl font-bold text-blue-600 dark:text-blue-400">{totalInstallmentsCount} قسط</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Table Section */}
      {recentDebts.length > 0 ? (
        <div className="px-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="flex items-center gap-2 text-sm font-bold text-gray-500 dark:text-gray-400 uppercase">
              <Activity className="w-4 h-4" />
              {t('recentActivity')}
            </h2>
            
            <button
              onClick={handleDownloadTablePDF}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-emerald-500 text-white rounded-lg shadow font-medium"
            >
              <Download className="w-4 h-4" />
              <span>تحميل PDF</span>
            </button>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg overflow-hidden p-2">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm text-gray-700 dark:text-gray-200">
                <thead className="bg-gray-100 dark:bg-gray-700 text-xs uppercase">
                  <tr>
                    <th className="p-3">الاسم</th>
                    <th className="p-3">المبلغ</th>
                    <th className="p-3">الأقساط</th>
                    <th className="p-3">الإجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {recentDebts.map((debt) => (
                    <tr key={debt.id} className="border-b border-gray-100 dark:border-gray-700">
                      <td className="p-3 font-semibold">{debt.personName}</td>
                      <td className="p-3 font-bold">{formatCurrency(debt.amount, debt.currency)}</td>
                      <td className="p-3 text-blue-600 font-medium">{debt.installmentsCount || 0}</td>
                      <td className="p-3 flex items-center gap-2">
                        <button
                          onClick={() => handlePrintCheckPDF(debt)}
                          className="p-1.5 bg-blue-50 text-blue-600 rounded-lg text-xs font-medium flex items-center gap-1"
                        >
                          <FileText className="w-4 h-4" />
                          <span>شيك</span>
                        </button>
                        <button
                          onClick={() => {
                            setSelectedDebt(debt);
                            setIsModalOpen(true);
                          }}
                          className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg text-xs font-medium flex items-center gap-1"
                        >
                          <CreditCard className="w-4 h-4" />
                          <span>قسط</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      {/* Modal قسط */}
      {isModalOpen && selectedDebt && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-md w-full p-6 shadow-2xl relative">
            <button onClick={() => setIsModalOpen(false)} className="absolute left-4 top-4 text-gray-400">
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-lg font-bold mb-4">خصم قسط من الدين</h3>
            <input
              type="number"
              value={installmentAmount}
              onChange={(e) => setInstallmentAmount(e.target.value)}
              placeholder="المبلغ..."
              className="w-full p-3 bg-gray-50 border rounded-xl mb-4"
            />
            <button
              onClick={handlePayInstallment}
              className="w-full bg-emerald-500 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2"
            >
              <span>تسديد واستخراج PDF</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
