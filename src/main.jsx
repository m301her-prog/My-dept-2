import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AppProvider } from './context/AppContext.jsx';
import './index.css';
import { LocalNotifications } from '@capacitor/local-notifications';

// مكون لطلب إذن الإشعارات المحلية فوراً عند تشغيل التطبيق
const NotificationInitializer = () => {
  useEffect(() => {
    const requestAndroidPermissions = async () => {
      try {
        // فحص حالة الإذن الحالية
        let permStatus = await LocalNotifications.checkPermissions();
        
        // إذا لم يتم طلب الإذن من قبل أو يحتاج إلى إذن، اطلبه فوراً
        if (permStatus.display === 'prompt' || permStatus.display === 'denied') {
          permStatus = await LocalNotifications.requestPermissions();
        }

        console.log('Android Notification Permission Status:', permStatus.display);
      } catch (error) {
        console.error('Error requesting Android notification permissions:', error);
      }
    };

    requestAndroidPermissions();
  }, []);
  
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
