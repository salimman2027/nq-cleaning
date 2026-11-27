import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { useI18n, type Key } from '../i18n';
import { Button, ErrorBox, Modal, Skeleton, money } from '../ui';

type Period = 'day' | 'week' | 'month';
interface Row { AvgRating: number | null; RatingsCount: number; Id: number; Name: string; Slug: string; Status: string; ReviewNote: string | null; Requests: number; Confirmed: number; Cancelled: number; Waiting: number; Value: number; Collected: number; Bookings: number; OpenComplaints: number; Complaints: number }
interface Data { totals: { companies: number; requests: number; bookings: number; value: number; collected: number; complaints: number; openComplaints: number }; series: { date: string; count: number }[]; companies: Row[] }

/** Platform owner's view of what each company did, by day / week / month, with suspend and reactivate. */
export default function Monitor() {
  const { t, lang } = useI18n();
  const { can } = useAuth();
  const [period, setPeriod] = useState<Period>('week');
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [target, setTarget] = useState<Row | null>(null);
  const [reason, setReason] = useState('');
  const load = useCallback(() => {
    setData(null);
    api<Data>(`/platform/monitor?period=${period}`).then(setData).catch(() => setError('Error'));
  }, [period]);
  useEffect(load, [load]);

  const act = async (path: 'suspend' | 'reactivate', body?: unknown) => {
    setError('');
    try { await api(`/platform/companies/${target!.Id}/${path}`, { method: 'POST', body }); setTarget(null); setReason(''); load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Error'); }
  };
  const max = Math.max(1, ...(data?.series.map((s) => s.count) ?? [1]));
  const card = (label: string, value: string | number, tone = '') => (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800"><div className="text-xs text-slate-500">{label}</div><div className={`mt-1 text-2xl font-bold ${tone}`}>{value}</div></div>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">{t('monitor')}</h1>
        <div className="flex gap-1 rounded-xl bg-slate-200 p-1 dark:bg-slate-800" role="tablist">
          {(['day', 'week', 'month'] as Period[]).map((p) => (
            <button key={p} role="tab" aria-selected={period === p} onClick={() => setPeriod(p)} className={`rounded-lg px-4 py-1.5 text-sm font-medium ${period === p ? 'bg-white shadow dark:bg-slate-950' : 'text-slate-600 dark:text-slate-300'}`}>{t(`per_${p}` as Key)}</button>
          ))}
        </div>
      </div>
      {error && <ErrorBox message={error} />}
      {!data ? <Skeleton rows={5} /> : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {card(t('companiesCount'), data.totals.companies)}
            {card(t('requests'), data.totals.requests)}
            {card(t('ordersValue'), money(data.totals.value, lang))}
            {card(t('openComplaints'), data.totals.openComplaints, data.totals.openComplaints ? 'text-red-600' : '')}
          </div>
          {data.series.length > 0 && (
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
              <div className="mb-2 text-sm font-medium">{t('requestsPerDay')}</div>
              <div className="flex h-32 items-end gap-1" dir="ltr">
                {data.series.map((s) => (
                  <div key={s.date} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${s.date}: ${s.count}`}>
                    <span className="text-[10px] text-slate-500">{s.count}</span>
                    <div className="w-full rounded-t bg-[var(--color-accent)]" style={{ height: `${Math.max(6, (s.count / max) * 100)}%` }} />
                    <span className="text-[9px] text-slate-400">{s.date.slice(5)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {data.companies.length === 0 ? <p className="py-8 text-center text-slate-500">{t('noData')}</p> : (
            <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="text-start text-xs text-slate-500"><tr>
                  {['company', 'requests', 'waitingLbl', 'confirmedLbl', 'cancelledLbl', 'bookings', 'ordersValue', 'collected', 'complaintsLbl', 'avgRating', ''].map((k, i) => <th key={i} className="px-3 py-2 text-start font-medium">{k && t(k as Key)}</th>)}
                </tr></thead>
                <tbody>
                  {data.companies.map((c) => (
                    <tr key={c.Id} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="px-3 py-2 font-medium"><Link to={`/c/${c.Slug}`} className="hover:underline">{c.Name}</Link>{c.Status === 'suspended' && <span className="ms-2 rounded bg-red-100 px-1.5 text-xs text-red-700">{t('st_suspended')}</span>}</td>
                      <td className="px-3 py-2 font-semibold">{c.Requests}</td><td className="px-3 py-2">{c.Waiting}</td><td className="px-3 py-2">{c.Confirmed}</td><td className="px-3 py-2">{c.Cancelled}</td><td className="px-3 py-2">{c.Bookings}</td>
                      <td className="px-3 py-2">{money(c.Value, lang)}</td><td className="px-3 py-2">{money(c.Collected, lang)}</td>
                      <td className="px-3 py-2">{c.OpenComplaints > 0 ? <Link to={`/app/complaints?companyId=${c.Id}`} className="font-semibold text-red-600">{c.OpenComplaints}</Link> : 0}</td>
                      <td className="px-3 py-2">{c.AvgRating != null ? `${c.AvgRating}★ (${c.RatingsCount})` : '-'}</td>
                      <td className="px-3 py-2 text-end">{can('platform.companies.review') && <Button variant={c.Status === 'suspended' ? 'ghost' : 'danger'} onClick={() => { setTarget(c); setReason(''); }}>{c.Status === 'suspended' ? t('reactivate') : t('suspend')}</Button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-slate-500">{t('monitorNote')}</p>
        </>
      )}
      {target && (
        <Modal title={`${target.Status === 'suspended' ? t('reactivate') : t('suspend')}: ${target.Name}`} onClose={() => setTarget(null)}>
          {target.Status === 'suspended' ? (
            <div className="space-y-3"><p className="text-sm">{target.ReviewNote && <>{t('suspendReason')}: <b>{target.ReviewNote}</b></>}</p><Button onClick={() => act('reactivate')}>{t('reactivate')}</Button></div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-slate-600 dark:text-slate-300">{t('suspendWarn')}</p>
              <textarea rows={3} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800" placeholder={t('suspendReason')} value={reason} onChange={(e) => setReason(e.target.value)} />
              <Button variant="danger" disabled={reason.trim().length < 5} onClick={() => act('suspend', { reason })}>{t('suspend')}</Button>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
