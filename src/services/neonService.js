/**
 * Neon PostgreSQL Service for Debts Manager
 * Handles all database operations with dynamic per-user tables
 * Includes Android Capture event triggers for WebView integration
 * Optimized with CapacitorHttp for native cross-platform compatibility
 * Updated: Support for debt scheduling and installments
 * Updated: Integration with Cloud APIs for data sync & Delete endpoint
 */

import { CapacitorHttp } from '@capacitor/core';

// Cloud API URLs for Neon database sync updated with https://my-dept-2.vercel.app/
const CLOUD_API = {
  registerUser: 'https://my-dept-2.vercel.app/api/register-user',
  loginUser: 'https://my-dept-2.vercel.app/api/login-user',
  saveData: 'https://my-dept-2.vercel.app/save',
  getData: 'https://my-dept-2.vercel.app/get',
  deleteData: 'https://my-dept-2.vercel.app/api/Delete'
};

// Neon database connection string - set in .env as VITE_NEON_DATABASE_URL
const getConnectionString = () => {
  return import.meta.env.VITE_NEON_DATABASE_URL || '';
};

// Check if Neon is configured
export const isNeonConfigured = () => {
  const url = getConnectionString();
  return url && url.includes('neon.tech');
};

/**
 * Execute SQL query via CapacitorHttp with retry logic and fallback to localStorage
 */
