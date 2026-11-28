import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { useI18n } from '../i18n';
import { Button, ErrorBox } from '../ui';

interface Sched { open: string; close: string; slotMinutes: number; days: string; maxPerSlot: number }
const DAYS: [string, string, string][] = [['6', 'السبت', 'Sat'], ['0', 'الأحد', 'Sun'], ['1', 'الاثنين', 'Mon'], ['2', 'الثلاثاء', 'Tue'], ['3', 'الأربعاء', 'Wed'], ['4', 'الخميس', 'Thu'], ['5', 'الجمعة', 'Fri']];

/** Working hours the customer can book into: from/to, slot length, working days, jobs per slot. */
export default function ScheduleSection({ canEdit }: { canEdit: boolean }) {
  const { t, lang } = useI18n();
  const [s, setS] = useState<Sched | null>(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { api<Sched>('/company/schedule').then(setS).catch(() => setErr('Error')); }, []);
  if (!s) return null;
  const cls = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800';
  const toggle = (d: string) => setS({ ...s, days: s.days.includes(d) ? s.days.replace(d, '') : s.days + d });
  const save = async () => {
    setErr(''); setMsg('');
    try { setS(await api<Sched>('/company/schedule', { method: 'PUT', body: s })); setMsg(t('saved')); } catch (e) { setErr(e instanceof ApiError ? t('scheduleBad') : 'Error'); }
  };
  return (
    <section className="space-y-3 rounded-2xl bg-white p-4 shadow dark:bg-slate-900">
      <div><h2 className="font-semibold">{t('workHours')}</h2><p className="text-xs text-slate-500">{t('workHoursHint')}</p></div>
      {err && <ErrorBox message={err} />}
      {msg && <p className="text-sm text-green-700">{msg}</p>}
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="text-sm">{t('fromTime')}<input type="time" dir="ltr" disabled={!canEdit} value={s.open} onChange={(e) => setS({ ...s, open: e.target.value })} className={cls} /></label>
        <label className="text-sm">{t('toTime')}<input type="time" dir="ltr" disabled={!canEdit} value={s.close} onChange={(e) => setS({ ...s, close: e.target.value })} className={cls} /></label>
        <label className="text-sm">{t('slotLen')}<select disabled={!canEdit} value={s.slotMinutes} onChange={(e) => setS({ ...s, slotMinutes: Number(e.target.value) })} className={cls}>{[60, 90, 120, 180, 240].map((m) => <option key={m} value={m}>{m} {t('slotMin')}</option>)}</select></label>
        <label className="text-sm">{t('perSlot')}<input type="number" min={1} max={100} dir="ltr" disabled={!canEdit} value={s.maxPerSlot} onChange={(e) => setS({ ...s, maxPerSlot: Math.max(1, Number(e.target.value) || 1) })} className={cls} /></label>
      </div>
      <div className="flex flex-wrap gap-2">
        {DAYS.map(([d, ar, en]) => <button key={d} type="button" disabled={!canEdit} aria-pressed={s.days.includes(d)} onClick={() => toggle(d)} className={`rounded-full px-3 py-1.5 text-sm ring-1 ${s.days.includes(d) ? 'bg-cyan-700 text-white ring-cyan-700' : 'bg-white ring-slate-300 dark:bg-slate-800 dark:ring-slate-600'}`}>{lang === 'ar' ? ar : en}</button>)}
      </div>
      {canEdit && <Button onClick={() => void save()} disabled={s.days.length === 0}>{t('save')}</Button>}
    </section>
  );
}
