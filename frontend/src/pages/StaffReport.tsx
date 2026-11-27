import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useI18n } from '../i18n';
import { ErrorBox, Skeleton, money } from '../ui';

interface Sup { Id: number; FullName: string; Orders: number; Hours: number; Revenue: number }
interface Tech { Id: number; FullName: string; SupervisorName: string | null; HourlyCost: number; Orders: number; Hours: number; OvertimeHours: number; Cost?: number }
interface Rep { from: string; to: string; dayHours: number; supervisors: Sup[]; technicians: Tech[] }

/** Orders and hours per supervisor and technician, for incentives and overtime. */
export default function StaffReport() {
  const { t, lang } = useI18n();
  const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [dayHours, setDayHours] = useState('8');
  const [r, setR] = useState<Rep | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => { setR(null); api<Rep>(`/finance/reports/staff?from=${from}&to=${to}&dayHours=${dayHours || 8}`).then(setR).catch((e: Error) => setErr(e.message)); }, [from, to, dayHours]);
  useEffect(load, [load]);
  const inp = 'rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800';
  const th = (k: string) => <th className="p-3 text-start font-medium">{t(k as never)}</th>;
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold">{t('staffReport')}</h1>
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label>{t('fromLbl')}<input type="date" className={`${inp} mt-1 block`} value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label>
        <label>{t('toLbl')}<input type="date" className={`${inp} mt-1 block`} value={to} onChange={(e) => e.target.value && setTo(e.target.value)} /></label>
        <label>{t('dayHoursLbl')}<input type="number" min={1} max={24} className={`${inp} mt-1 block w-24`} value={dayHours} onChange={(e) => setDayHours(e.target.value)} /></label>
      </div>
      {err && <ErrorBox message={err} />}
      {!r ? <Skeleton rows={5} /> : (
        <>
          <section className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
            <h2 className="p-3 font-bold">{t('supervisors')}</h2>
            <table className="w-full min-w-[480px] text-sm"><thead className="text-xs text-slate-500"><tr>{th('name')}{th('ordersLbl')}{th('hoursUnit')}{th('revenueLbl')}</tr></thead>
              <tbody>{r.supervisors.length === 0 ? <tr><td className="p-3 text-slate-500" colSpan={4}>{t('noData')}</td></tr> : r.supervisors.map((s) => <tr key={s.Id} className="border-t border-slate-100 dark:border-slate-800"><td className="p-3 font-medium">{s.FullName}</td><td className="p-3">{s.Orders}</td><td className="p-3">{s.Hours}</td><td className="p-3">{money(s.Revenue, lang)}</td></tr>)}</tbody></table>
          </section>
          <section className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
            <h2 className="p-3 font-bold">{t('technicians')}</h2>
            <table className="w-full min-w-[640px] text-sm"><thead className="text-xs text-slate-500"><tr>{th('name')}{th('supervisor')}{th('ordersLbl')}{th('hoursUnit')}{th('overtimeLbl')}{th('laborCost')}</tr></thead>
              <tbody>{r.technicians.map((x) => <tr key={x.Id} className="border-t border-slate-100 dark:border-slate-800"><td className="p-3 font-medium">{x.FullName}</td><td className="p-3">{x.SupervisorName ?? '—'}</td><td className="p-3">{x.Orders}</td><td className="p-3">{x.Hours}</td><td className={`p-3 ${x.OvertimeHours > 0 ? 'font-semibold text-amber-700' : ''}`}>{x.OvertimeHours}</td><td className="p-3">{x.Cost != null ? money(x.Cost, lang) : '—'}</td></tr>)}</tbody></table>
          </section>
          <p className="text-xs text-slate-500">{t('staffNote')} ({t('dayHoursLbl')}: {r.dayHours})</p>
        </>
      )}
    </div>
  );
}