const executeQuery = async (query, params = []) => {
  const connString = getConnectionString();

  if (!connString || !connString.includes('neon.tech')) {
    console.warn('Neon not configured, using localStorage fallback');
    return null;
  }

  try {
    let httpUrl = connString;
    if (httpUrl.startsWith('postgres://')) {
      httpUrl = httpUrl.replace('postgres://', 'https://');
    } else if (httpUrl.startsWith('postgresql://')) {
      httpUrl = httpUrl.replace('postgresql://', 'https://');
    }

    if (!httpUrl.includes('/v1/sql') && !httpUrl.includes('/sql')) {
      const urlObj = new URL(httpUrl);
      httpUrl = `https://${urlObj.host}/v1/sql`;
    }

    const options = {
      url: httpUrl,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${connString.split('@')[0].split(':').pop()}`
      },
      data: {
        query: query,
        params: params
      }
    };

    const response = await CapacitorHttp.post(options);

    if (response.status >= 200 && response.status < 300) {
      return response.data;
    } else {
      throw new Error(`Neon HTTP error! status: ${response.status}`);
    }
  } catch (error) {
    console.error('Neon query error via CapacitorHttp:', error);
    throw error;
  }
};

/**
 * Make HTTP request to Cloud API with fallback handling
 */
const cloudApiRequest = async (url, method, data) => {
  try {
    const options = {
      url: url,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      data: data
    };

    const response = await CapacitorHttp.request(options);

    if (response.status >= 200 && response.status < 300) {
      return response.data;
    } else {
      console.warn(`Cloud API error ${response.status}: ${url}`);
      return null;
    }
  } catch (error) {
    console.warn('Cloud API request failed:', error.message, url);
    return null;
  }
};

/**
 * Android Capture Event Trigger
 * Sends events to Android WebView when available
 * Also saves to localStorage for offline sync
 */
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
      console.log('Android Capture event sent:', eventType);
    } catch (error) {
      console.error('Android Interface error:', error);
    }
  }

  if (window.AndroidCapture && typeof window.AndroidCapture.onEvent === 'function') {
    try {
      window.AndroidCapture.onEvent(eventType, JSON.stringify(data));
    } catch (error) {
      console.error('AndroidCapture error:', error);
    }
  }

  window.dispatchEvent(new CustomEvent('appCapture', {
    detail: eventData
  }));
};

/**
 * Save capture event to localStorage
 */
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

/**
 * Save data to localStorage
 */
export const saveToLocalStorage = (key, data) => {
  try {
    localStorage.setItem(key, JSON.stringify(data));
    triggerAndroidCapture('DATA_SAVED', { key, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('LocalStorage save error:', error);
  }
};

/**
 * Load data from localStorage
 */
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

  try {
    const cloudResponse = await cloudApiRequest(CLOUD_API.registerUser, 'POST', {
      userId: userId,
      name: name,
      email: email,
      password: hashedPassword,
      phone: phone || '',
      isAdmin: isAdmin,
      createdAt: newUser.createdAt
    });

    if (cloudResponse && cloudResponse.success) {
      console.log('User registered successfully to Cloud API:', userId);

      if (cloudResponse.user) {
        const updatedUser = { ...newUser, ...cloudResponse.user };
        const updatedUsers = loadFromLocalStorage('registeredUsers', []);
        const userIndex = updatedUsers.findIndex(u => u.id === userId);
        if (userIndex !== -1) {
          updatedUsers[userIndex] = updatedUser;
          saveToLocalStorage('registeredUsers', updatedUsers);
        }
      }
    } else {
      console.warn('Cloud API registration response:', cloudResponse);
    }
  } catch (error) {
    console.warn('Cloud API registration failed, continuing with local:', error.message);
  }

  if (isNeonConfigured()) {
    try {
      await executeQuery(`
        CREATE TABLE IF NOT EXISTS user_${userId.replace(/-/g, '_')}_debts (
          id VARCHAR(50) PRIMARY KEY,
          type VARCHAR(20) NOT NULL,
          person_name TEXT NOT NULL,
          phone TEXT,
          amount DECIMAL(12,2) NOT NULL,
          currency VARCHAR(10) DEFAULT 'DZD',
          due_date DATE NOT NULL,
          notes TEXT,
          status VARCHAR(20) DEFAULT 'pending',
          paid_amount DECIMAL(12,2) DEFAULT 0,
          is_scheduled BOOLEAN DEFAULT FALSE,
          schedule_type VARCHAR(20),
          installments_count INTEGER DEFAULT 0,
          installments_paid INTEGER DEFAULT 0,
          first_payment_date DATE,
          schedule_data JSONB,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await executeQuery(`
        CREATE TABLE IF NOT EXISTS user_${userId.replace(/-/g, '_')}_activities (
          id VARCHAR(50) PRIMARY KEY,
          action VARCHAR(50) NOT NULL,
          details TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      console.log('Neon tables created for user:', userId);
    } catch (error) {
      console.error('Failed to create Neon tables:', error);
    }
  }

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

  try {
    const cloudResponse = await cloudApiRequest(CLOUD_API.loginUser, 'POST', {
      email: email,
      password: hashedPassword
    });

    if (cloudResponse && cloudResponse.success && cloudResponse.user) {
      console.log('User authenticated via Cloud API:', cloudResponse.user.id);

      const cloudUser = cloudResponse.user;
      const localUsers = loadFromLocalStorage('registeredUsers', []);
      const existingUserIndex = localUsers.findIndex(u => u.email === email);

      if (existingUserIndex === -1) {
        const newLocalUser = {
          id: cloudUser.id,
          name: cloudUser.name,
          email: cloudUser.email,
          password: hashedPassword,
          phone: cloudUser.phone || '',
          active: true,
          isAdmin: cloudUser.isAdmin || false,
          createdAt: cloudUser.createdAt,
          lastLogin: new Date().toISOString()
        };
        localUsers.push(newLocalUser);
        saveToLocalStorage('registeredUsers', localUsers);
      } else {
        localUsers[existingUserIndex] = {
          ...localUsers[existingUserIndex],
          ...cloudUser,
          password: hashedPassword,
          lastLogin: new Date().toISOString()
        };
        saveToLocalStorage('registeredUsers', localUsers);
      }

      if (cloudResponse.debts && Array.isArray(cloudResponse.debts)) {
        const userDebtsKey = `user_${cloudUser.id}_debts`;
        const localDebts = loadFromLocalStorage(userDebtsKey, []);

        const mergedDebts = [...localDebts];
        cloudResponse.debts.forEach(cloudDebt => {
          const existingIndex = mergedDebts.findIndex(d => d.id === cloudDebt.id);
          if (existingIndex === -1) {
            mergedDebts.push(cloudDebt);
          } else {
            const localUpdated = new Date(mergedDebts[existingIndex].updatedAt || 0);
            const cloudUpdated = new Date(cloudDebt.updatedAt || 0);
            if (cloudUpdated > localUpdated) {
              mergedDebts[existingIndex] = cloudDebt;
            }
          }
        });

        saveToLocalStorage(userDebtsKey, mergedDebts);
      }

      logUserActivity(cloudUser.id, 'USER_LOGIN', { email });

      triggerAndroidCapture('USER_LOGIN', {
        userId: cloudUser.id,
        email: cloudUser.email,
        timestamp: new Date().toISOString(),
        source: 'cloud_api'
      });

      const { password: _, ...userWithoutPassword } = cloudUser;
      return { ...userWithoutPassword, id: cloudUser.id };
    }
  } catch (error) {
    console.warn('Cloud API login failed, falling back to local:', error.message);
  }

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

  fetchDebtsFromCloud(userId);

  return debts.sort((a, b) =>
    new Date(b.createdAt) - new Date(a.createdAt)
  );
};

const fetchDebtsFromCloud = async (userId) => {
  try {
    const cloudResponse = await cloudApiRequest(CLOUD_API.getData, 'POST', {
      userId: userId
    });

    if (cloudResponse && cloudResponse.success && cloudResponse.debts) {
      console.log('Fetched debts from Cloud API:', cloudResponse.debts.length);

      const userDebtsKey = `user_${userId}_debts`;
      const localDebts = loadFromLocalStorage(userDebtsKey, []);

      const mergedDebts = [...localDebts];
      let hasUpdates = false;

      cloudResponse.debts.forEach(cloudDebt => {
        const existingIndex = mergedDebts.findIndex(d => d.id === cloudDebt.id);
        if (existingIndex === -1) {
          mergedDebts.push(cloudDebt);
          hasUpdates = true;
        } else {
          const localUpdated = new Date(mergedDebts[existingIndex].updatedAt || 0);
          const cloudUpdated = new Date(cloudDebt.updatedAt || 0);
          if (cloudUpdated > localUpdated) {
            mergedDebts[existingIndex] = cloudDebt;
            hasUpdates = true;
          }
        }
      });

      if (hasUpdates) {
        saveToLocalStorage(userDebtsKey, mergedDebts);
        triggerAndroidCapture('DEBTS_SYNCED_FROM_CLOUD', {
          userId,
          count: cloudResponse.debts.length
        });
      }
    }
  } catch (error) {
    console.warn('Failed to fetch debts from cloud:', error.message);
  }
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

  try {
    const cloudResponse = await cloudApiRequest(CLOUD_API.saveData, 'POST', {
      userId: userId,
      action: 'add_debt',
      debt: newDebt
    });

    if (cloudResponse && cloudResponse.success) {
      console.log('Debt saved to Cloud API:', newDebt.id);

      if (cloudResponse.debt) {
        const updatedDebts = loadFromLocalStorage(userDebtsKey, []);
        const debtIndex = updatedDebts.findIndex(d => d.id === newDebt.id);
        if (debtIndex !== -1) {
          updatedDebts[debtIndex] = { ...updatedDebts[debtIndex], ...cloudResponse.debt };
          saveToLocalStorage(userDebtsKey, updatedDebts);
        }
      }
    }
  } catch (error) {
    console.warn('Failed to sync debt to Cloud API:', error.message);
  }

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

  if (isNeonConfigured()) {
    try {
      const tableName = `user_${userId.replace(/-/g, '_')}_debts`;
      await executeQuery(`
        INSERT INTO ${tableName} (id, type, person_name, phone, amount, currency, due_date, notes, status, paid_amount, is_scheduled, schedule_type, installments_count, installments_paid, first_payment_date, schedule_data)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      `, [
        newDebt.id, newDebt.type, newDebt.personName, newDebt.phone,
        newDebt.amount, newDebt.currency, newDebt.dueDate,
        newDebt.notes, newDebt.status, newDebt.paidAmount,
        newDebt.isScheduled, newDebt.scheduleType, newDebt.installmentsCount,
        newDebt.installmentsPaid, newDebt.firstPaymentDate,
        JSON.stringify(newDebt.scheduleData)
      ]);
    } catch (error) {
      console.error('Failed to sync debt to Neon:', error);
    }
  }

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

  try {
    const cloudResponse = await cloudApiRequest(CLOUD_API.saveData, 'POST', {
      userId: userId,
      action: 'update_debt',
      debtId: debtId,
      updates: updatedDebt
    });

    if (cloudResponse && cloudResponse.success) {
      console.log('Debt update synced to Cloud API:', debtId);
    }
  } catch (error) {
    console.warn('Failed to sync debt update to Cloud API:', error.message);
  }

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

/**
 * Direct Cloud API Delete Handler
 * Invokes https://my-dept-2.vercel.app/api/Delete
 */
export const deleteDataFromCloud = async (id, companyName = '', userId = '') => {
  try {
    const payload = { id, companyName };
    if (userId) payload.userId = userId;

    const response = await cloudApiRequest(CLOUD_API.deleteData, 'POST', payload);

    if (response && (response.success || response.status === 'success' || response.ok)) {
      console.log('Successfully deleted record via Delete API:', id);
      return response;
    } else {
      console.warn('Delete API responded with failure:', response);
      return response || null;
    }
  } catch (error) {
    console.error('Error in deleteDataFromCloud:', error.message);
    return null;
  }
};

/**
 * Delete debt with Cloud API sync, Direct Delete endpoint, and Neon DB query
 */
export const deleteDebt = async (debtId, companyName = '', userId = 'guest') => {
  const targetUserId = userId || 'guest';
  const userDebtsKey = `user_${targetUserId}_debts`;
  const debts = loadFromLocalStorage(userDebtsKey, []);

  // 1. Clear locally from LocalStorage across current user and all keys
  const filteredDebts = debts.filter(d => d.id !== debtId && d._id !== debtId);
  saveToLocalStorage(userDebtsKey, filteredDebts);

  // Fallback cleanup across all localStorage keys for safety
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

  // 2. Direct Delete API request (https://my-dept-2.vercel.app/api/Delete)
  const cloudDeleteResult = await deleteDataFromCloud(debtId, companyName, targetUserId);

  // 3. Delete request through saveData fallback endpoint
  try {
    await cloudApiRequest(CLOUD_API.saveData, 'POST', {
      userId: targetUserId,
      action: 'delete_debt',
      debtId: debtId,
      id: debtId,
      companyName: companyName
    });
  } catch (error) {
    console.warn('Failed to sync debt deletion to Cloud API saveData:', error.message);
  }

  // 4. Delete query directly on Neon database if connection is configured
  if (isNeonConfigured() && targetUserId !== 'guest') {
    try {
      const tableName = `user_${targetUserId.replace(/-/g, '_')}_debts`;
      await executeQuery(`DELETE FROM ${tableName} WHERE id = $1 OR id = $2`, [debtId, debtId]);
    } catch (error) {
      console.error('Failed to delete debt from Neon DB:', error);
    }
  }

  // 5. Activity log and Android WebView capture
  logUserActivity(targetUserId, 'DEBT_DELETED', { debtId, companyName });

  triggerAndroidCapture('DEBT_DELETED', {
    userId: targetUserId,
    debtId,
    companyName
  });

  return cloudDeleteResult || { success: true, debtId };
};

/**
 * ============================================
 * REPORTS AND EXPORT FUNCTIONS
 * ============================================
 */

export const generateDebtReport = (userId, language = 'ar') => {
  const debts = fetchDebts(userId);
  const stats = calculateStatistics(userId);
  const user = getUserById(userId);

  const formatDate = (dateString) => {
    const locale = language === 'ar' ? 'ar-DZ' : language === 'fr' ? 'fr-FR' : 'en-US';
    return new Date(dateString).toLocaleDateString(locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const formatCurrency = (amount) => {
    const locale = language === 'ar' ? 'ar-DZ' : language === 'fr' ? 'fr-FR' : 'en-US';
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'DZD',
      minimumFractionDigits: 0
    }).format(amount);
  };

  const headers = {
    ar: {
      title: 'تقرير الديون',
      date: 'تاريخ التقرير',
      user: 'المستخدم',
      totalOwed: 'إجمالي المستحق لي',
      totalOwe: 'إجمالي المتوجب عليّ',
      paid: 'مدفوعة',
      pending: 'معلقة',
      overdue: 'متأخرة',
      person: 'الشخص',
      amount: 'المبلغ',
      dueDate: 'تاريخ الاستحقاق',
      status: 'الحالة',
      type: 'النوع',
      owedToMe: 'لي',
      iOwe: 'عليّ',
      scheduled: 'مجدول',
      notScheduled: 'غير مجدول',
      yes: 'نعم'
    },
    fr: {
      title: 'Rapport des dettes',
      date: 'Date du rapport',
      user: 'Utilisateur',
      totalOwed: 'Total a recevoir',
      totalOwe: 'Total a payer',
      paid: 'Payees',
      pending: 'En attente',
      overdue: 'En retard',
      person: 'Personne',
      amount: 'Montant',
      dueDate: "Date d'echeance",
      status: 'Statut',
      type: 'Type',
      owedToMe: 'A recevoir',
      iOwe: 'A payer',
      scheduled: 'Programme',
      notScheduled: 'Non programme',
      yes: 'Oui'
    },
    en: {
      title: 'Debts Report',
      date: 'Report Date',
      user: 'User',
      totalOwed: 'Total Owed to Me',
      totalOwe: 'Total I Owe',
      paid: 'Paid',
      pending: 'Pending',
      overdue: 'Overdue',
      person: 'Person',
      amount: 'Amount',
      dueDate: 'Due Date',
      status: 'Status',
      type: 'Type',
      owedToMe: 'Owed to Me',
      iOwe: 'I Owe',
      scheduled: 'Scheduled',
      notScheduled: 'Not Scheduled',
      yes: 'Yes'
    }
  };

  const h = headers[language] || headers.ar;

  let report = `═══════════════════════════════════════════════════════════════\n`;
  report += `                                     ${h.title}\n`;
  report += `═══════════════════════════════════════════════════════════════\n\n`;
  report += `${h.date}: ${formatDate(new Date().toISOString())}\n`;
  report += `${h.user}: ${user?.name || user?.email || 'Unknown'}\n\n`;
  report += `───────────────────────────────────────────────────────────────\n`;
  report += `                         ${language === 'ar' ? 'الملخص' : language === 'fr' ? 'Resume' : 'Summary'}\n`;
  report += `───────────────────────────────────────────────────────────────\n`;
  report += `${h.totalOwed}: ${formatCurrency(stats.totalOwedToMe)}\n`;
  report += `${h.totalOwe}: ${formatCurrency(stats.totalIOwe)}\n`;
  report += `${h.paid}: ${stats.paidDebtsCount}\n`;
  report += `${h.pending}: ${stats.pendingDebtsCount}\n`;
  report += `${h.overdue}: ${stats.overdueDebts.length}\n\n`;

  if (debts.length > 0) {
    report += `═══════════════════════════════════════════════════════════════\n`;
    report += `                     ${language === 'ar' ? 'تفاصيل الديون' : language === 'fr' ? 'Details des dettes' : 'Debt Details'}\n`;
    report += `═══════════════════════════════════════════════════════════════\n\n`;

    debts.forEach((debt, index) => {
      report += `───────────────────────────────────────────────────────────────\n`;
      report += `${index + 1}. ${debt.personName}\n`;
      report += `───────────────────────────────────────────────────────────────\n`;
      report += `   ${h.type}: ${debt.type === 'owed_to_me' ? h.owedToMe : h.iOwe}\n`;
      report += `   ${h.amount}: ${formatCurrency(debt.amount)} (${debt.currency})\n`;
      report += `   ${h.dueDate}: ${formatDate(debt.dueDate)}\n`;
      report += `   ${h.status}: ${debt.status === 'paid' ? h.paid : debt.status === 'pending' ? h.pending : h.overdue}\n`;
      if (debt.isScheduled) {
        report += `   ${h.scheduled}: ${h.yes} (${debt.installmentsCount} ${language === 'ar' ? 'دفعات' : language === 'fr' ? 'versements' : 'installments'})\n`;
      }
      if (debt.notes) {
        report += `   ${language === 'ar' ? 'ملاحظات' : language === 'fr' ? 'Notes' : 'Notes'}: ${debt.notes}\n`;
      }
      report += `\n`;
    });
  }

  report += `═══════════════════════════════════════════════════════════════\n`;
  report += `                Debts Manager - ${new Date().getFullYear()}\n`;
  report += `═══════════════════════════════════════════════════════════════\n`;

  return report;
};

export const exportDebtsAsCSV = (userId) => {
  const debts = fetchDebts(userId);

  const headers = ['Person Name', 'Type', 'Amount', 'Currency', 'Due Date', 'Status', 'Phone', 'Notes', 'Is Scheduled', 'Installments', 'Created At'];
  const rows = debts.map(d => [
    `"${d.personName}"`,
    d.type,
    d.amount,
    d.currency,
    d.dueDate,
    d.status,
    `"${d.phone || ''}"`,
    `"${(d.notes || '').replace(/"/g, '""')}"`,
    d.isScheduled ? 'Yes' : 'No',
    d.installmentsCount || 0,
    d.createdAt
  ]);

  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
};

