import { useState } from 'react';
import { api, ApiError, fileToBase64 } from './api';
import { useI18n } from './i18n';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

const base = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-cyan-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';

export function Input(p: InputHTMLAttributes<HTMLInputElement>) { return <input {...p} className={`${base} w-full ${p.className ?? ''}`} />; }
/** Password field with an eye button that shows or hides the text. */
export function PasswordInput(p: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input {...p} type={show ? 'text' : 'password'} className={`${base} w-full pe-11 ${p.className ?? ''}`} />
      <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}
        className="absolute inset-y-0 end-0 flex w-11 items-center justify-center text-slate-400 hover:text-cyan-700 focus-visible:text-cyan-700">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" />
          {show && <path d="M4 4l16 16" />}
        </svg>
      </button>
    </div>
  );
}
export function Select(p: SelectHTMLAttributes<HTMLSelectElement>) { return <select {...p} className={`${base} w-full ${p.className ?? ''}`} />; }

export function Button({ variant = 'primary', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  const v = variant === 'primary' ? 'bg-cyan-700 text-white hover:bg-cyan-800' : variant === 'danger' ? 'bg-red-600 text-white hover:bg-red-700' : 'border border-slate-300 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800';
  return <button {...p} className={`rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 ${v} ${p.className ?? ''}`} />;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block text-sm"><span className="mb-1 block text-slate-600 dark:text-slate-300">{label}</span>{children}</label>;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:max-w-2xl sm:rounded-2xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold">{title}</h2><button onClick={onClose} aria-label="close" className="text-2xl leading-none">×</button></div>
        {children}
      </div>
    </div>
  );
}

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return <div className="space-y-2">{Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton h-10" />)}</div>;
}

export function ErrorBox({ message }: { message: string }) {
  return <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">{message}</div>;
}

export const money = (n: number | string | null | undefined, lang = 'ar') =>
  new Intl.NumberFormat(lang === 'ar' ? 'ar-SA' : 'en-US', { style: 'currency', currency: 'SAR' }).format(Number(n ?? 0));
export const dateTime = (s: string, lang = 'ar') =>
  new Date(s).toLocaleString(lang === 'ar' ? 'ar-SA' : 'en-GB', { timeZone: 'Asia/Riyadh', dateStyle: 'medium', timeStyle: 'short' });

/** Image picker: uploads the chosen file to the platform and reports its URL. Shows a preview and a remove button. */
export function ImageUpload({ value, onChange, round = false }: { value: string; onChange: (url: string) => void; round?: boolean }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const pick = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { setErr(t('imgTooBig')); return; }
    setBusy(true); setErr('');
    try { onChange((await api<{ url: string }>('/media', { method: 'POST', body: { dataBase64: await fileToBase64(f) } })).url); }
    catch (e) { setErr(e instanceof ApiError && e.code === 'UNSUPPORTED_FILE' ? t('err_UNSUPPORTED_FILE') : t('imgFail')); }
    finally { setBusy(false); }
  };
  return (
    <div className="flex items-center gap-3">
      <div className={`flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden bg-slate-100 text-xs text-slate-400 dark:bg-slate-800 ${round ? 'rounded-full' : 'rounded-lg'}`}>
        {value ? <img src={value} alt="" className="h-full w-full object-cover" /> : '—'}
      </div>
      <div className="space-y-1">
        <div className="flex gap-2">
          <label className="cursor-pointer rounded-lg bg-cyan-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-800">
            {busy ? t('loading') : value ? t('replaceFile') : t('uploadImage')}
            <input type="file" className="sr-only" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {value && <button type="button" onClick={() => onChange('')} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600">{t('removeImage')}</button>}
        </div>
        {err && <p className="text-xs text-red-600">{err}</p>}
      </div>
    </div>
  );
}

const ZOOMS = [90, 100, 112, 125, 140];
export function applyZoom(pct: number): void { document.documentElement.style.fontSize = `${pct}%`; }
export function savedZoom(): number { try { const v = Number(localStorage.getItem('nq.zoom')); return ZOOMS.includes(v) ? v : 100; } catch { return 100; } }

/** Page size buttons: scales every rem-based size on the page, remembered on this device. */
export function ZoomControl() {
  const { t } = useI18n();
  const [z, setZ] = useState(savedZoom);
  const set = (n: number) => { setZ(n); applyZoom(n); try { localStorage.setItem('nq.zoom', String(n)); } catch { /* ignore */ } };
  const i = ZOOMS.indexOf(z);
  const cls = 'flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 text-base font-bold disabled:opacity-40 dark:border-slate-700';
  return (
    <span className="inline-flex items-center gap-1" role="group" aria-label={t('pageSize')}>
      <button type="button" className={cls} disabled={i <= 0} onClick={() => set(ZOOMS[i - 1])} aria-label={t('smaller')}>−</button>
      <span className="w-10 text-center text-xs text-slate-500" aria-live="polite">{z}%</span>
      <button type="button" className={cls} disabled={i >= ZOOMS.length - 1} onClick={() => set(ZOOMS[i + 1])} aria-label={t('larger')}>+</button>
    </span>
  );
}
