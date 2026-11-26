import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useI18n, type Key } from '../i18n';
import { ErrorBox, money, Skeleton } from '../ui';

interface Dash {
  bookings: Record<string, number>;
  money: Record<string, number>;
  technicians: { available: number; busy: number; absent: number; offDuty: number };
  topServices: { Name: string; bookings: number }[];
  dailyBookings: { day: string; bookings: number }[];
}

export default function Dashboard() {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const [d, setD] = useState<Dash | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api<Dash>('/dashboard').then(setD).catch((e: Error) => setErr(e.message));
  }, []);

  if (err) return <ErrorBox message={err} />;
  if (!d) return <Skeleton rows={6} />;

  const cards: { key: Key; value: string | number; to?: string }[] = [
    { key: 'todayTotal', value: d.bookings.todayTotal, to: '/bookings' },
    { key: 'todayNew', value: d.bookings.todayNew, to: '/bookings?status=new' },
    { key: 'todayConfirmed', value: d.bookings.todayConfirmed, to: '/bookings?status=confirmed' },
    { key: 'unassigned', value: d.bookings.unassigned, to: '/bookings?status=awaiting_assignment' },
    { key: 'todayInProgress', value: d.bookings.todayInProgress, to: '/bookings?status=in_progress' },
    { key: 'todayDone', value: d.bookings.todayDone, to: '/bookings?status=done' },
    { key: 'late', value: d.bookings.late, to: '/bookings' },
    { key: 'todayCancelled', value: d.bookings.todayCancelled, to: '/bookings?status=cancelled' },
    { key: 'tomorrow', value: d.bookings.tomorrow, to: '/bookings' },
    { key: 'techAvailable', value: d.technicians.available, to: '/technicians' },
    { key: 'techBusy', value: d.technicians.busy, to: '/technicians' },
    { key: 'techAbsent', value: d.technicians.absent, to: '/technicians' },
    { key: 'revenueToday', value: money(d.money.revenueToday, lang) },
    { key: 'revenueMonth', value: money(d.money.revenueMonth, lang) },
    { key: 'collectedMonth', value: money(d.money.collectedMonth, lang) },
    { key: 'outstandingMonth', value: money(d.money.outstandingMonth, lang) },
  ];
  const max = Math.max(1, ...d.dailyBookings.map((x) => x.bookings));
  const maxSvc = Math.max(1, ...d.topServices.map((x) => x.bookings));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {cards.map((c) => (
          <button key={c.key} onClick={() => c.to && nav(c.to)} className="rounded-xl bg-white p-4 text-start shadow-sm hover:shadow dark:bg-slate-900">
            <div className="text-xs text-slate-500">{t(c.key)}</div>
            <div className="mt-1 text-2xl font-bold">{c.value}</div>
          </button>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-xl bg-white p-4 dark:bg-slate-900">
          <h3 className="mb-3 font-semibold">{t('daily')}</h3>
          {d.dailyBookings.length === 0 ? <p className="text-sm text-slate-500">{t('noData')}</p> : (
            <div className="flex h-40 items-end gap-1">
              {d.dailyBookings.map((x) => (
                <div key={x.day} className="flex flex-1 flex-col items-center justify-end" title={`${x.day}: ${x.bookings}`}>
                  <div className="w-full rounded-t bg-cyan-600" style={{ height: `${(x.bookings / max) * 100}%` }} />
                  <span className="mt-1 text-[10px] text-slate-500">{String(x.day).slice(8, 10)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="rounded-xl bg-white p-4 dark:bg-slate-900">
          <h3 className="mb-3 font-semibold">{t('topServices')}</h3>
          {d.topServices.length === 0 ? <p className="text-sm text-slate-500">{t('noData')}</p> : d.topServices.map((s) => (
            <div key={s.Name} className="mb-2">
              <div className="flex justify-between text-sm"><span>{s.Name}</span><span>{s.bookings}</span></div>
              <div className="h-2 rounded bg-slate-200 dark:bg-slate-700"><div className="h-2 rounded bg-cyan-600" style={{ width: `${(s.bookings / maxSvc) * 100}%` }} /></div>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
