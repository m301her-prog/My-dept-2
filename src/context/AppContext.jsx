import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import neonService, {
  triggerAndroidCapture,
  saveToLocalStorage,
  loadFromLocalStorage,
  registerUserAndCreateTables,
  authUser,
  logoutUser,
  getUserById,
  fetchDebts,
  addDebt,
  updateDebtStatus,
  deleteDebt,
  getAdminStats,
  getAllUsers,
  toggleUserStatus,
  deleteUser,
  calculateStatistics,
  downloadReport,
  isNeonConfigured
} from '../services/neonService.js';
import { translations } from '../i18n/translations.jsx';
import { LocalNotifications } from '@capacitor/local-notifications';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  // Auth state
  const [user, setUser] = useState(() => {
    return loadFromLocalStorage('currentUser', null);
  });
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    const saved = loadFromLocalStorage('currentUser', null);
    return !!saved;
  });
  const [isAdmin, setIsAdmin] = useState(() => {
    const saved = loadFromLocalStorage('currentUser', null);
    return saved?.isAdmin || saved?.email === 'admin@debts.dz';
  });

  // UI state
  const [darkMode, setDarkMode] = useState(() => {
    return loadFromLocalStorage('darkMode', false);
  });
  const [language, setLanguage] = useState(() => {
    return loadFromLocalStorage('language', 'ar');
  });
  const [loading, setLoading] = useState(false);
  const [notification, setNotification] = useState(null);

  // Settings
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => {
    return loadFromLocalStorage('notificationsEnabled', true);
  });
  const [whatsappEnabled, setWhatsappEnabled] = useState(() => {
    return loadFromLocalStorage('whatsappEnabled', true);
  });

  // Data state
  const [debts, setDebts] = useState([]);
  const [users, setUsers] = useState([]);

  // دالة جلب الديون عبر خدمة neonService
  const syncDebtsFromServer = useCallback(async (userId) => {
    if (!userId) return;
    try {
      const userDebts = await fetchDebts(userId);
      setDebts(userDebts || []);
      saveToLocalStorage(`user_${userId}_debts`, userDebts || []);
    } catch (err) {
      console.error("خطأ أثناء جلب الديون:", err);
      const localDebts = loadFromLocalStorage(`user_${userId}_debts`, []);
      setDebts(localDebts);
    }
  }, []);

  // Load debts when user changes
  useEffect(() => {
    if (user && user.id) {
      syncDebtsFromServer(user.id);
    } else {
      setDebts([]);
    }
  }, [user, syncDebtsFromServer]);

  // Translation helper
  const t = useCallback((key) => {
    return translations[language]?.[key] || key;
  }, [language]);

  // Persistence effects
  useEffect(() => {
    saveToLocalStorage('darkMode', darkMode);
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  useEffect(() => {
    saveToLocalStorage('language', language);
    document.documentElement.lang = language === 'ar' ? 'ar' : language;
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
  }, [language]);

  useEffect(() => {
    saveToLocalStorage('notificationsEnabled', notificationsEnabled);
  }, [notificationsEnabled]);

  useEffect(() => {
    saveToLocalStorage('whatsappEnabled', whatsappEnabled);
  }, [whatsappEnabled]);

  // Auth functions
  const login = async (email, password) => {
    setLoading(true);
    try {
      const serverUser = await authUser(email, password);

      if (!serverUser) {
        throw new Error('بيانات الدخول غير صحيحة');
      }

      // تحقق من حالة تعطيل الحساب
      const isAccountSuspended = 
        serverUser.active === false || 
        serverUser.active === 'false' || 
        serverUser.active === 0 || 
        serverUser.active === '0' ||
        serverUser.status === 'disabled' ||
        serverUser.status === 'inactive';

      if (isAccountSuspended) {
        throw new Error(language === 'ar' ? 'تم غلق هذا الحساب، يرجى التواصل مع الإدارة' : 'Account suspended');
      }

      const authenticatedUser = {
        id: serverUser.id,
        name: serverUser.name,
        email: serverUser.email,
        phone: serverUser.phone || '',
        companyName: serverUser.companyName || serverUser.company_name || '',
        isAdmin: serverUser.isAdmin || email === 'admin@debts.dz',
        createdAt: serverUser.createdAt || new Date().toISOString()
      };

      const localUsers = loadFromLocalStorage('registeredUsers', []);
      const existingUserIndex = localUsers.findIndex(u => u.email.toLowerCase() === email.toLowerCase().trim());
      
      if (existingUserIndex === -1) {
        localUsers.push({ ...authenticatedUser, password });
      } else {
        localUsers[existingUserIndex] = { ...localUsers[existingUserIndex], ...authenticatedUser, password };
      }
      saveToLocalStorage('registeredUsers', localUsers);

      setUser(authenticatedUser);
      setIsAuthenticated(true);
      setIsAdmin(authenticatedUser.isAdmin);
      saveToLocalStorage('currentUser', authenticatedUser);

      triggerAndroidCapture('USER_LOGGED_IN', { userId: authenticatedUser.id, email: authenticatedUser.email });

      showNotification(t('loginSuccess'), 'success');
    } catch (error) {
      showNotification(error.message, 'error');
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const register = async (name, email, password, phone, companyName) => {
    setLoading(true);
    try {
      // إرسال البيانات لدالة الخدمة المحلية للإنشاء وتهيئة السكيمّا بواسطة اسم الشركة
      const newUser = await registerUserAndCreateTables(name, email, password, phone, companyName);
      
      const authenticatedUser = {
        ...newUser,
        companyName: companyName || newUser.companyName || '',
        isAdmin: newUser?.isAdmin || false
      };

      setUser(authenticatedUser);
      setIsAuthenticated(true);
      setIsAdmin(authenticatedUser.isAdmin);
      saveToLocalStorage('currentUser', authenticatedUser);

      triggerAndroidCapture('USER_REGISTERED', { userId: authenticatedUser.id, email: authenticatedUser.email });

      showNotification(t('registerSuccess'), 'success');
      return authenticatedUser;
    } catch (error) {
      showNotification(error.message, 'error');
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    if (user) {
      triggerAndroidCapture('USER_LOGGED_OUT', { userId: user.id });
      await logoutUser(user.id);
    }
    setUser(null);
    setIsAuthenticated(false);
    setIsAdmin(false);
    setDebts([]);
    saveToLocalStorage('currentUser', null);
    showNotification(t('logoutSuccess'), 'success');
  };

  // الإضافة المحلية
  const handleAddDebt = async (debtData) => {
    setLoading(true);
    try {
      const newDebt = await addDebt(user.id, debtData);
      
      setDebts(prev => [newDebt, ...prev]);
      showNotification(t('debtAdded'), 'success');
      return newDebt;
    } catch (error) {
      showNotification(error.message, 'error');
      throw error;
    } finally {
      setLoading(false);
    }
  };

  // التحديث المحلي
  const handleUpdateDebt = async (id, updates) => {
    setLoading(true);
    try {
      const updatedDebt = await updateDebtStatus(user.id, id, updates);

      setDebts(prev => prev.map(d => d.id === id ? { ...d, ...updatedDebt } : d));
      showNotification(t('debtUpdated'), 'success');
    } catch (error) {
      showNotification(error.message, 'error');
      throw error;
    } finally {
      setLoading(false);
    }
  };

  // الحذف المحلي المعدل للتوافق مع neonService.js الأصلي
  const handleDeleteDebt = async (id) => {
    setLoading(true);
    try {
      // تمرير المعرف أولاً، ثم اسم الشركة، ثم معرف المستخدم ليتوافق مع توقيع الخدمة
      await deleteDebt(id, user?.companyName || '', user?.id || 'guest');
      setDebts(prev => prev.filter(d => d.id !== id && d._id !== id));
      showNotification(t('debtDeleted'), 'success');
    } catch (error) {
      showNotification(error.message, 'error');
      throw error;
    } finally {
      setLoading(false);
    }
  };

  // Admin functions
  const handleFetchUsers = async () => {
    setLoading(true);
    try {
      const allUsers = await getAllUsers();
      setUsers(allUsers || []);
      saveToLocalStorage('registeredUsers', allUsers || []);
    } catch (error) {
      console.error("خطأ في جلب الحسابات:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleUserStatus = async (userId, active) => {
    setLoading(true);
    try {
      const isTrueActive = active === true || active === 'true' || active === 1 || active === '1';

      await toggleUserStatus(userId, isTrueActive);
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, active: isTrueActive } : u));
      
      triggerAndroidCapture('USER_STATUS_CHANGED', { userId, active: isTrueActive });
      showNotification(isTrueActive ? 'تم تفعيل الحساب بنجاح' : 'تم غلق الحساب بنجاح', 'success');
    } catch (error) {
      showNotification(error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteUser = async (userId) => {
    setLoading(true);
    try {
      await deleteUser(userId);
      setUsers(prev => prev.filter(u => u.id !== userId));
      showNotification('تم حذف الحساب بنجاح', 'success');
    } catch (error) {
      showNotification(error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Notification helper
  const showNotification = (message, type = 'info') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  // Calculate statistics
  const statistics = user ? calculateStatistics(user.id) : {
    totalOwedToMe: 0,
    totalIOwe: 0,
    paidDebtsCount: 0,
    pendingDebtsCount: 0,
    overdueDebts: [],
    paidRatio: 0
  };

  // Refresh debts
  const refreshDebts = useCallback(() => {
    if (user && user.id) {
      syncDebtsFromServer(user.id);
    }
  }, [user, syncDebtsFromServer]);

  // Request notification permission
  const requestNotificationPermission = async () => {
    try {
      let status = await LocalNotifications.checkPermissions();
      if (status.display === 'prompt' || status.display === 'denied') {
        status = await LocalNotifications.requestPermissions();
      }
      return status.display === 'granted';
    } catch (error) {
      console.error("Error checking/requesting local notification permission:", error);
      return false;
    }
  };

  // Send local notification
  const sendNotification = async (title, body) => {
    if (notificationsEnabled) {
      try {
        const status = await LocalNotifications.checkPermissions();
        if (status.display === 'granted') {
          await LocalNotifications.schedule({
            notifications: [
              {
                title: title,
                body: body,
                id: Math.floor(Math.random() * 10000),
                schedule: { at: new Date(Date.now() + 500) },
                sound: null,
                attachments: null,
                actionTypeId: ""
              }
            ]
          });
        }
      } catch (error) {
        console.error("Error sending local notification:", error);
      }
    }
  };

  // WhatsApp helper
  const openWhatsApp = (phone, message) => {
    const cleanPhone = phone.replace(/\D/g, '');
    const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
    triggerAndroidCapture('WHATSAPP_OPENED', { phone, message });
  };

  const value = {
    // Auth
    user,
    isAuthenticated,
    isAdmin,
    login,
    register,
    logout,

    // UI
    darkMode,
    setDarkMode,
    language,
    setLanguage,
    loading,
    notification,
    showNotification,
    t,

    // Settings
    notificationsEnabled,
    setNotificationsEnabled,
    whatsappEnabled,
    setWhatsappEnabled,
    requestNotificationPermission,
    sendNotification,

    // Data
    debts,
    users,
    addDebt: handleAddDebt,
    updateDebt: handleUpdateDebt,
    deleteDebt: handleDeleteDebt,
    fetchUsers: handleFetchUsers,
    toggleUserStatus: handleToggleUserStatus,
    deleteUser: handleDeleteUser,
    statistics,
    refreshDebts,

    // WhatsApp
    openWhatsApp,

    // Android capture
    triggerAndroidCapture,

    // Reports
    downloadReport,

    // Neon service status
    isNeonConfigured: isNeonConfigured()
  };

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within AppProvider');
  }
  return context;
}

export default AppContext;
