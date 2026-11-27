import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { useI18n, type Key } from '../i18n';
import { Button, ErrorBox, Skeleton } from '../ui';

interface Req { Id: number; CustomerName: string; Phone: string; Address: string | null; PreferredDate: string; PreferredPeriod: string; Notes: string | null; Status: string; ServiceName: string }

export default function Requests() {
  const { t } = useI18n();
  const { can } = useAuth();
  const [rows, setRows] = useState<Req[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => { api<{ items: Req[] }>('/requests').then((r) => setRows(r.items)).catch(() => setError('Error')); }, []);
  useEffect(load, [load]);
  const mark = async (id: number, status: string) => { try { await api(`/requests/${id}`, { method: 'PATCH', body: { status } }); load(); } catch { setError('Error'); } };
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">{t('requests')}</h1>
      {error && <ErrorBox message={error} />}
      {!rows ? <Skeleton rows={3} /> : rows.length === 0 ? <p className="py-8 text-center text-slate-500">{t('reqNone')}</p> : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.Id} className={`rounded-xl border p-3 ${r.Status === 'new' ? 'border-[var(--color-accent)] bg-amber-50/60 dark:bg-amber-950/30' : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><div className="font-semibold">{r.CustomerName} · {r.ServiceName}</div>
                  <div className="text-sm text-slate-500"><a href={`tel:${r.Phone}`} dir="ltr" className="underline">{r.Phone}</a> · {String(r.PreferredDate).slice(0, 10)} · {t(`p_${r.PreferredPeriod}` as Key)}</div></div>
                <span className="rounded-full bg-slate-200 px-3 py-1 text-xs dark:bg-slate-800">{t(`rs_${r.Status}` as Key)}</span>
              </div>
              {(r.Address || r.Notes) && <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{[r.Address, r.Notes].filter(Boolean).join(' — ')}</p>}
              {can('bookings.update') && r.Status !== 'cancelled' && r.Status !== 'confirmed' && (
                <div className="mt-2 flex gap-2">
                  {r.Status === 'new' && <Button variant="ghost" onClick={() => mark(r.Id, 'contacted')}>{t('markContacted')}</Button>}
                  <Button onClick={() => mark(r.Id, 'confirmed')}>{t('markConfirmed')}</Button>
                  <Button variant="danger" onClick={() => mark(r.Id, 'cancelled')}>{t('markCancelled')}</Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
