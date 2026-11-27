import { useEffect, useState } from 'react';
import { api } from '../api';
import { useI18n, type Key } from '../i18n';
import { ErrorBox, Skeleton, money } from '../ui';
import StaffReport from './StaffReport';

interface Ov {
  from: string; to: string;
  requests: { total: number; new: number; confirmed: number; cancelled: number; conversionPct: number | null };
  bookings: { total: number; done: number; cancelled: number; cancelPct: number | null };
  money: { net: number; gross: number; collected: number; outstanding: number; laborCost: number; expenses: number; profit: number };
  rating: { average: number | null; count: number };
  openComplaints: number;
  byService: { name: string; orders: number; revenue: number }[];
  bySupervisor: { id: number; name: string; orders: number; revenue: number; avgRating: number | null }[];
}
type Tab = 'kpi' | 'mgmt' | 'sup';

/** Key indicators, the management report and the supervisors report in one place. */
export default function Reports() {
  const { t, lang } = useI18n();
  const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
  const [tab, setTab] = useState<Tab>('kpi');
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [d, setD] = useState<Ov | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { if (tab === 'sup') return; setD(null); setErr(''); api<Ov>(`/finance/reports/overview?from=${from}&to=${to}`).then(setD).catch((e: Error) => setErr(e.message)); }, [from, to, tab]);
  const inp = 'rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800';
  const card = (label: string, value: string, tone = '') => (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800"><div className="text-xs text-slate-500">{label}</div><div className={`mt-1 text-2xl font-bold ${tone}`}>{value}</div></div>
  );
  const pct = (v: number | null) => (v == null ? '-' : `${v}%`);
  const th = (k: string) => <th className="p-3 text-start font-medium">{t(k as Key)}</th>;
  const tabs: [Tab, Key][] = [['kpi', 'kpiTab'], ['mgmt', 'mgmtTab'], ['sup', 'supTab']];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden"><h1 className="text-xl font-bold">{t('reportsTitle')}</h1><button type="button" onClick={() => window.print()} className="rounded-lg px-3 py-2 text-sm ring-1 ring-slate-300 dark:ring-slate-600">{t('printLbl')}</button></div>
      <div className="flex flex-wrap gap-2 print:hidden">{tabs.map(([k, l]) => <button key={k} type="button" onClick={() => setTab(k)} aria-pressed={tab === k} className={`rounded-full px-4 py-1.5 text-sm ring-1 ${tab === k ? 'bg-cyan-700 text-white ring-cyan-700' : 'ring-slate-300 dark:ring-slate-600'}`}>{t(l)}</button>)}</div>
      {tab !== 'sup' && (
        <div className="flex flex-wrap items-end gap-3 text-sm print:hidden">
          <label>{t('fromLbl')}<input type="date" className={`${inp} mt-1 block`} value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label>
          <label>{t('toLbl')}<input type="date" className={`${inp} mt-1 block`} value={to} onChange={(e) => e.target.value && setTo(e.target.value)} /></label>
        </div>
      )}
      {tab === 'sup' && <StaffReport />}
      {tab !== 'sup' && err && <ErrorBox message={err} />}
      {tab !== 'sup' && !d && !err && <Skeleton rows={4} />}
      {tab === 'kpi' && d && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {card(t('requests'), String(d.requests.total))}
          {card(t('conversionLbl'), pct(d.requests.conversionPct))}
          {card(t('bookings'), String(d.bookings.total))}
          {card(t('cancelRateLbl'), pct(d.bookings.cancelPct))}
          {card(t('revenueLbl'), money(d.money.net, lang))}
          {card(t('collected'), money(d.money.collected, lang))}
          {card(d.money.profit < 0 ? t('netLoss') : t('netProfit'), money(Math.abs(d.money.profit), lang), d.money.profit < 0 ? 'text-red-600' : 'text-emerald-600')}
          {card(t('avgRating'), d.rating.average == null ? '-' : `${d.rating.average} ★ (${d.rating.count})`)}
          {card(t('openComplaints'), String(d.openComplaints), d.openComplaints > 0 ? 'text-red-600' : '')}
        </div>
      )}
      {tab === 'mgmt' && d && (
        <div className="space-y-5">
          <h2 className="font-bold">{t('mgmtTab')}: {d.from} - {d.to}</h2>
          <section className="rounded-2xl bg-white p-4 text-sm shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {([['requests', d.requests.total], ['confirmedLbl', d.requests.confirmed], ['cancelledLbl', d.requests.cancelled], ['bookings', d.bookings.total], ['revenueLbl', money(d.money.net, lang)], ['collected', money(d.money.collected, lang)], ['outstandingLbl', money(d.money.outstanding, lang)], ['laborCost', money(d.money.laborCost, lang)], ['expensesTotal', money(d.money.expenses, lang)], [d.money.profit < 0 ? 'netLoss' : 'netProfit', money(Math.abs(d.money.profit), lang)]] as [Key, string | number][]).map(([k, v]) => <div key={k} className="flex justify-between border-b border-slate-100 py-1 dark:border-slate-800"><dt>{t(k)}</dt><dd className="font-semibold">{v}</dd></div>)}
            </dl>
          </section>
          <section className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
            <h3 className="p-3 font-bold">{t('byServiceLbl')}</h3>
            <table className="w-full min-w-[420px] text-sm"><thead className="text-xs text-slate-500"><tr>{th('name')}{th('ordersLbl')}{th('revenueLbl')}</tr></thead>
              <tbody>{d.byService.length === 0 ? <tr><td className="p-3 text-slate-500" colSpan={3}>{t('noData')}</td></tr> : d.byService.map((s) => <tr key={s.name} className="border-t border-slate-100 dark:border-slate-800"><td className="p-3 font-medium">{s.name}</td><td className="p-3">{s.orders}</td><td className="p-3">{money(s.revenue, lang)}</td></tr>)}</tbody></table>
          </section>
          <section className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
            <h3 className="p-3 font-bold">{t('supervisors')}</h3>
            <table className="w-full min-w-[480px] text-sm"><thead className="text-xs text-slate-500"><tr>{th('name')}{th('ordersLbl')}{th('revenueLbl')}{th('avgRating')}</tr></thead>
              <tbody>{d.bySupervisor.length === 0 ? <tr><td className="p-3 text-slate-500" colSpan={4}>{t('noData')}</td></tr> : d.bySupervisor.map((s) => <tr key={s.id} className="border-t border-slate-100 dark:border-slate-800"><td className="p-3 font-medium">{s.name}</td><td className="p-3">{s.orders}</td><td className="p-3">{money(s.revenue, lang)}</td><td className="p-3">{s.avgRating == null ? '-' : `${s.avgRating} ★`}</td></tr>)}</tbody></table>
          </section>
          <p className="text-xs text-slate-500">{t('reportsNote')}</p>
        </div>
      )}
    </div>
  );
}
