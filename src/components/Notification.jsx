import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';

export default function Notification() {
  const { notification } = useApp();
  const [visible, setVisible] = useState(false);
  const [exit, setExit] = useState(false);

  useEffect(() => {
    if (notification) {
      setVisible(true);
      setExit(false);

      const timer = setTimeout(() => {
        setExit(true);
        setTimeout(() => setVisible(false), 300);
      }, 2700);

      return () => clearTimeout(timer);
    }
  }, [notification]);

  if (!visible || !notification) return null;

  const icons = {
    success: <CheckCircle className="w-5 h-5 text-emerald-500" />,
    error: <AlertCircle className="w-5 h-5 text-red-500" />,
    warning: <AlertTriangle className="w-5 h-5 text-yellow-500" />,
    info: <Info className="w-5 h-5 text-blue-500" />
  };

  const bgColors = {
    success: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800',
    error: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
    warning: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800',
    info: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
  };

  return (
    <div className={`fixed top-4 left-4 right-4 z-50 transition-all duration-300 ${
      exit ? 'opacity-0 -translate-y-2' : 'opacity-100 translate-y-0'
    }`}>
      <div className={`max-w-md mx-auto p-4 rounded-xl border shadow-lg flex items-center gap-3 ${bgColors[notification.type]}`}>
        {icons[notification.type] || icons.info}
        <p className="flex-1 text-sm font-medium text-gray-900 dark:text-white">
          {notification.message}
        </p>
        <button
          onClick={() => {
            setExit(true);
            setTimeout(() => setVisible(false), 300);
          }}
          className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition"
        >
          <X className="w-4 h-4 text-gray-500" />
        </button>
      </div>
    </div>
  );
}
