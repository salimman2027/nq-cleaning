import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { useI18n, type Key } from '../i18n';
import { Button, ErrorBox, Modal, money, Skeleton } from '../ui';

interface Req { Id: number; CustomerName: string; Phone: string; Address: string | null; PreferredDate: string; PreferredPeriod: string; Notes: string | null; Status: string; City: string | null; District: string | null; ServiceName: string; CreatedAt: string; PaymentStatus: string | null; Total: number | null; Latitude?: number | null; Longitude?: number | null; PhotoUrl?: string | null; Items: { Name: string; Qty: number; UnitPrice: number }[] }
type Period = 'day' | 'week' | 'month' | 'all';
const STATUSES = ['new', 'contacted', 'confirmed', 'cancelled'] as const;
const riyadh = (iso: string) => new Date(Date.parse(iso) + 3 * 3600_000).toISOString().slice(0, 10);

/** Booking requests as a filterable table; a row opens the full details and actions. */
export default function Requests() {
  const { t, lang } = useI18n();
  const { can } = useAuth();
  const [rows, setRows] = useState<Req[] | null>(null);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState<Period>('month');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Req | null>(null);
  const load = useCallback(() => { api<{ items: Req[] }>('/requests').then((r) => { setRows(r.items); setOpen((o) => (o ? r.items.find((x) => x.Id === o.Id) ?? null : o)); }).catch(() => setError('Error')); }, []);
  useEffect(load, [load]);
  const [price, setPrice] = useState('');
  useEffect(() => { setPrice(open?.Total != null ? String(open.Total) : ''); }, [open?.Id, open?.Total]);
  const savePrice = async () => { try { await api(`/requests/${open!.Id}/total`, { method: 'PATCH', body: { total: Number(price) } }); load(); } catch { setError('Error'); } };
  const act = async (url: string, body: unknown) => { try { await api(url, { method: 'PATCH', body }); load(); } catch { setError('Error'); } };

  const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
  const from = useMemo(() => {
    if (period === 'day') return today;
    if (period === 'month') return `${today.slice(0, 7)}-01`;
    if (period === 'week') { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 1) % 7)); return d.toISOString().slice(0, 10); } // week starts on Saturday
    return '0000-00-00';
  }, [period, today]);
  const list = useMemo(() => (rows ?? []).filter((r) => riyadh(r.CreatedAt) >= from && (!status || r.Status === status) && (!q.trim() || `${r.CustomerName} ${r.Phone} ${r.ServiceName}`.toLowerCase().includes(q.trim().toLowerCase()))), [rows, from, status, q]);
  const count = (s: string) => list.filter((r) => r.Status === s).length;
  const value = list.filter((r) => r.Status !== 'cancelled').reduce((a, r) => a + Number(r.Total ?? 0), 0);
  const kpi = (label: string, v: string, tone: string) => <div className="rounded-2xl border-s-4 bg-white p-3 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800" style={{ borderInlineStartColor: tone }}><div className="text-xs text-slate-500">{label}</div><div className="mt-1 text-xl font-bold tabular-nums">{v}</div></div>;
  const chip = (p: Period, k: Key) => <button key={p} type="button" onClick={() => setPeriod(p)} aria-pressed={period === p} className={`rounded-full px-4 py-1.5 text-sm ring-1 ${period === p ? 'bg-cyan-700 text-white ring-cyan-700' : 'ring-slate-300 dark:ring-slate-600'}`}>{t(k)}</button>;
  const badge = (s: string) => <span className={`rounded-full px-3 py-1 text-xs ${s === 'new' ? 'bg-amber-100 text-amber-900' : s === 'confirmed' ? 'bg-emerald-100 text-emerald-900' : s === 'cancelled' ? 'bg-red-100 text-red-800' : 'bg-slate-200 dark:bg-slate-800'}`}>{t(`rs_${s}` as Key)}</span>;
  const th = (k: Key) => <th className="p-3 text-start font-medium">{t(k)}</th>;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">{t('requests')}</h1>
      {error && <ErrorBox message={error} />}
      <div className="flex flex-wrap items-center gap-2">
        {chip('day', 'periodDay')}{chip('week', 'periodWeek')}{chip('month', 'periodMonth')}{chip('all', 'periodAll')}
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"><option value="">{t('statusAll')}</option>{STATUSES.map((s) => <option key={s} value={s}>{t(`rs_${s}` as Key)}</option>)}</select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('searchPh')} className="min-w-[180px] flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {kpi(t('requests'), String(list.length), '#6366f1')}{kpi(t('rs_new'), String(count('new')), '#f59e0b')}{kpi(t('rs_contacted'), String(count('contacted')), '#64748b')}{kpi(t('rs_confirmed'), String(count('confirmed')), '#10b981')}{kpi(t('rs_cancelled'), String(count('cancelled')), '#ef4444')}{kpi(t('reqValue'), money(value, lang), '#0e7490')}
      </div>
      {!rows ? <Skeleton rows={4} /> : list.length === 0 ? <p className="py-8 text-center text-slate-500">{t('reqNone')}</p> : (
        <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800"><tr>{th('colCustomer')}{th('colPhone')}{th('colService')}{th('colDate')}{th('colArea')}{th('total')}{th('colPayment')}{th('colStatus')}</tr></thead>
            <tbody>{list.map((r) => (
              <tr key={r.Id} onClick={() => setOpen(r)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(r)} className={`cursor-pointer border-t border-slate-100 hover:bg-cyan-50 dark:border-slate-800 dark:hover:bg-slate-800 ${r.Status === 'new' ? 'bg-amber-50/60 dark:bg-amber-950/20' : ''}`}>
                <td className="p-3 font-medium">{r.CustomerName}</td><td className="p-3" dir="ltr">{r.Phone}</td><td className="p-3">{r.ServiceName}</td>
                <td className="p-3 whitespace-nowrap">{String(r.PreferredDate).slice(0, 10)} · {t(`p_${r.PreferredPeriod}` as Key)}</td>
                <td className="p-3">{[r.City, r.District].filter(Boolean).join(' / ') || '-'}</td>
                <td className="p-3 tabular-nums">{r.Total != null ? money(r.Total, lang) : '-'}</td>
                <td className="p-3">{r.Total == null ? '-' : r.PaymentStatus === 'paid' ? t('paid') : t('unpaid')}</td>
                <td className="p-3">{badge(r.Status)}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
      {open && (
        <Modal title={`${open.CustomerName} · ${open.ServiceName}`} onClose={() => setOpen(null)}>
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">{badge(open.Status)}<a href={`tel:${open.Phone}`} dir="ltr" className="underline">{open.Phone}</a></div>
            <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
              <div><dt className="text-xs text-slate-500">{t('colDate')}</dt><dd>{String(open.PreferredDate).slice(0, 10)} · {t(`p_${open.PreferredPeriod}` as Key)}</dd></div>
              <div><dt className="text-xs text-slate-500">{t('receivedLbl')}</dt><dd>{riyadh(open.CreatedAt)}</dd></div>
              <div><dt className="text-xs text-slate-500">{t('colArea')}</dt><dd>{[open.City, open.District].filter(Boolean).join(' / ') || '-'}</dd></div>
              <div><dt className="text-xs text-slate-500">{t('colPayment')}</dt><dd>{t('cashLbl')} · {open.Total == null ? '-' : open.PaymentStatus === 'paid' ? t('paid') : t('unpaid')}</dd></div>
            </dl>
            {open.Address && <p>{open.Address}</p>}
            {open.Latitude != null && open.Longitude != null && <a href={`https://www.google.com/maps?q=${open.Latitude},${open.Longitude}`} target="_blank" rel="noreferrer" className="inline-block text-cyan-700 underline">📍 {t('openMap')}</a>}
            {open.PhotoUrl && <a href={open.PhotoUrl} target="_blank" rel="noreferrer"><img src={open.PhotoUrl} alt="" className="max-h-56 rounded-xl object-cover" /></a>}
            {can('bookings.update') && open.Status !== 'cancelled' && open.PaymentStatus !== 'paid' && (
              <div className="flex items-end gap-2">
                <label className="block flex-1 text-sm">{t('editPrice')}<input type="number" min="0" step="0.01" dir="ltr" value={price} onChange={(e) => setPrice(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800" /></label>
                <Button variant="ghost" disabled={price === '' || Number(price) < 0 || Number(price) === open.Total} onClick={() => void savePrice()}>{t('savePrice')}</Button>
              </div>
            )}
            {open.Notes && <p className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800">{open.Notes}</p>}
            {open.Items.length > 0 && <ul className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">{open.Items.map((i, k) => <li key={k} className="flex justify-between"><span>{i.Name} × {i.Qty}</span><span className="tabular-nums">{money(i.UnitPrice * i.Qty, lang)}</span></li>)}{open.Total != null && <li className="mt-1 flex justify-between border-t pt-1 font-bold dark:border-slate-700"><span>{t('total')}</span><span className="tabular-nums">{money(open.Total, lang)}</span></li>}</ul>}
            {can('bookings.update') && (
              <div className="flex flex-wrap gap-2 pt-1">
                {open.Total != null && open.PaymentStatus !== 'paid' && open.Status !== 'cancelled' && <Button variant="ghost" onClick={() => act(`/requests/${open.Id}/payment`, { paymentStatus: 'paid' })}>{t('markPaid')}</Button>}
                {open.Status === 'new' && <Button variant="ghost" onClick={() => act(`/requests/${open.Id}`, { status: 'contacted' })}>{t('markContacted')}</Button>}
                {open.Status !== 'cancelled' && open.Status !== 'confirmed' && <Button onClick={() => act(`/requests/${open.Id}`, { status: 'confirmed' })}>{t('markConfirmed')}</Button>}
                {open.Status !== 'cancelled' && open.Status !== 'confirmed' && <Button variant="danger" onClick={() => act(`/requests/${open.Id}`, { status: 'cancelled' })}>{t('markCancelled')}</Button>}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
