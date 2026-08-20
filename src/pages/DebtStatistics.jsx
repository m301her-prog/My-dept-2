import { useApp } from '../context/AppContext.jsx';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  CheckCircle,
  Clock,
  AlertTriangle,
  Calendar,
  BarChart3,
  Repeat,
  CreditCard
} from 'lucide-react';

/**
 * Debt Statistics Page
 * Live statistics with colored cards and charts, dark mode support
 */
export default function DebtStatistics() {
  const { t, statistics, language, darkMode, debts, user } = useApp();
  const navigate = useNavigate();

  const monthlyStats = statistics.monthlyStats || [];
  const hasScheduledDebts = statistics.scheduledDebtsCount > 0;

  // Calculate max for chart scaling
  const maxAmount = Math.max(
    ...monthlyStats.map(m => Math.max(m.owedToMe, m.iOwe)),
    1
  );

  const statCards = [
    {
      label: language === 'ar' ? 'المستحق لي' : language === 'fr' ? 'Du a moi' : 'Owed to Me',
      value: statistics.totalOwedToMe,
      icon: TrendingUp,
      color: 'emerald',
      bgColor: 'bg-emerald-100 dark:bg-emerald-900/30',
      iconColor: 'text-emerald-500',
      textColor: 'text-emerald-600 dark:text-emerald-400',
      prefix: '+'
    },
    {
      label: language === 'ar' ? 'المتوجب عليّ' : language === 'fr' ? 'Je dois' : 'I Owe',
      value: statistics.totalIOwe,
      icon: TrendingDown,
      color: 'red',
      bgColor: 'bg-red-100 dark:bg-red-900/30',
      iconColor: 'text-red-500',
      textColor: 'text-red-600 dark:text-red-400',
      prefix: '-'
    },
    {
      label: language === 'ar' ? 'ديون مدفوعة' : language === 'fr' ? 'Dettes payees' : 'Paid Debts',
      value: statistics.paidDebtsCount,
      icon: CheckCircle,
      color: 'blue',
      bgColor: 'bg-blue-100 dark:bg-blue-900/30',
      iconColor: 'text-blue-500',
      textColor: 'text-blue-600 dark:text-blue-400',
      isCount: true
    },
    {
      label: language === 'ar' ? 'ديون معلقة' : language === 'fr' ? 'Dettes en attente' : 'Pending Debts',
      value: statistics.pendingDebtsCount,
      icon: Clock,
      color: 'amber',
      bgColor: 'bg-amber-100 dark:bg-amber-900/30',
      iconColor: 'text-amber-500',
      textColor: 'text-amber-600 dark:text-amber-400',
      isCount: true
    }
  ];

  // Overdue count
  const overdueCount = statistics.overdueDebts?.length || 0;
  const scheduledCount = statistics.scheduledDebtsCount || 0;
  const scheduledAmount = statistics.totalScheduledAmount || 0;

  // Format currency
  const formatCurrency = (amount, prefix = '') => {
    return `${prefix}${amount.toLocaleString()} DZD`;
  };

  // Get month name
  const getMonthName = (monthIndex, lang) => {
    const months = {
      ar: ['جانفي', 'فيفري', 'مارس', 'أفريل', 'ماي', 'جوان', 'جويلية', 'أوت', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'],
      fr: ['Jan', 'Fev', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aout', 'Sep', 'Oct', 'Nov', 'Dec'],
      en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    };
    return months[lang] || months.en;
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pb-8">
      {/* Header */}
      <header className="bg-gradient-to-r from-blue-500 to-indigo-600 text-white p-4 sticky top-0 z-10 shadow-lg">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-xl hover:bg-white/20 transition"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold">
              {language === 'ar' ? 'إحصائيات الديون' : language === 'fr' ? 'Statistiques des dettes' : 'Debt Statistics'}
            </h1>
          </div>
          <div className="p-2 rounded-xl bg-white/20">
            <BarChart3 className="w-5 h-5" />
          </div>
        </div>
      </header>

      <div className="p-4 space-y-4">
        {/* Net Balance Card */}
        <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl p-6 shadow-xl text-white">
          <p className="text-sm text-gray-400 font-medium mb-2">
            {language === 'ar' ? 'صافي الرصيد' : language === 'fr' ? 'Solde net' : 'Net Balance'}
          </p>
          <div className="flex items-end gap-3">
            <span className={`text-4xl font-bold ${
              (statistics.totalOwedToMe - statistics.totalIOwe) >= 0
                ? 'text-emerald-400'
                : 'text-red-400'
            }`}>
              {formatCurrency(statistics.totalOwedToMe - statistics.totalIOwe,
                (statistics.totalOwedToMe - statistics.totalIOwe) >= 0 ? '+' : '')}
            </span>
          </div>
          <div className="mt-4 flex items-center gap-2 text-sm">
            <div className={`w-3 h-3 rounded-full ${
              (statistics.totalOwedToMe - statistics.totalIOwe) >= 0 ? 'bg-emerald-400' : 'bg-red-400'
            }`} />
            <span className="text-gray-400">
              {(statistics.totalOwedToMe - statistics.totalIOwe) >= 0
                ? (language === 'ar' ? 'صافي إيجابي' : language === 'fr' ? 'Solde positif' : 'Positive balance')
                : (language === 'ar' ? 'صافي سلبي' : language === 'fr' ? 'Solde negatif' : 'Negative balance')}
            </span>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-3">
          {statCards.map((stat, index) => (
            <div
              key={index}
              className="bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-lg"
            >
              <div className={`w-10 h-10 rounded-xl ${stat.bgColor} flex items-center justify-center mb-3`}>
                <stat.icon className={`w-5 h-5 ${stat.iconColor}`} />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 font-medium mb-1">
                {stat.label}
              </p>
              <p className={`text-lg font-bold ${stat.textColor}`}>
                {stat.isCount ? stat.value : formatCurrency(stat.value, stat.prefix)}
              </p>
            </div>
          ))}
        </div>

        {/* Overdue & Scheduled Row */}
        <div className="grid grid-cols-2 gap-3">
          {/* Overdue */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-lg border-l-4 border-red-500">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              <span className="text-xs font-bold text-red-500">
                {language === 'ar' ? 'متأخرات' : language === 'fr' ? 'En retard' : 'Overdue'}
              </span>
            </div>
            <p className="text-2xl font-bold text-red-600 dark:text-red-400">
              {overdueCount}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {language === 'ar' ? 'ديون متأخرة' : language === 'fr' ? 'dettes en retard' : 'debts overdue'}
            </p>
          </div>

          {/* Scheduled */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-lg border-l-4 border-blue-500">
            <div className="flex items-center gap-2 mb-2">
              <Repeat className="w-5 h-5 text-blue-500" />
              <span className="text-xs font-bold text-blue-500">
                {language === 'ar' ? 'مجدولة' : language === 'fr' ? 'Planifiees' : 'Scheduled'}
              </span>
            </div>
            <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
              {scheduledCount}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {scheduledAmount > 0 ? formatCurrency(scheduledAmount) : (language === 'ar' ? 'بدون جدولة' : language === 'fr' ? 'Non planifie' : 'No schedule')}
            </p>
          </div>
        </div>

        {/* Payment Progress */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-gray-900 dark:text-white">
              {language === 'ar' ? 'نسبة السداد' : language === 'fr' ? 'Taux de paiement' : 'Payment Progress'}
            </h3>
            <span className="text-2xl font-bold text-emerald-500">
              {Math.round(statistics.paidRatio || 0)}%
            </span>
          </div>
          <div className="w-full h-4 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-400 to-teal-500 rounded-full transition-all duration-500"
              style={{ width: `${statistics.paidRatio || 0}%` }}
            />
          </div>
          <div className="mt-3 flex justify-between text-sm text-gray-500 dark:text-gray-400">
            <span>
              {language === 'ar' ? 'مدفوع:' : language === 'fr' ? 'Paye:' : 'Paid:'} {statistics.paidDebtsCount}
            </span>
            <span>
              {language === 'ar' ? 'إجمالي:' : language === 'fr' ? 'Total:' : 'Total:'} {debts.length}
            </span>
          </div>
        </div>

        {/* Monthly Chart */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-lg">
          <div className="flex items-center gap-3 mb-6">
            <Calendar className="w-5 h-5 text-indigo-500" />
            <h3 className="font-bold text-gray-900 dark:text-white">
              {language === 'ar' ? 'نشاط آخر 6 أشهر' : language === 'fr' ? 'Activite des 6 derniers mois' : 'Last 6 Months Activity'}
            </h3>
          </div>

          {/* Chart Legend */}
          <div className="flex items-center gap-4 mb-4">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-emerald-500" />
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {language === 'ar' ? 'المستحق لي' : language === 'fr' ? 'Du a moi' : 'Owed to Me'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-500" />
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {language === 'ar' ? 'المتوجب عليّ' : language === 'fr' ? 'Je dois' : 'I Owe'}
              </span>
            </div>
          </div>

          {/* Bar Chart */}
          <div className="flex items-end justify-between gap-2 h-40">
            {monthlyStats.map((month, index) => (
              <div key={index} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full flex items-end justify-center gap-1 h-32">
                  {/* Owed to me bar */}
                  <div
                    className="w-3 bg-gradient-to-t from-emerald-400 to-emerald-500 rounded-t transition-all duration-300"
                    style={{ height: `${(month.owedToMe / maxAmount) * 100}%`, minHeight: month.owedToMe > 0 ? '4px' : '0' }}
                  />
                  {/* I owe bar */}
                  <div
                    className="w-3 bg-gradient-to-t from-red-400 to-red-500 rounded-t transition-all duration-300"
                    style={{ height: `${(month.iOwe / maxAmount) * 100}%`, minHeight: month.iOwe > 0 ? '4px' : '0' }}
                  />
                </div>
                <span className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {getMonthName(month.month, language)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Summary Card */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-lg">
          <h3 className="font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-indigo-500" />
            {language === 'ar' ? 'ملخص عام' : language === 'fr' ? 'Resume general' : 'General Summary'}
          </h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-700">
              <span className="text-gray-500 dark:text-gray-400">
                {language === 'ar' ? 'إجمالي الديون' : language === 'fr' ? 'Total des dettes' : 'Total Debts'}
              </span>
              <span className="font-bold text-gray-900 dark:text-white">{debts.length}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-700">
              <span className="text-gray-500 dark:text-gray-400">
                {language === 'ar' ? 'إجمالي المستحق لي' : language === 'fr' ? 'Total du a moi' : 'Total Owed to Me'}
              </span>
              <span className="font-bold text-emerald-600 dark:text-emerald-400">
                {formatCurrency(statistics.totalOwedToMe)}
              </span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-700">
              <span className="text-gray-500 dark:text-gray-400">
                {language === 'ar' ? 'إجمالي المتوجب عليّ' : language === 'fr' ? 'Total que je dois' : 'Total I Owe'}
              </span>
              <span className="font-bold text-red-600 dark:text-red-400">
                {formatCurrency(statistics.totalIOwe)}
              </span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-gray-500 dark:text-gray-400">
                {language === 'ar' ? 'الديون المجدولة' : language === 'fr' ? 'Dettes planifiees' : 'Scheduled Debts'}
              </span>
              <span className="font-bold text-blue-600 dark:text-blue-400">
                {scheduledCount}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
