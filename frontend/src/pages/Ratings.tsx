import { useEffect, useState } from 'react';
import { api } from '../api';
import { useI18n } from '../i18n';
import { dateTime, ErrorBox, Skeleton } from '../ui';

interface Data { average: number | null; count: number; distribution: { stars: number; count: number }[]; items: { Id: number; Stars: number; Comment: string | null; SubmittedAt: string; BookingNo: string; CustomerName: string; Services: string | null }[] }

export default function Ratings() {
  const { t, lang } = useI18n();
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { api<Data>('/ratings').then(setD).catch(() => setError('Error')); }, []);
  if (error) return <ErrorBox message={error} />;
  if (!d) return <Skeleton />;
  const max = Math.max(1, ...d.distribution.map((x) => x.count));
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-xl font-bold">{t('ratingsTitle')}</h1>
      {d.count === 0 ? <p className="py-8 text-center text-slate-500">{t('noRatings')}</p> : (
        <>
          <div className="flex items-center gap-4 rounded-2xl bg-white p-4 shadow dark:bg-slate-900">
            <div className="text-center"><div className="text-4xl font-bold text-amber-500">{d.average}</div><div className="text-xs text-slate-500">{d.count} {t('ratingsCount')}</div></div>
            <div className="flex-1 space-y-1" dir="ltr">{[5, 4, 3, 2, 1].map((n) => { const c = d.distribution.find((x) => x.stars === n)?.count ?? 0; return <div key={n} className="flex items-center gap-2 text-xs"><span className="w-4">{n}★</span><div className="h-2 flex-1 rounded bg-slate-100 dark:bg-slate-800"><div className="h-2 rounded bg-amber-400" style={{ width: `${(c / max) * 100}%` }} /></div><span className="w-6">{c}</span></div>; })}</div>
          </div>
          <ul className="space-y-2">{d.items.map((r) => (
            <li key={r.Id} className="rounded-2xl bg-white p-3 text-sm shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
              <div className="flex items-center gap-2"><span className="text-amber-500" dir="ltr">{'★'.repeat(r.Stars)}<span className="text-slate-300">{'★'.repeat(5 - r.Stars)}</span></span><span className="font-medium">{r.CustomerName}</span><span className="ms-auto text-xs text-slate-500">{dateTime(r.SubmittedAt, lang)}</span></div>
              <div className="text-xs text-slate-500">{r.BookingNo}{r.Services ? ` - ${r.Services}` : ''}</div>
              {r.Comment && <p className="mt-1">{r.Comment}</p>}
            </li>))}</ul>
        </>
      )}
    </div>
  );
}
