import { Download, MonitorDown } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';

const DESKTOP_DOWNLOAD_URL = 'https://github.com/m301her-prog/My-dept-2/releases/latest';

export default function DesktopDownloadButton() {
  const { t } = useApp();

  return (
    <a
      href={DESKTOP_DOWNLOAD_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t('downloadDesktop')}
      title={t('downloadDesktopHint')}
      className="fixed bottom-5 end-5 z-50 inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-900/20 transition-all duration-200 hover:scale-105 hover:bg-emerald-700 focus:outline-none focus:ring-4 focus:ring-emerald-300 dark:bg-emerald-500 dark:hover:bg-emerald-400 dark:focus:ring-emerald-800"
    >
      <MonitorDown className="h-5 w-5" aria-hidden="true" />
      <span>{t('downloadDesktop')}</span>
      <Download className="h-4 w-4" aria-hidden="true" />
    </a>
  );
}

export { DESKTOP_DOWNLOAD_URL };
