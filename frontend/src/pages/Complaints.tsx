import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { useI18n, type Key } from '../i18n';
import { Button, ErrorBox, Select, Skeleton } from '../ui';

interface C { Id: number; CompanyName: string; RequestId: number | null; CustomerName: string; Phone: string; Message: string; Status: string; PlatformNote: string | null; CreatedAt: string }

/** Customer complaints about companies; the platform team moves them open → in review → resolved. */
export default function Complaints() {
  const { t } = useI18n();
  const { can } = useAuth();
  const [sp] = useSearchParams();
  const companyId = sp.get('companyId');
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<C[] | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setRows(null);
    const q = new URLSearchParams(); if (status) q.set('status', status); if (companyId) q.set('companyId', companyId);
    api<{ items: C[] }>(`/platform/complaints?${q}`).then((r) => setRows(r.items)).catch(() => setError('Error'));
  }, [status, companyId]);
  useEffect(load, [load]);
  const set = async (id: number, st: string) => {
    try { await api(`/platform/complaints/${id}`, { method: 'PATCH', body: { status: st, note: notes[id]?.trim() || undefined } }); load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Error'); }
  };
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">{t('complaints')}</h1>
        <div className="w-48"><Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t('allStatuses')}</option>
          {['open', 'in_review', 'resolved'].map((s) => <option key={s} value={s}>{t(`cs_${s}` as Key)}</option>)}
        </Select></div>
      </div>
      {error && <ErrorBox message={error} />}
      {!rows ? <Skeleton rows={3} /> : rows.length === 0 ? <p className="py-8 text-center text-slate-500">{t('noComplaints')}</p> : rows.map((c) => (
        <article key={c.Id} className="space-y-2 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-semibold">{c.CompanyName}{c.RequestId && <span className="ms-2 text-xs font-normal text-slate-500">#{c.RequestId}</span>}</div>
            <span className={`rounded-full px-3 py-1 text-xs ${c.Status === 'open' ? 'bg-red-100 text-red-700' : c.Status === 'resolved' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}`}>{t(`cs_${c.Status}` as Key)}</span>
          </div>
          <p className="whitespace-pre-line text-sm">{c.Message}</p>
          <div className="text-xs text-slate-500">{c.CustomerName} · <span dir="ltr">{c.Phone}</span> · {String(c.CreatedAt).slice(0, 10)}</div>
          {c.PlatformNote && <p className="rounded-lg bg-slate-100 p-2 text-xs dark:bg-slate-800">{c.PlatformNote}</p>}
          {can('platform.companies.review') && c.Status !== 'resolved' && (
            <div className="flex flex-wrap items-center gap-2">
              <input className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800" placeholder={t('platformNote')} value={notes[c.Id] ?? ''} onChange={(e) => setNotes({ ...notes, [c.Id]: e.target.value })} />
              {c.Status === 'open' && <Button variant="ghost" onClick={() => set(c.Id, 'in_review')}>{t('startReview')}</Button>}
              <Button onClick={() => set(c.Id, 'resolved')}>{t('markResolved')}</Button>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
