import { Download, MonitorDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';

export default function DesktopDownloadButton() {
  const { t } = useApp();
  const [installPrompt, setInstallPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    setIsInstalled(Boolean(standalone));

    const handleInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };

    const handleInstalled = () => {
      setInstallPrompt(null);
      setIsInstalled(true);
    };

    window.addEventListener('beforeinstallprompt', handleInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (!installPrompt) {
      window.alert(t('desktopInstallBrowserHint'));
      return;
    }

    installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      setInstallPrompt(null);
    }
  };

  if (isInstalled) return null;

  return (
    <button
      type="button"
      onClick={handleInstall}
      disabled={!installPrompt}
      aria-label={t('downloadDesktop')}
      title={installPrompt ? t('downloadDesktopHint') : t('desktopInstallBrowserHint')}
      className="fixed bottom-5 end-5 z-50 inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-900/20 transition-all duration-200 hover:scale-105 hover:bg-emerald-700 focus:outline-none focus:ring-4 focus:ring-emerald-300 dark:bg-emerald-500 dark:hover:bg-emerald-400 dark:focus:ring-emerald-800"
    >
      <MonitorDown className="h-5 w-5" aria-hidden="true" />
      <span>{t('downloadDesktop')}</span>
      <Download className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}
