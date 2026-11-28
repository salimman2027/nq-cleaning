import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { useI18n } from '../i18n';
import { Button, ErrorBox } from '../ui';
import { useAuth } from '../auth';

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

interface Team { supervisorId: number; fullName: string; custom: boolean; open: string; close: string; days: string; maxPerSlot: number }

/** Each work team can follow the company hours or have its own hours, days and jobs per slot. */
export function TeamSchedules() {
  const { t, lang } = useI18n();
  const { can } = useAuth();
  const [rows, setRows] = useState<Team[] | null>(null);
  const [err, setErr] = useState('');
  const edit = can('technicians.manage');
  const load = () => { api<{ items: Team[] }>('/supervisors/schedules').then((r) => setRows(r.items)).catch(() => setErr('Error')); };
  useEffect(load, []);
  if (!rows || rows.length === 0) return null;
  const patch = (id: number, p: Partial<Team>) => setRows(rows.map((r) => (r.supervisorId === id ? { ...r, ...p, custom: true } : r)));
  const save = async (r: Team) => { setErr(''); try { await api(`/supervisors/${r.supervisorId}/schedule`, { method: 'PUT', body: { open: r.open, close: r.close, days: r.days, maxPerSlot: r.maxPerSlot } }); load(); } catch { setErr(t('scheduleBad')); } };
  const reset = async (r: Team) => { setErr(''); try { await api(`/supervisors/${r.supervisorId}/schedule`, { method: 'DELETE' }); load(); } catch { setErr('Error'); } };
  const cls = 'w-full rounded-lg border border-slate-300 px-2 py-1.5 dark:border-slate-600 dark:bg-slate-800';
  return (
    <section className="space-y-3 rounded-2xl bg-white p-4 shadow dark:bg-slate-900">
      <div><h2 className="font-semibold">{t('teamSchedules')}</h2><p className="text-xs text-slate-500">{t('teamSchedulesHint')}</p></div>
      {err && <ErrorBox message={err} />}
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.supervisorId} className="space-y-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <div className="flex items-center justify-between gap-2"><b>{r.fullName}</b><span className="text-xs text-slate-500">{r.custom ? t('ownSchedule') : t('followsCompany')}</span></div>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <label>{t('fromTime')}<input type="time" dir="ltr" disabled={!edit} value={r.open} onChange={(e) => patch(r.supervisorId, { open: e.target.value })} className={cls} /></label>
              <label>{t('toTime')}<input type="time" dir="ltr" disabled={!edit} value={r.close} onChange={(e) => patch(r.supervisorId, { close: e.target.value })} className={cls} /></label>
              <label>{t('perSlot')}<input type="number" min={1} max={50} dir="ltr" disabled={!edit} value={r.maxPerSlot} onChange={(e) => patch(r.supervisorId, { maxPerSlot: Math.max(1, Number(e.target.value) || 1) })} className={cls} /></label>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {DAYS.map(([d, ar, en]) => <button key={d} type="button" disabled={!edit} aria-pressed={r.days.includes(d)} onClick={() => patch(r.supervisorId, { days: r.days.includes(d) ? r.days.replace(d, '') : r.days + d })} className={`rounded-full px-2.5 py-1 text-xs ring-1 ${r.days.includes(d) ? 'bg-cyan-700 text-white ring-cyan-700' : 'bg-white ring-slate-300 dark:bg-slate-800 dark:ring-slate-600'}`}>{lang === 'ar' ? ar : en}</button>)}
            </div>
            {edit && <div className="flex gap-2"><Button disabled={r.days.length === 0} onClick={() => void save(r)}>{t('save')}</Button>{r.custom && <Button variant="ghost" onClick={() => void reset(r)}>{t('useCompanyHours')}</Button>}</div>}
          </div>
        ))}
      </div>
    </section>
  );
}
