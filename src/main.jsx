import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AppProvider, useApp } from './context/AppContext.jsx';
import './index.css';
import { LocalNotifications } from '@capacitor/local-notifications';

// مكون لإدارة أذونات وجدولة الإشعارات المحلية مرة واحدة يومياً
const NotificationInitializer = () => {
  const { debts } = useApp();

  useEffect(() => {
    const initDailyNotifications = async () => {
      try {
        // 1. فحص وطلب أذونات الإشعارات على أندرويد
        let permStatus = await LocalNotifications.checkPermissions();
        if (permStatus.display === 'prompt' || permStatus.display === 'denied') {
          permStatus = await LocalNotifications.requestPermissions();
        }

        if (permStatus.display !== 'granted') return;

        // 2. إنشاء قناة إشعارات مخصصة لأندرويد لتفادي التكرار المزعج
        await LocalNotifications.createChannel({
          id: 'daily_debts_channel',
          name: 'تنبيهات الديون اليومية',
          description: 'إشعار يومي واحد للتذكير بالديون المستحقة',
          importance: 4, // High importance
          sound: 'default',
          vibration: true,
        });

        // 3. التحقق مما إذا كان قد تم إطلاق أو جدولة إشعار اليوم لتجنب الإزعاج
        const todayStr = new Date().toISOString().split('T')[0];
        const lastNotificationDate = localStorage.getItem('last_debt_notification_date');

        if (lastNotificationDate === todayStr) {
          console.log('تم إرسال إشعار الديون لليوم بالفعل.');
          return;
        }

        // 4. إلغاء أي إشعارات سابقة مجدولة لمنع المضاعفة
        const pending = await LocalNotifications.getPending();
        if (pending.notifications.length > 0) {
          await LocalNotifications.cancel(pending);
        }

        // 5. فلترة الديون المستحقة أو المتأخرة غير المدفوعة
        const dueDebts = (debts || []).filter(
          d => d.status !== 'paid' && d.dueDate && d.dueDate <= todayStr
        );

        if (dueDebts.length === 0) return;

        // 6. تحديد موعد الإشعار القادم (الساعة 9:00 صباحاً)
        const scheduledTime = new Date();
        scheduledTime.setHours(9, 0, 0, 0);

        // إذا كانت الساعة قد تجاوزت 9:00 صباحاً اليوم، اجعل الإشعار لغدٍ الساعة 9:00 صباحاً
        if (scheduledTime <= new Date()) {
          scheduledTime.setDate(scheduledTime.getDate() + 1);
        }

        // 7. جدولة الإشعار اليومي المجمع
        const bodyText = dueDebts.length === 1
          ? `لديك دين مستحق لـ ${dueDebts[0].personName || 'أحد الأشخاص'}`
          : `لديك ${dueDebts.length} ديون مستحقة السداد اليوم!`;

        await LocalNotifications.schedule({
          notifications: [
            {
              id: 1001, // ID ثابت لتحديث نفس الإشعار دائماً
              title: 'تذكير الديون اليومي 📅',
              body: bodyText,
              channelId: 'daily_debts_channel',
              schedule: {
                at: scheduledTime,
                every: 'day', // تكرار يومي فقط
              },
              sound: 'default',
            },
          ],
        });

        // 8. حفظ تاريخ اليوم لتسجيل إطلاق الإشعار
        localStorage.setItem('last_debt_notification_date', todayStr);
        console.log('تم جدولة الإشعار اليومي بنجاح للساعة 9:00 صباحاً.');

      } catch (error) {
        console.error('Error initializing daily notifications:', error);
      }
    };

    initDailyNotifications();
  }, [debts]);

  return null;
};

// Initialize app
const root = createRoot(document.getElementById('root'));

root.render(
  <StrictMode>
    <BrowserRouter>
      <AppProvider>
        <NotificationInitializer />
        <App />
      </AppProvider>
    </BrowserRouter>
  </StrictMode>
);
