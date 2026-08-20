/**
 * Neon PostgreSQL Service for Debts Manager (Local/Mock Mode)
 * Handles all database operations with dynamic per-user tables
 * Includes Android Capture event triggers for WebView integration
 */

// Cloud API URLs deactivated for temporary build
const CLOUD_API = {
  registerUser: '',
  loginUser: '',
  saveData: '',
  getData: '',
  deleteData: ''
};

const getConnectionString = () => {
  return '';
};

export const isNeonConfigured = () => {
  return false;
};

const executeQuery = async (query, params = []) => {
  console.warn('Neon query bypassed in mock mode');
  return null;
};

const cloudApiRequest = async (url, method, data) => {
  console.warn('Cloud API request bypassed in mock mode:', url);
  return null;
};

export const triggerAndroidCapture = (eventType, data) => {
  const eventData = {
    type: eventType,
    data: data,
    timestamp: new Date().toISOString(),
    synced: false
  };

  saveCaptureEvent(eventData);

  if (window.AndroidInterface && typeof window.AndroidInterface.captureEvent === 'function') {
    try {
      window.AndroidInterface.captureEvent(JSON.stringify(eventData));
    } catch (error) {
      console.error('Android Interface error:', error);
    }
  }

  window.dispatchEvent(new CustomEvent('appCapture', {
    detail: eventData
  }));
};

const saveCaptureEvent = (eventData) => {
  try {
    const captureLog = JSON.parse(localStorage.getItem('captureLog') || '[]');
    captureLog.push(eventData);
    const trimmed = captureLog.slice(-100);
    localStorage.setItem('captureLog', JSON.stringify(trimmed));
  } catch (error) {
    console.error('Failed to save capture event:', error);
  }
};

