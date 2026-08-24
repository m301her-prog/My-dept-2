import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AppProvider, useApp } from './context/AppContext.jsx';
import './index.css';
import { LocalNotifications } from '@capacitor/local-notifications';

// مكون لإدارة أذونات وجدولة الإشعارات المحلية
const NotificationInitializer = () => {
  const { debts } = useApp();

  useEffect(() => {
    const initNotifications = async () => {
      try {
        // 1. فحص وطلب أذونات الإشعارات على أندرويد
        let permStatus = await LocalNotifications.checkPermissions();
        if (permStatus.display === 'prompt' || permStatus.display === 'denied') {
          permStatus = await LocalNotifications.requestPermissions();
        }

        if (permStatus.display !== 'granted') return;

        // 2. إنشاء قناة إشعارات التذكيرات اليومية
        await LocalNotifications.createChannel({
          id: 'daily_debts_channel',
          name: 'تنبيهات الديون اليومية',
          description: 'إشعار يومي واحد للتذكير بالديون المستحقة',
          importance: 4, // High importance
          sound: 'default',
          vibration: true,
        });

        // 3. إنشاء قناة إشعارات عمليات الحذف والإجراءات السريعة
        await LocalNotifications.createChannel({
          id: 'action_debts_channel',
          name: 'تنبيهات الإجراءات والحذف',
          description: 'إشعارات فورية عند حذف أو تعديل دين',
          importance: 4,
          sound: 'default',
          vibration: true,
        });

        // 4. التحقق من تنفيذ الإشعار اليومي
        const todayStr = new Date().toISOString().split('T')[0];
        const lastNotificationDate = localStorage.getItem('last_debt_notification_date');

        if (lastNotificationDate === todayStr) {
          console.log('تم إرسال إشعار الديون لليوم بالفعل.');
          return;
        }

        // 5. إلغاء أي إشعارات سابقة مجدولة لمنع المضاعفة
        const pending = await LocalNotifications.getPending();
        if (pending.notifications.length > 0) {
          await LocalNotifications.cancel(pending);
        }

        // 6. فلترة الديون المستحقة أو المتأخرة غير المدفوعة (دعم الحقول السحابية والمحلية)
        const dueDebts = (debts || []).filter(d => {
          const isPending = d.status !== 'paid';
          const dueDateVal = d.dueDate || d.due_date;
          return isPending && dueDateVal && dueDateVal <= todayStr;
        });

        if (dueDebts.length === 0) return;

        // 7. تحديد موعد الإشعار القادم (الساعة 9:00 صباحاً)
        const scheduledTime = new Date();
        scheduledTime.setHours(9, 0, 0, 0);

        if (scheduledTime <= new Date()) {
          scheduledTime.setDate(scheduledTime.getDate() + 1);
        }

        // 8. جدولة الإشعار اليومي المجمع
        const firstPersonName = dueDebts[0]?.personName || dueDebts[0]?.person_name || 'أحد الأشخاص';
        const bodyText = dueDebts.length === 1
          ? `لديك دين مستحق لـ ${firstPersonName}`
          : `لديك ${dueDebts.length} ديون مستحقة السداد اليوم!`;

        await LocalNotifications.schedule({
          notifications: [
            {
              id: 1001,
              title: 'تذكير الديون اليومي 📅',
              body: bodyText,
              channelId: 'daily_debts_channel',
              schedule: {
                at: scheduledTime,
                every: 'day',
              },
              sound: 'default',
            },
          ],
        });

        localStorage.setItem('last_debt_notification_date', todayStr);
        console.log('تم جدولة الإشعار اليومي بنجاح للساعة 9:00 صباحاً.');

      } catch (error) {
        console.error('Error initializing notifications:', error);
      }
    };

    initNotifications();
  }, [debts]);

  return null;
};

// دالة مساعدة عامة لإطلاق إشعار حذف فوري من أي مكان في التطبيق
export const showDeleteNotification = async (personName) => {
  try {
    const permStatus = await LocalNotifications.checkPermissions();
    if (permStatus.display === 'granted') {
      await LocalNotifications.schedule({
        notifications: [
          {
            id: Date.now() % 100000,
            title: 'تم الحذف بنجاح',
            body: `تم حذف بيانات ${personName || 'الدين'} من السحابة والذاكرة المحلية.`,
            channelId: 'action_debts_channel',
            sound: 'default',
          }
        ]
      });
    }
  } catch (e) {
    console.error('Failed to trigger local delete notification:', e);
  }
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
