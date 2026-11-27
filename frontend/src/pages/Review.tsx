import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, openFile } from '../api';
import { useAuth } from '../auth';
import { useI18n, type Key } from '../i18n';
import { Button, ErrorBox, Modal, Select, Skeleton } from '../ui';

interface Row { Id: number; Name: string; Phone: string | null; Status: string; CrNumber: string | null; SubmittedAt: string | null }
interface Detail extends Row { VatNumber: string | null; NationalAddress: Record<string, string> | null; Description: string | null; owner: { FullName: string; Email: string; Phone: string | null } | null; sectors: { NameAr: string; NameEn: string }[]; documents: { kind: string; fileName: string; extractStatus: string; mismatch: string[] }[] }

export default function Review() {
  const { t, lang } = useI18n();
  const { can } = useAuth();
  const [status, setStatus] = useState('pending_review');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [open, setOpen] = useState<Detail | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setRows(null);
    api<{ items: Row[] }>(`/platform/companies${status ? `?status=${status}` : ''}`).then((r) => setRows(r.items)).catch(() => setError('Error'));
  }, [status]);
  useEffect(load, [load]);

  const post = async (path: string, body?: unknown) => {
    setError('');
    try {
      await api(`/platform/companies/${open!.Id}/${path}`, { method: 'POST', body });
      setOpen(null); setReason(''); load();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Error'); }
  };
  const canReview = can('platform.companies.review');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">{t('review')}</h1>
        <div className="w-48"><Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t('allStatuses')}</option>
          {['pending_review', 'approved', 'rejected', 'suspended', 'draft'].map((s) => <option key={s} value={s}>{t(`st_${s}` as Key)}</option>)}
        </Select></div>
      </div>
      {error && <ErrorBox message={error} />}
      {!rows ? <Skeleton rows={4} /> : rows.length === 0 ? <p className="py-8 text-center text-slate-500">{t('noData')}</p> : (
        <div className="space-y-2">
          {rows.map((r) => (
            <button key={r.Id} onClick={async () => setOpen(await api<Detail>(`/platform/companies/${r.Id}`))} className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white p-3 text-start dark:border-slate-800 dark:bg-slate-900">
              <div><div className="font-medium">{r.Name}</div><div className="text-xs text-slate-500" dir="ltr">{r.Phone} · CR {r.CrNumber ?? '—'}</div></div>
              <span className="rounded-full bg-slate-200 px-3 py-1 text-xs dark:bg-slate-800">{t(`st_${r.Status}` as Key)}</span>
            </button>
          ))}
        </div>
      )}
      {open && (
        <Modal title={open.Name} onClose={() => { setOpen(null); setReason(''); }}>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-slate-500">{t('owner')}</dt><dd>{open.owner?.FullName} · <span dir="ltr">{open.owner?.Phone}</span></dd>
            <dt className="text-slate-500">{t('mobile')}</dt><dd dir="ltr">{open.Phone}</dd>
            <dt className="text-slate-500">CR</dt><dd dir="ltr">{open.CrNumber ?? '—'}</dd>
            <dt className="text-slate-500">VAT</dt><dd dir="ltr">{open.VatNumber ?? '—'}</dd>
            <dt className="text-slate-500">{t('natAddr')}</dt><dd>{open.NationalAddress ? Object.values(open.NationalAddress).join(' — ') : '—'}</dd>
            <dt className="text-slate-500">{t('sectors')}</dt><dd>{open.sectors.map((s) => (lang === 'ar' ? s.NameAr : s.NameEn)).join(' · ')}</dd>
          </dl>
          <div className="mt-4 space-y-2">
            <p className="text-sm font-medium">{t('docsFor')}</p>
            {['cr', 'vat', 'address'].map((k) => {
              const d = open.documents.find((x) => x.kind === k);
              return (
                <div key={k} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 p-2 text-sm dark:border-slate-700">
                  <span>{t(`doc_${k}` as Key)}{d && d.mismatch.length > 0 && <span className="ms-2 rounded bg-amber-100 px-1.5 text-xs text-amber-800">{t('fileMismatch')}</span>}</span>
                  {d ? <Button variant="ghost" onClick={() => openFile(`/platform/companies/${open.Id}/documents/${k}/file`).catch(() => setError('Error'))}>{t('viewFile')}</Button> : <span className="text-xs text-red-600">{t('docMissing')}</span>}
                </div>
              );
            })}
          </div>
          {canReview && (
            <div className="mt-4 space-y-3">
              {(open.Status === 'pending_review' || open.Status === 'approved') && (
                <input className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800" placeholder={t('reason')} value={reason} onChange={(e) => setReason(e.target.value)} />
              )}
              <div className="flex flex-wrap gap-2">
                {open.Status === 'pending_review' && <Button onClick={() => post('approve')}>{t('approve')}</Button>}
                {open.Status === 'pending_review' && <Button variant="danger" disabled={reason.trim().length < 5} onClick={() => post('reject', { reason })}>{t('reject')}</Button>}
                {open.Status === 'approved' && <Button variant="danger" disabled={reason.trim().length < 5} onClick={() => post('suspend', { reason })}>{t('suspend')}</Button>}
                {open.Status === 'suspended' && <Button onClick={() => post('reactivate')}>{t('reactivate')}</Button>}
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
