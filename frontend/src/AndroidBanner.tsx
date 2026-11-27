import { useState } from 'react';
import { useI18n } from './i18n';

export const APK_URL = 'https://github.com/salimman2027/nq-cleaning/releases/download/app-latest/faz3tak.apk';

/** Shown only to visitors on an Android phone, and never inside the installed app itself. */
export function AndroidBanner() {
  const { t } = useI18n();
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem('nq.apkHidden') === '1'; } catch { return false; } });
  const isAndroid = /Android/i.test(navigator.userAgent);
  const inApp = typeof (window as unknown as { Capacitor?: unknown }).Capacitor !== 'undefined' || window.matchMedia('(display-mode: standalone)').matches;
  if (!isAndroid || inApp || hidden) return null;
  return (
    <div className="flex items-center gap-3 bg-[var(--color-accent)] px-4 py-2.5 text-sm text-cyan-950">
      <span className="flex-1 font-medium">{t('apkPrompt')}</span>
      <a href={APK_URL} className="rounded-full bg-cyan-950 px-4 py-1.5 font-semibold text-white" download>{t('apkDownload')}</a>
      <button aria-label={t('closeLbl')} onClick={() => { setHidden(true); try { localStorage.setItem('nq.apkHidden', '1'); } catch { /* ignore */ } }} className="px-1 text-lg leading-none">×</button>
    </div>
  );
}