export const downloadReport = (userId, language = 'ar', format = 'txt') => {
  let content, filename, mimeType;

  if (format === 'csv') {
    content = exportDebtsAsCSV(userId);
    filename = `debts_report_${new Date().toISOString().split('T')[0]}.csv`;
    mimeType = 'text/csv';
  } else {
    content = generateDebtReport(userId, language);
    filename = `debts_report_${new Date().toISOString().split('T')[0]}.txt`;
    mimeType = 'text/plain';
  }

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  triggerAndroidCapture('REPORT_DOWNLOADED', {
    userId,
    format,
    filename
  });

  return { filename, size: blob.size };
};

/**
 * ============================================
 * ACTIVITY LOGGING
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

  cloudApiRequest(CLOUD_API.saveData, 'POST', {
    userId: userId,
    action: 'log_activity',
    activity: newActivity
  }).catch(err => console.warn('Failed to sync activity:', err.message));

  return newActivity;
};

export const getUserActivities = (userId, limit = 20) => {
  const userActivitiesKey = `user_${userId}_activities`;
  const activities = loadFromLocalStorage(userActivitiesKey, []);
  return activities.slice(0, limit);
};

/**
 * ============================================
 * ADMIN FUNCTIONS
 * ============================================
 */

export const getAdminStats = () => {
  const users = loadFromLocalStorage('registeredUsers', []);

  let totalDebts = 0;
  let totalOwed = 0;
  let totalOwing = 0;

  users.forEach(user => {
    const userDebts = fetchDebts(user.id);
    totalDebts += userDebts.length;
    userDebts.forEach(debt => {
      if (debt.status !== 'paid') {
        if (debt.type === 'owed_to_me') {
          totalOwed += debt.amount;
        } else {
          totalOwing += debt.amount;
        }
      }
    });
  });

  return {
    totalUsers: users.length,
    activeUsers: users.filter(u => u.active).length,
    totalDebts,
    totalOwed,
    totalOwing
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

  cloudApiRequest(CLOUD_API.saveData, 'POST', {
    action: 'toggle_user_status',
    userId: userId,
    active: active
  }).catch(err => console.warn('Failed to sync user status:', err.message));

  triggerAndroidCapture('USER_STATUS_CHANGED', { userId, active });
};

export const deleteUser = (userId) => {
  const users = loadFromLocalStorage('registeredUsers', []);
  const filtered = users.filter(u => u.id !== userId);
  saveToLocalStorage('registeredUsers', filtered);

  localStorage.removeItem(`user_${userId}_debts`);
  localStorage.removeItem(`user_${userId}_activities`);

  cloudApiRequest(CLOUD_API.saveData, 'POST', {
    action: 'delete_user',
    userId: userId
  }).catch(err => console.warn('Failed to sync user deletion:', err.message));

  triggerAndroidCapture('USER_DELETED', { userId });
};
