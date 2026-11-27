import { useEffect, useState } from 'react';
import { api } from '../api';
import { useI18n, type Key } from '../i18n';
import { ErrorBox, Skeleton, money } from '../ui';
import { Columns, Donut, HBars, PALETTE } from '../Charts';
import StaffReport from './StaffReport';

interface Ov {
  from: string; to: string;
  requests: { total: number; new: number; confirmed: number; cancelled: number; conversionPct: number | null };
  bookings: { total: number; done: number; cancelled: number; cancelPct: number | null };
  money: { net: number; gross: number; collected: number; outstanding: number; laborCost: number; expenses: number; profit: number };
  rating: { average: number | null; count: number };
  openComplaints: number;
  daily: { date: string; requests: number; bookings: number; revenue: number }[];
  byService: { name: string; orders: number; revenue: number }[];
  bySupervisor: { id: number; name: string; orders: number; revenue: number; avgRating: number | null }[];
}
type Tab = 'kpi' | 'mgmt' | 'sup';

const csvCell = (v: string | number | null) => `"${String(v ?? '').replace(/"/g, '""')}"`;

/** Key indicators with charts, the management report and the supervisors report. */
export default function Reports() {
  const { t, lang } = useI18n();
  const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
  const [tab, setTab] = useState<Tab>('kpi');
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [d, setD] = useState<Ov | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { setD(null); setErr(''); api<Ov>(`/finance/reports/overview?from=${from}&to=${to}`).then(setD).catch((e: Error) => setErr(e.message)); }, [from, to]);
  const m = (n: number) => money(n, lang);
  const inp = 'rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800';
  const panel = 'rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800 break-inside-avoid';
  const kpi = (label: string, value: string, accent: string, tone = '') => (
    <div className={`${panel} border-s-4`} style={{ borderInlineStartColor: accent }}><div className="text-xs text-slate-500">{label}</div><div className={`mt-1 text-2xl font-bold tabular-nums ${tone}`}>{value}</div></div>
  );
  const pct = (v: number | null) => (v == null ? '-' : `${v}%`);
  const th = (k: string) => <th className="p-3 text-start font-medium">{t(k as Key)}</th>;
  const loss = d ? d.money.profit < 0 : false;

  /** Excel opens this file directly (UTF-8 with BOM so Arabic is kept). */
  const exportCsv = () => {
    if (!d) return;
    const rows: (string | number | null)[][] = [
      [t('reportsTitle'), `${d.from} - ${d.to}`], [],
      [t('requests'), d.requests.total], [t('confirmedLbl'), d.requests.confirmed], [t('cancelledLbl'), d.requests.cancelled], [t('conversionLbl'), pct(d.requests.conversionPct)],
      [t('bookings'), d.bookings.total], [t('cancelRateLbl'), pct(d.bookings.cancelPct)],
      [t('revenueLbl'), d.money.net], [t('collected'), d.money.collected], [t('outstandingLbl'), d.money.outstanding], [t('laborCost'), d.money.laborCost], [t('expensesTotal'), d.money.expenses], [loss ? t('netLoss') : t('netProfit'), Math.abs(d.money.profit)],
      [t('avgRating'), d.rating.average], [t('openComplaints'), d.openComplaints], [],
      [t('byServiceLbl')], [t('name'), t('ordersLbl'), t('revenueLbl')], ...d.byService.map((s) => [s.name, s.orders, s.revenue]), [],
      [t('supervisors')], [t('name'), t('ordersLbl'), t('revenueLbl'), t('avgRating')], ...d.bySupervisor.map((s) => [s.name, s.orders, s.revenue, s.avgRating]), [],
      ['date', t('requests'), t('bookings'), t('revenueLbl')], ...d.daily.map((x) => [x.date, x.requests, x.bookings, x.revenue]),
    ];
    const blob = new Blob(['﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `report-${d.from}_${d.to}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const tabs: [Tab, Key][] = [['kpi', 'kpiTab'], ['mgmt', 'mgmtTab'], ['sup', 'supTab']];
  const dayLabel = (s: string) => s.slice(5);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2"><h1 className="text-xl font-bold">{t('reportsTitle')}</h1>
        <div className="flex gap-2 print:hidden">
          <button type="button" disabled={!d} onClick={exportCsv} className="rounded-lg px-3 py-2 text-sm ring-1 ring-slate-300 disabled:opacity-50 dark:ring-slate-600">{t('exportExcel')}</button>
          <button type="button" onClick={() => window.print()} className="rounded-lg bg-cyan-700 px-3 py-2 text-sm text-white">{t('exportPdf')}</button>
        </div></div>
      <div className="flex flex-wrap gap-2 print:hidden">{tabs.map(([k, l]) => <button key={k} type="button" onClick={() => setTab(k)} aria-pressed={tab === k} className={`rounded-full px-4 py-1.5 text-sm ring-1 ${tab === k ? 'bg-cyan-700 text-white ring-cyan-700' : 'ring-slate-300 dark:ring-slate-600'}`}>{t(l)}</button>)}</div>
      <div className="flex flex-wrap items-end gap-3 text-sm print:hidden">
        <label>{t('fromLbl')}<input type="date" className={`${inp} mt-1 block`} value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label>
        <label>{t('toLbl')}<input type="date" className={`${inp} mt-1 block`} value={to} onChange={(e) => e.target.value && setTo(e.target.value)} /></label>
      </div>
      <p className="hidden text-sm print:block">{from} - {to}</p>
      {tab === 'sup' && <StaffReport />}
      {tab !== 'sup' && err && <ErrorBox message={err} />}
      {tab !== 'sup' && !d && !err && <Skeleton rows={4} />}
      {tab === 'kpi' && d && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {kpi(t('requests'), String(d.requests.total), PALETTE[3])}
            {kpi(t('conversionLbl'), pct(d.requests.conversionPct), PALETTE[1])}
            {kpi(t('bookings'), String(d.bookings.total), PALETTE[0])}
            {kpi(t('cancelRateLbl'), pct(d.bookings.cancelPct), PALETTE[4])}
            {kpi(t('revenueLbl'), m(d.money.net), PALETTE[0])}
            {kpi(t('collected'), m(d.money.collected), PALETTE[2])}
            {kpi(loss ? t('netLoss') : t('netProfit'), m(Math.abs(d.money.profit)), loss ? PALETTE[4] : PALETTE[2], loss ? 'text-red-600' : 'text-emerald-600')}
            {kpi(t('avgRating'), d.rating.average == null ? '-' : `${d.rating.average} ★ (${d.rating.count})`, PALETTE[1])}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <section className={panel}><h2 className="mb-3 font-bold">{t('chartRequestsDaily')}</h2><Columns points={d.daily.map((x) => ({ label: dayLabel(x.date), value: x.requests }))} color={PALETTE[3]} /></section>
            <section className={panel}><h2 className="mb-3 font-bold">{t('chartRevenueDaily')}</h2><Columns points={d.daily.map((x) => ({ label: dayLabel(x.date), value: x.revenue }))} color={PALETTE[0]} format={m} /></section>
            <section className={panel}><h2 className="mb-3 font-bold">{t('chartRequestStatus')}</h2><Donut center={String(d.requests.total)} parts={[{ label: t('newLbl'), value: d.requests.new, color: PALETTE[1] }, { label: t('confirmedLbl'), value: d.requests.confirmed, color: PALETTE[2] }, { label: t('cancelledLbl'), value: d.requests.cancelled, color: PALETTE[4] }]} /></section>
            <section className={panel}><h2 className="mb-3 font-bold">{t('chartMoney')}</h2><HBars format={m} items={[{ label: t('revenueLbl'), value: d.money.net }, { label: t('collected'), value: d.money.collected }, { label: t('laborCost'), value: d.money.laborCost }, { label: t('expensesTotal'), value: d.money.expenses }]} /></section>
            <section className={panel}><h2 className="mb-3 font-bold">{t('byServiceLbl')}</h2>{d.byService.length ? <HBars format={m} items={d.byService.slice(0, 8).map((s) => ({ label: s.name, value: s.revenue }))} /> : <p className="text-sm text-slate-500">{t('noData')}</p>}</section>
            <section className={panel}><h2 className="mb-3 font-bold">{t('supervisors')}</h2>{d.bySupervisor.length ? <HBars items={d.bySupervisor.slice(0, 8).map((s) => ({ label: s.name, value: s.orders }))} /> : <p className="text-sm text-slate-500">{t('noData')}</p>}</section>
          </div>
          {d.openComplaints > 0 && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{t('openComplaints')}: {d.openComplaints}</p>}
        </>
      )}
      {tab === 'mgmt' && d && (
        <div className="space-y-5">
          <h2 className="font-bold">{t('mgmtTab')}: {d.from} - {d.to}</h2>
          <section className={panel}>
            <dl className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
              {([['requests', d.requests.total], ['confirmedLbl', d.requests.confirmed], ['cancelledLbl', d.requests.cancelled], ['bookings', d.bookings.total], ['revenueLbl', m(d.money.net)], ['collected', m(d.money.collected)], ['outstandingLbl', m(d.money.outstanding)], ['laborCost', m(d.money.laborCost)], ['expensesTotal', m(d.money.expenses)], [loss ? 'netLoss' : 'netProfit', m(Math.abs(d.money.profit))]] as [Key, string | number][]).map(([k, v]) => <div key={k} className="flex justify-between border-b border-slate-100 py-2 dark:border-slate-800"><dt>{t(k)}</dt><dd className="font-semibold tabular-nums">{v}</dd></div>)}
            </dl>
          </section>
          <section className={`${panel} overflow-x-auto !p-0`}>
            <h3 className="p-3 font-bold">{t('byServiceLbl')}</h3>
            <table className="w-full min-w-[420px] text-sm"><thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800"><tr>{th('name')}{th('ordersLbl')}{th('revenueLbl')}</tr></thead>
              <tbody>{d.byService.length === 0 ? <tr><td className="p-3 text-slate-500" colSpan={3}>{t('noData')}</td></tr> : d.byService.map((s) => <tr key={s.name} className="border-t border-slate-100 dark:border-slate-800"><td className="p-3 font-medium">{s.name}</td><td className="p-3 tabular-nums">{s.orders}</td><td className="p-3 tabular-nums">{m(s.revenue)}</td></tr>)}</tbody></table>
          </section>
          <section className={`${panel} overflow-x-auto !p-0`}>
            <h3 className="p-3 font-bold">{t('supervisors')}</h3>
            <table className="w-full min-w-[480px] text-sm"><thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800"><tr>{th('name')}{th('ordersLbl')}{th('revenueLbl')}{th('avgRating')}</tr></thead>
              <tbody>{d.bySupervisor.length === 0 ? <tr><td className="p-3 text-slate-500" colSpan={4}>{t('noData')}</td></tr> : d.bySupervisor.map((s) => <tr key={s.id} className="border-t border-slate-100 dark:border-slate-800"><td className="p-3 font-medium">{s.name}</td><td className="p-3 tabular-nums">{s.orders}</td><td className="p-3 tabular-nums">{m(s.revenue)}</td><td className="p-3">{s.avgRating == null ? '-' : `${s.avgRating} ★`}</td></tr>)}</tbody></table>
          </section>
          <p className="text-xs text-slate-500">{t('reportsNote')}</p>
        </div>
      )}
    </div>
  );
}
