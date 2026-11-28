import { useEffect, useState } from 'react';
import { api } from '../api';
import { useI18n, type Key } from '../i18n';
import { AuthImg } from '../AuthImg';
import { openFile } from '../api';
import { ErrorBox, Modal, money, Skeleton } from '../ui';
import ComplaintForm from './ComplaintForm';

type Stage = 'depart' | 'arrive' | 'start' | 'progress' | 'finish' | 'cash';
interface Track {
  labels?: Record<string, string>; disabled?: string[]; requestId: number; status: string; company: string; slug: string; requestedAt: string; confirmedAt: string | null;
  events: { id: number; stage: Stage; note: string | null; amount: number | null; at: string; files: { Id: number; Kind: string }[] }[];
}
const ORDER: Stage[] = ['depart', 'arrive', 'start', 'progress', 'finish', 'cash'];
const ICON: Record<Stage, string> = { depart: '🚗', arrive: '📍', start: '▶️', progress: '📋', finish: '✅', cash: '💵' };
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Customer's order tracking: dates, each job stage with its photos/videos, and a complaint button on any stage. */
export default function TrackOrder({ orderId, onClose }: { orderId: number; onClose: () => void }) {
  const { t } = useI18n();
  const [d, setD] = useState<Track | null>(null);
  const [err, setErr] = useState('');
  const [complain, setComplain] = useState<Stage | null>(null);
  useEffect(() => { api<Track>(`/shop/orders/${orderId}/track`, { customer: true }).then(setD).catch(() => setErr('Error')); }, [orderId]);
  return (
    <Modal title={`${t('trackOrder')} #${orderId}`} onClose={onClose}>
      {err && <ErrorBox message={err} />}
      {!d ? <Skeleton rows={4} /> : (
        <div className="space-y-3">
          <div className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800">
            <div>{t('requestedAt')}: <b dir="ltr">{when(d.requestedAt)}</b></div>
            <div>{t('confirmedAt')}: <b dir="ltr">{d.confirmedAt ? when(d.confirmedAt) : '—'}</b></div>
          </div>
          <ol className="space-y-2">
            {ORDER.filter((s) => !d.disabled?.includes(s) && (s !== 'cash' || d.events.some((e) => e.stage === 'cash'))).map((s) => {
              const evs = d.events.filter((e) => e.stage === s);
              return (
                <li key={s} className={`rounded-xl p-3 ring-1 ${evs.length ? 'ring-cyan-600' : 'ring-slate-200 dark:ring-slate-700'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{evs.length ? '✔️' : ICON[s]} {d.labels?.[s] || t(`st_${s}` as Key)}</span>
                    {evs.length > 0 && <button type="button" onClick={() => setComplain(s)} className="text-xs text-slate-500 underline">{t('complainStage')}</button>}
                  </div>
                  {evs.map((e) => (
                    <div key={e.id} className="mt-1 text-sm">
                      <div className="text-slate-500" dir="ltr">{when(e.at)}{e.amount != null ? ` · ${money(e.amount)}` : ''}</div>
                      {e.note && <div>{e.note}</div>}
                      {e.files.length > 0 && <div className="mt-1 flex flex-wrap gap-2">{e.files.map((f) => f.Kind === 'photo'
                        ? <AuthImg key={f.Id} customer path={`/shop/orders/${orderId}/track/files/${f.Id}`} />
                        : <button key={f.Id} type="button" onClick={() => void openFile(`/shop/orders/${orderId}/track/files/${f.Id}`, true)} className="rounded-lg bg-slate-100 px-3 py-4 text-sm dark:bg-slate-800">🎥 {t('viewVideo')}</button>)}</div>}
                    </div>))}
                  {evs.length === 0 && <div className="text-sm text-slate-400">{t('notYet')}</div>}
                </li>
              );
            })}
          </ol>
        </div>
      )}
      {complain && d && <ComplaintForm slug={d.slug} orderId={orderId} stage={complain} onClose={() => setComplain(null)} />}
    </Modal>
  );
}