export const saveToLocalStorage = (key, data) => {
  try {
    localStorage.setItem(key, JSON.stringify(data));
    triggerAndroidCapture('DATA_SAVED', { key, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('LocalStorage save error:', error);
  }
};

export const loadFromLocalStorage = (key, defaultValue = null) => {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : defaultValue;
  } catch (error) {
    console.error('LocalStorage load error:', error);
    return defaultValue;
  }
};

const generateUserId = () => {
  return 'usr_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
};

const generateDebtId = () => {
  return 'debt_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 5);
};

const hashPassword = (password) => {
  let hash = 0;
  for (let i = 0; i < password.length; i++) {
    const char = password.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(16);
};

/**
 * ============================================
 * USER AUTHENTICATION FUNCTIONS
 * ============================================
 */

export const registerUserAndCreateTables = async (name, email, password, phone) => {
  const users = loadFromLocalStorage('registeredUsers', []);

  if (users.find(u => u.email === email)) {
    throw new Error('البريد الإلكتروني مسجل مسبقاً / Email déjà utilisé / Email already registered');
  }

  const userId = generateUserId();
  const hashedPassword = hashPassword(password);
  const isAdmin = email === 'admin@debts.dz';

  const newUser = {
    id: userId,
    name,
    email,
    password: hashedPassword,
    phone: phone || '',
    active: true,
    isAdmin,
    createdAt: new Date().toISOString()
  };

  users.push(newUser);
  saveToLocalStorage('registeredUsers', users);

  const userDebtsKey = `user_${userId}_debts`;
  const userActivitiesKey = `user_${userId}_activities`;

  saveToLocalStorage(userDebtsKey, []);
  saveToLocalStorage(userActivitiesKey, []);

  logUserActivity(userId, 'USER_REGISTERED', { name, email, phone });

  triggerAndroidCapture('USER_REGISTERED', {
    userId,
    name,
    email,
    timestamp: newUser.createdAt
  });

  const { password: _, ...userWithoutPassword } = newUser;
  return userWithoutPassword;
};

export const authUser = async (email, password) => {
  const hashedPassword = hashPassword(password);
  const users = loadFromLocalStorage('registeredUsers', []);

  const user = users.find(u =>
    u.email === email && u.password === hashedPassword && u.active
  );

  if (!user) {
    throw new Error('بيانات الدخول غير صحيحة / Identifiants incorrects / Invalid credentials');
  }

  const updatedUsers = users.map(u =>
    u.id === user.id
      ? { ...u, lastLogin: new Date().toISOString() }
      : u
  );
  saveToLocalStorage('registeredUsers', updatedUsers);

  logUserActivity(user.id, 'USER_LOGIN', { email });

  triggerAndroidCapture('USER_LOGIN', {
    userId: user.id,
    email: user.email,
    timestamp: new Date().toISOString(),
    source: 'local_storage'
  });

  const { password: _, ...userWithoutPassword } = user;
  return userWithoutPassword;
};

export const logoutUser = async (userId) => {
  logUserActivity(userId, 'USER_LOGOUT', {});
  triggerAndroidCapture('USER_LOGOUT', { userId });
};

export const getUserById = (userId) => {
  const users = loadFromLocalStorage('registeredUsers', []);
  const user = users.find(u => u.id === userId);
  if (user) {
    const { password: _, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }
  return null;
};

/**
 * ============================================
 * DEBT MANAGEMENT FUNCTIONS
 * ============================================
 */

export const fetchDebts = (userId) => {
  const userDebtsKey = `user_${userId}_debts`;
  const debts = loadFromLocalStorage(userDebtsKey, []);

  return debts.sort((a, b) =>
    new Date(b.createdAt) - new Date(a.createdAt)
  );
};

export const addDebt = async (userId, debtData) => {
  const userDebtsKey = `user_${userId}_debts`;
  const debts = loadFromLocalStorage(userDebtsKey, []);

  const newDebt = {
    id: generateDebtId(),
    type: debtData.type,
    personName: debtData.personName,
    phone: debtData.phone || '',
    amount: parseFloat(debtData.amount),
    currency: debtData.currency || 'DZD',
    dueDate: debtData.dueDate,
    notes: debtData.notes || '',
    status: 'pending',
    paidAmount: 0,
    isScheduled: debtData.isScheduled || false,
    scheduleType: debtData.scheduleType || null,
    installmentsCount: debtData.installmentsCount || 0,
    installmentsPaid: 0,
    firstPaymentDate: debtData.firstPaymentDate || null,
    scheduleData: debtData.scheduleData || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  debts.push(newDebt);
  saveToLocalStorage(userDebtsKey, debts);

  logUserActivity(userId, 'DEBT_ADDED', {
    debtId: newDebt.id,
    personName: newDebt.personName,
    amount: newDebt.amount,
    isScheduled: newDebt.isScheduled
  });

  triggerAndroidCapture('DEBT_ADDED', {
    userId,
    debt: newDebt
  });

  return newDebt;
};

export const updateDebtStatus = async (userId, debtId, updates) => {
  const userDebtsKey = `user_${userId}_debts`;
  const debts = loadFromLocalStorage(userDebtsKey, []);

  const debtIndex = debts.findIndex(d => d.id === debtId);
  if (debtIndex === -1) {
    throw new Error('الدين غير موجود / Dette introuvable / Debt not found');
  }

  const updatedDebt = {
    ...debts[debtIndex],
    ...updates,
    updatedAt: new Date().toISOString()
  };

  debts[debtIndex] = updatedDebt;
  saveToLocalStorage(userDebtsKey, debts);

  logUserActivity(userId, 'DEBT_UPDATED', {
    debtId,
    updates: Object.keys(updates).join(', ')
  });

  triggerAndroidCapture('DEBT_UPDATED', {
    userId,
    debtId,
    updates: updatedDebt
  });

  return updatedDebt;
};

export const deleteDataFromCloud = async (id, companyName = '', userId = '') => {
  return { success: true, id };
};

export const deleteDebt = async (debtId, companyName = '', userId = 'guest') => {
  const targetUserId = userId || 'guest';
  const userDebtsKey = `user_${targetUserId}_debts`;
  const debts = loadFromLocalStorage(userDebtsKey, []);

  const filteredDebts = debts.filter(d => d.id !== debtId && d._id !== debtId);
  saveToLocalStorage(userDebtsKey, filteredDebts);

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.endsWith('_debts')) {
        const itemData = loadFromLocalStorage(key, []);
        if (Array.isArray(itemData) && itemData.some(d => d.id === debtId || d._id === debtId)) {
          const cleaned = itemData.filter(d => d.id !== debtId && d._id !== debtId);
          saveToLocalStorage(key, cleaned);
        }
      }
    }
  } catch (err) {
    console.warn('LocalStorage global cleanup warning:', err.message);
  }

  logUserActivity(targetUserId, 'DEBT_DELETED', { debtId, companyName });

  triggerAndroidCapture('DEBT_DELETED', {
    userId: targetUserId,
    debtId,
    companyName
  });

  return { success: true, debtId };
};

/**
 * ============================================
 * CALCULATIONS & STATISTICS FUNCTIONS
 * ============================================
 */

export const calculateStatistics = (debts = []) => {
  let totalOwed = 0;  // أموال لك عند الآخرين (دين لنا / له)
  let totalOwing = 0; // أموال عليك للآخرين (دين علينا)
  let paidCount = 0;
  let pendingCount = 0;

  debts.forEach(debt => {
    const amount = parseFloat(debt.amount) || 0;
    const paid = parseFloat(debt.paidAmount) || 0;
    const remaining = amount - paid;

    if (debt.type === 'lent' || debt.type === 'given' || debt.type === 'le_client') {
      totalOwed += remaining;
    } else {
      totalOwing += remaining;
    }

    if (debt.status === 'paid') {
      paidCount++;
    } else {
      pendingCount++;
    }
  });

  return {
    totalDebts: debts.length,
    totalOwed,
    totalOwing,
    paidCount,
    pendingCount
  };
};

/**
 * ============================================
 * REPORTS AND EXPORT FUNCTIONS
 * ============================================
 */

export const generateDebtReport = (userId, language = 'ar') => {
  const debts = fetchDebts(userId);
  const user = getUserById(userId);

  return `Debts Report for ${user?.name || 'User'} - Total Debts: ${debts.length}`;
};

export const exportDebtsAsCSV = (userId) => {
  const debts = fetchDebts(userId);
  const headers = ['Person Name', 'Type', 'Amount', 'Currency', 'Due Date', 'Status'];
  const rows = debts.map(d => [d.personName, d.type, d.amount, d.currency, d.dueDate, d.status]);
  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
};

export const downloadReport = (userId, language = 'ar', format = 'txt') => {
  const content = format === 'csv' ? exportDebtsAsCSV(userId) : generateDebtReport(userId, language);
  const filename = `debts_report_${new Date().toISOString().split('T')[0]}.${format}`;
  const blob = new Blob([content], { type: format === 'csv' ? 'text/csv' : 'text/plain' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  triggerAndroidCapture('REPORT_DOWNLOADED', { userId, format, filename });
  return { filename, size: blob.size };
};

/**
 * ============================================
 * ACTIVITY LOGGING & STATISTICS
 * ============================================
 */

export const logUserActivity = (userId, action, details) => {
  const userActivitiesKey = `user_${userId}_activities`;
  const activities = loadFromLocalStorage(userActivitiesKey, []);

  const newActivity = {
    id: 'act_' + Date.now().toString(36),
    action,
    details,
    createdAt: new Date().toISOString()
  };

  activities.unshift(newActivity);
  saveToLocalStorage(userActivitiesKey, activities.slice(0, 100));

  return newActivity;
};

export const getUserActivities = (userId, limit = 20) => {
  const userActivitiesKey = `user_${userId}_activities`;
  const activities = loadFromLocalStorage(userActivitiesKey, []);
  return activities.slice(0, limit);
};

export const getAdminStats = () => {
  const users = loadFromLocalStorage('registeredUsers', []);
  return {
    totalUsers: users.length,
    activeUsers: users.filter(u => u.active).length,
    totalDebts: 0,
    totalOwed: 0,
    totalOwing: 0
  };
};

export const getAllUsers = () => {
  const users = loadFromLocalStorage('registeredUsers', []);
  return users.map(u => {
    const { password: _, ...userWithoutPassword } = u;
    return userWithoutPassword;
  });
};

export const toggleUserStatus = (userId, active) => {
  const users = loadFromLocalStorage('registeredUsers', []);
  const updatedUsers = users.map(u =>
    u.id === userId ? { ...u, active } : u
  );
  saveToLocalStorage('registeredUsers', updatedUsers);
  triggerAndroidCapture('USER_STATUS_CHANGED', { userId, active });
};

export const deleteUser = (userId) => {
  const users = loadFromLocalStorage('registeredUsers', []);
  const filtered = users.filter(u => u.id !== userId);
  saveToLocalStorage('registeredUsers', filtered);

  localStorage.removeItem(`user_${userId}_debts`);
  localStorage.removeItem(`user_${userId}_activities`);

  triggerAndroidCapture('USER_DELETED', { userId });
};

export default {
  registerUserAndCreateTables,
  authUser,
  logoutUser,
  getUserById,
  fetchDebts,
  addDebt,
  updateDebtStatus,
  deleteDebt,
  calculateStatistics,
  downloadReport,
  logUserActivity,
  getUserActivities,
  getAdminStats,
  getAllUsers,
  toggleUserStatus,
  deleteUser,
  saveToLocalStorage,
  loadFromLocalStorage,
  triggerAndroidCapture
};
