import { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { useNavigate } from 'react-router-dom';
import { deleteDebt } from '../services/neonService'; // استدعاء دالة الحذف
import {
  TrendingUp,
  TrendingDown,
  Search,
  Filter,
  Plus,
  ChevronDown,
  CheckCircle,
  Clock,
  AlertTriangle,
  MessageCircle,
  Phone,
  DollarSign,
  ArrowLeft,
  X,
  SortAsc,
  Trash2 // تم إضافة أيقونة الحذف
} from 'lucide-react';

/**
 * Debt List Page
 * Displays all debts with search, filter, and sort functionality
 * Integrates with WhatsApp for quick reminders
 */
export default function DebtList() {
  const { t, debts, language, openWhatsApp, darkMode, currentUser, refreshDebts } = useApp();
  const navigate = useNavigate();

  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [sortBy, setSortBy] = useState('newest');
  const [showFilters, setShowFilters] = useState(false);

  // Filter and sort debts
  const filteredDebts = useMemo(() => {
    let result = debts.filter(debt => {
      if (filterType !== 'all' && debt.type !== filterType) return false;
      if (filterStatus !== 'all' && debt.status !== filterStatus) return false;
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          debt.personName.toLowerCase().includes(query) ||
          debt.notes?.toLowerCase().includes(query)
        );
      }
      return true;
    });

    // Sort
    switch (sortBy) {
      case 'newest':
        return result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      case 'oldest':
        return result.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      case 'amount_desc':
        return result.sort((a, b) => b.amount - a.amount);
      case 'amount_asc':
        return result.sort((a, b) => a.amount - b.amount);
      case 'due_date':
        return result.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
      default:
        return result;
    }
  }, [debts, filterType, filterStatus, searchQuery, sortBy]);

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
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const getStatusIcon = (debt) => {
    if (debt.status === 'paid') return <CheckCircle className="w-4 h-4 text-emerald-500" />;
    const dueDate = new Date(debt.dueDate);
    if (dueDate < new Date()) return <AlertTriangle className="w-4 h-4 text-red-500" />;
    return <Clock className="w-4 h-4 text-yellow-500" />;
  };

  const getStatusColor = (debt) => {
    if (debt.status === 'paid') return 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400';
    const dueDate = new Date(debt.dueDate);
    if (dueDate < new Date()) return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400';
    return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400';
  };

  const handleWhatsApp = (e, debt) => {
    e.stopPropagation();
    const message = `${t('whatsappGreeting')}\n\n${t('whatsappBody')}\n${t('personName')}: ${debt.personName}\n${t('amount')}: ${formatCurrency(debt.amount, debt.currency)}\n${t('dueDate')}: ${formatDate(debt.dueDate)}${debt.notes ? '\n\n' + t('notes') + ': ' + debt.notes : ''}\n\n${t('whatsappClosing')}`;
    openWhatsApp(debt.phone || '', message);
  };

  // دالة التعامل مع حذف الدين المتوافقة تماماً مع الباك إند
  const handleDeleteDebt = async (e, debt) => {
    e.stopPropagation(); // منع الانتقال لصفحة تفاصيل الدين
    const nameDisplay = debt.personName || debt.person_name || 'هذا الدين';
    const confirmMessage = language === 'ar' 
      ? `هل أنت تأكد من رغبتك في حذف دين "${nameDisplay}"؟` 
      : 'Are you sure you want to delete this debt?';
      
    if (window.confirm(confirmMessage)) {
      try {
        // استخراج البيانات المتاحة للحذف (سواء بالأيدى أو الاسم)
        const debtIdToDelete = debt.id || debt._id || debt.debt_id || debt.debtId || '';
        const personName = debt.personName || debt.person_name || '';
        const companyName = debt.companyName || debt.company_name || currentUser?.companyName || currentUser?.company_name || '';
        const userId = currentUser?.id || currentUser?._id || 'guest';

        // إرسال طلب الحذف إلى الرابط المحدد شاملاً اسم الشخص واسم الشركة
        const response = await fetch('https://my-dept-2.vercel.app/api/Delete', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': userId,
            'x-tenant-schema': companyName ? `schema_${companyName.toLowerCase().replace(/[^a-zA-Z0-9_]/g, '')}` : ''
          },
          body: JSON.stringify({
            action: 'DELETE',
            id: debtIdToDelete,
            personName: personName,
            person_name: personName,
            companyName: companyName,
            company_name: companyName,
            userId: userId
          })
        });

        // استدعاء دالة neonService الاحتياطية
        if (typeof deleteDebt === 'function') {
          await deleteDebt({
            id: debtIdToDelete,
            personName: personName,
            companyName: companyName,
            userId: userId
          });
        }
        
        if (refreshDebts) {
          await refreshDebts(); // تحديث القائمة بعد نجاح الحذف
        }
      } catch (error) {
        console.error('Error deleting debt:', error);
      }
    }
  };

  // Calculate totals
  const totalOwedToMe = debts
    .filter(d => d.type === 'owed_to_me' && d.status !== 'paid')
    .reduce((sum, d) => sum + d.amount, 0);

  const totalIOwe = debts
    .filter(d => d.type === 'i_owe' && d.status !== 'paid')
    .reduce((sum, d) => sum + d.amount, 0);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pb-24">
      {/* Header */}
      <header className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white p-4 sticky top-0 z-10 shadow-lg">
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => navigate('/')}
            className="p-2 rounded-xl hover:bg-white/20 transition"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold flex-1">{t('debts')}</h1>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`p-2 rounded-xl transition ${showFilters ? 'bg-white/30' : 'hover:bg-white/20'}`}
          >
            <Filter className="w-5 h-5" />
          </button>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-emerald-200" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="w-full pl-12 pr-4 py-3 rounded-xl bg-white/20 text-white placeholder-emerald-200 border border-white/30 focus:bg-white/30 focus:border-white transition backdrop-blur-sm"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg hover:bg-white/20 transition"
            >
              <X className="w-4 h-4 text-emerald-200" />
            </button>
          )}
        </div>

        {/* Filters Panel */}
        {showFilters && (
          <div className="mt-4 p-4 rounded-xl bg-white/10 backdrop-blur-sm space-y-3">
            <div className="flex gap-2 flex-wrap">
              {/* Type Filter */}
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="flex-1 min-w-[120px] px-3 py-2 rounded-lg bg-white/20 text-white border border-white/30 text-sm"
              >
                <option value="all">{t('debtType')}</option>
                <option value="owed_to_me">{t('owedToMe')}</option>
                <option value="i_owe">{t('iOwe')}</option>
              </select>

              {/* Status Filter */}
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="flex-1 min-w-[120px] px-3 py-2 rounded-lg bg-white/20 text-white border border-white/30 text-sm"
              >
                <option value="all">{t('status')}</option>
                <option value="pending">{t('pending')}</option>
                <option value="paid">{t('paid')}</option>
              </select>
            </div>

            {/* Sort */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-white/20 text-white border border-white/30 text-sm"
            >
              <option value="newest">{t('sortNewest')}</option>
              <option value="oldest">{t('sortOldest')}</option>
              <option value="amount_desc">{t('sortAmount')} ({language === 'ar' ? 'الأكثر' : language === 'fr' ? 'Plus' : 'Highest'})</option>
              <option value="amount_asc">{t('sortAmount')} ({language === 'ar' ? 'الأقل' : language === 'fr' ? 'Moins' : 'Lowest'})</option>
              <option value="due_date">{t('sortDueDate')}</option>
            </select>
          </div>
        )}
      </header>

      {/* Summary Cards */}
      <div className="px-4 -mt-2 mb-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-lg border-l-4 border-emerald-500">
            <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">{t('owedToMe')}</p>
            <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400 mt-1">
              {formatCurrency(totalOwedToMe, 'DZD')}
            </p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-lg border-l-4 border-red-500">
            <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">{t('iOwe')}</p>
            <p className="text-lg font-bold text-red-600 dark:text-red-400 mt-1">
              {formatCurrency(totalIOwe, 'DZD')}
            </p>
          </div>
        </div>
      </div>

      {/* Results Count */}
      {searchQuery || filterType !== 'all' || filterStatus !== 'all' ? (
        <div className="px-4 mb-3">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {filteredDebts.length} {language === 'ar' ? 'نتيجة' : language === 'fr' ? 'résultats' : 'results'}
          </p>
        </div>
      ) : null}

      {/* Debt List */}
      {filteredDebts.length > 0 ? (
        <div className="px-4 space-y-3">
          {filteredDebts.map((debt, index) => (
            <div
              key={debt.id || index}
              onClick={() => navigate(`/debts/${debt.id}`)}
              className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg overflow-hidden cursor-pointer hover:shadow-xl active:scale-[0.98] transition-all"
            >
              <div className="p-4">
                <div className="flex items-start gap-4">
                  {/* Type Icon */}
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

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <h3 className="font-bold text-gray-900 dark:text-white text-lg">
                          {debt.personName}
                        </h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          {formatDate(debt.dueDate)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className={`text-xl font-bold ${
                          debt.type === 'owed_to_me' ? 'text-emerald-500' : 'text-red-500'
                        }`}>
                          {formatCurrency(debt.amount, debt.currency)}
                        </p>
                      </div>
                    </div>

                    {/* Status & Actions */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs px-3 py-1 rounded-full font-medium flex items-center gap-1 ${getStatusColor(debt)}`}>
                          {getStatusIcon(debt)}
                          {debt.status === 'paid' ? t('paid') : t('pending')}
                        </span>
                        {debt.currency !== 'DZD' && (
                          <span className="text-xs px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                            {debt.currency}
                          </span>
                        )}
                      </div>

                      {/* Quick Actions & Delete Button */}
                      <div className="flex items-center gap-1">
                        {debt.phone && (
                          <>
                            <button
                              onClick={(e) => handleWhatsApp(e, debt)}
                              className="p-2 rounded-lg hover:bg-green-50 dark:hover:bg-green-900/20 text-green-500 transition"
                              title="WhatsApp"
                            >
                              <MessageCircle className="w-5 h-5" />
                            </button>
                            <a
                              href={`tel:${debt.phone}`}
                              onClick={(e) => e.stopPropagation()}
                              className="p-2 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-500 transition"
                              title={t('call')}
                            >
                              <Phone className="w-5 h-5" />
                            </a>
                          </>
                        )}
                        
                        {/* زر الحذف الأيقوني لكل دين */}
                        <button
                          onClick={(e) => handleDeleteDebt(e, debt)}
                          className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 transition"
                          title="حذف الدين"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Notes Preview */}
                {debt.notes && (
                  <p className="mt-3 text-sm text-gray-500 dark:text-gray-400 line-clamp-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg p-2">
                    {debt.notes}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-4 py-16 text-center">
          <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
            <DollarSign className="w-12 h-12 text-gray-400" />
          </div>
          <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-3">
            {t('noDebts')}
          </h3>
          <p className="text-gray-500 dark:text-gray-400 mb-8 max-w-sm mx-auto">
            {searchQuery || filterType !== 'all' || filterStatus !== 'all'
              ? (language === 'ar' ? 'لا توجد نتائج' : language === 'fr' ? 'Aucun résultat' : 'No results found')
              : (language === 'ar' ? 'أضف أول دين لك' : language === 'fr' ? 'Ajoutez votre première dette' : 'Add your first debt')}
          </p>
          <button
            onClick={() => navigate('/debts/add')}
            className="inline-flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-2xl font-bold shadow-lg hover:shadow-xl transition-all"
          >
            <Plus className="w-6 h-6" />
            {t('addDebt')}
          </button>
        </div>
      )}

      {/* FAB */}
      <button
        onClick={() => navigate('/debts/add')}
        className="fixed bottom-20 right-4 w-16 h-16 rounded-full bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-xl flex items-center justify-center hover:scale-110 transition-transform"
      >
        <Plus className="w-7 h-7" />
      </button>
    </div>
  );
}
