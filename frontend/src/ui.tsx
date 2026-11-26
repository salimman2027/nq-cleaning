import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

const base = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-cyan-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';

export function Input(p: InputHTMLAttributes<HTMLInputElement>) { return <input {...p} className={`${base} w-full ${p.className ?? ''}`} />; }
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
