import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, fileToBase64, openFile } from '../api';
import { useI18n, type Key } from '../i18n';
import { AuthImg } from '../AuthImg';
import { shrink } from '../image';
import { Button, ErrorBox, money, Skeleton } from '../ui';

type Stage = 'depart' | 'arrive' | 'start' | 'progress' | 'finish' | 'cash' | 'next';
interface Rule { stage: Stage; noteReq: boolean; photoReq: boolean; videoReq: boolean; label?: string | null; enabled?: boolean }
interface Job {
  Id: number; BookingNo: string; Status: string; StartAt: string; Total: number; Paid: number; Notes: string | null;
  CustomerName: string; CustomerMobile: string; City: string | null; District: string | null; Street: string | null; MapUrl: string | null;
  Latitude: number | null; Longitude: number | null; PhotoUrl: string | null;
  Lines: { Name: string; Quantity: number }[]; Team: string[]; Events: { Id: number; Stage: Stage; Note: string | null; Amount: number | null; Method?: string | null; CreatedAt: string; Files: number }[];
}
const ICON: Record<Stage, string> = { depart: '🚗', arrive: '📍', start: '▶️', progress: '📋', finish: '✅', cash: '💵', next: '➡️' };
const ORDER: Stage[] = ['depart', 'arrive', 'start', 'progress', 'finish', 'cash', 'next'];
const time = (iso: string) => new Date(iso).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Riyadh' });

/** Which stages the supervisor can press right now, from the job status. */
/** The company's stage rules: custom names and which optional stages are switched off. Loaded once per screen. */
function useRules() {
  const { t } = useI18n();
  const [rules, setRules] = useState<Rule[]>([]);
  useEffect(() => { api<{ items: Rule[] }>('/field/stages').then((r) => setRules(r.items)).catch(() => undefined); }, []);
  const name = (s: Stage) => rules.find((r) => r.stage === s)?.label || t(`st_${s}` as Key);
  const off = new Set(rules.filter((r) => r.enabled === false).map((r) => r.stage));
  return { rules, name, off };
}

function available(j: Job, off?: Set<Stage>): Stage[] {
  return rawAvailable(j).filter((s) => !off?.has(s));
}
function rawAvailable(j: Job): Stage[] {
  switch (j.Status) {
    case 'assigned': return ['depart'];
    case 'on_the_way': return ['arrive'];
    case 'arrived': return ['start'];
    case 'in_progress': return ['progress', 'finish'];
    case 'awaiting_review': case 'done': case 'closed': return [...(Number(j.Paid) < Number(j.Total) ? ['cash' as Stage] : []), ...(j.Events.some((e) => e.Stage === 'next') ? [] : ['next' as Stage])];
    default: return [];
  }
}


interface Summary { linked: boolean; today: number; upcoming: number; running: number; done: number; late: number; cashToday: number; cashDue: number }
type Filter = '' | 'upcoming' | 'progress' | 'done' | 'late';

/** The supervisor's home: today's numbers, then the jobs, with the next one to work on first. */
export function FieldList() {
  const { t } = useI18n();
  const nav = useNavigate();
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [sum, setSum] = useState<Summary | null>(null);
  const [filter, setFilter] = useState<Filter>('');
  const [linked, setLinked] = useState(true);
  const [err, setErr] = useState('');
  useEffect(() => { api<Summary>('/field/summary').then(setSum).catch(() => undefined); }, []);
  useEffect(() => {
    setJobs(null);
    api<{ items: Job[]; linked: boolean }>(`/field/jobs${filter ? `?f=${filter}` : ''}`).then((r) => { setJobs(r.items); setLinked(r.linked); }).catch(() => setErr('Error'));
  }, [filter]);
  const cards: { f: Filter; label: Key; n: number | undefined; tone: string }[] = [
    { f: 'upcoming', label: 'dashUpcoming', n: sum?.upcoming, tone: 'text-slate-800 dark:text-slate-100' },
    { f: 'progress', label: 'dashRunning', n: sum?.running, tone: 'text-cyan-700' },
    { f: 'done', label: 'dashDone', n: sum?.done, tone: 'text-green-700' },
    { f: 'late', label: 'dashLate', n: sum?.late, tone: 'text-red-600' },
  ];
  return (
    <div className="mx-auto max-w-xl space-y-3">
      <h1 className="text-xl font-bold">{t('myJobs')}</h1>
      {err && <ErrorBox message={err} />}
      {!linked && <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">{t('notSupervisor')}</p>}
      <div className="grid grid-cols-4 gap-2">
        {cards.map((c) => (
          <button key={c.f} type="button" onClick={() => setFilter(filter === c.f ? '' : c.f)} aria-pressed={filter === c.f}
            className={`rounded-2xl bg-white p-3 text-center shadow-sm ring-1 dark:bg-slate-900 ${filter === c.f ? 'ring-2 ring-cyan-600' : 'ring-slate-200 dark:ring-slate-800'}`}>
            <div className={`text-2xl font-bold tabular-nums ${c.tone}`}>{c.n ?? '–'}</div>
            <div className="text-xs text-slate-500">{t(c.label)}</div>
          </button>
        ))}
      </div>
      {sum && (sum.cashToday > 0 || sum.cashDue > 0) && (
        <div className="flex justify-between rounded-2xl bg-white px-4 py-3 text-sm shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          <span>💵 {t('cashToday')}: <b>{money(sum.cashToday)}</b></span>
          <span>{t('cashDue')}: <b className={sum.cashDue > 0 ? 'text-amber-600' : ''}>{money(sum.cashDue)}</b></span>
        </div>
      )}
      {filter && <button type="button" onClick={() => setFilter('')} className="text-sm text-cyan-700 underline">{t('showAllJobs')}</button>}
      {!jobs ? <Skeleton rows={3} /> : jobs.length === 0 ? <p className="py-10 text-center text-slate-500">{t('noJobs')}</p> : jobs.map((j, i) => {
        const next = available(j, off)[0];
        return (
          <button key={j.Id} type="button" onClick={() => nav(`/app/field/${j.Id}`)} className={`block w-full rounded-2xl bg-white p-4 text-start shadow-sm ring-1 dark:bg-slate-900 ${i === 0 && !filter ? 'ring-2 ring-cyan-600' : 'ring-slate-200 dark:ring-slate-800'}`}>
            {i === 0 && !filter && <div className="mb-1 text-xs font-semibold text-cyan-700">{t('yourTurn')}</div>}
            <div className="flex items-center justify-between"><b>{j.CustomerName}</b><span className="text-sm text-slate-500" dir="ltr">{new Date(j.StartAt).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span></div>
            <div className="mt-1 text-sm text-slate-500">{[j.City, j.District].filter(Boolean).join(' / ')}</div>
            <div className="mt-1 text-sm">{j.Lines.map((l) => `${l.Name} × ${l.Quantity}`).join('، ')}</div>
            {next && <div className="mt-2 inline-block rounded-full bg-cyan-700 px-3 py-1 text-sm text-white">{ICON[next]} {name(next)}</div>}
          </button>
        );
      })}
    </div>
  );
}

export function FieldJob() {
  const { id } = useParams();
  const { t } = useI18n();
  const nav = useNavigate();
  const [job, setJob] = useState<Job | null>(null);
  const { rules, name, off } = useRules();
  const [stage, setStage] = useState<Stage | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => { api<Job>(`/field/jobs/${id}`).then(setJob).catch(() => setErr('Error')); }, [id]);
  useEffect(() => { load(); }, [load]);
  /** After "heading to the next job": open the next one in the queue, or go back to the list when nothing is left. */
  const goNext = async () => {
    try {
      const r = await api<{ items: Job[] }>('/field/jobs');
      const nxt = r.items.find((j) => j.Id !== Number(id) && available(j, off).length > 0);
      nav(nxt ? `/app/field/${nxt.Id}` : '/app/field', { replace: true });
    } catch { nav('/app/field', { replace: true }); }
  };
  if (!job) return <div className="mx-auto max-w-xl">{err ? <ErrorBox message={err} /> : <Skeleton rows={4} />}</div>;
  const can = available(job, off);
  const done = new Set(job.Events.map((e) => e.Stage));
  const due = Number(job.Total) - Number(job.Paid);
  const map = job.MapUrl || (job.Latitude != null ? `https://www.google.com/maps?q=${job.Latitude},${job.Longitude}` : '');
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <button type="button" onClick={() => nav('/app/field')} className="text-sm text-slate-500">← {t('myJobs')}</button>
      <section className="space-y-1 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
        <div className="flex items-center justify-between"><b className="text-lg">{job.CustomerName}</b><a href={`tel:${job.CustomerMobile}`} dir="ltr" className="rounded-full bg-green-600 px-3 py-1 text-sm text-white">📞 {job.CustomerMobile}</a></div>
        <div className="text-sm">{[job.City, job.District, job.Street].filter(Boolean).join(' - ')}</div>
        {map && <a href={map} target="_blank" rel="noreferrer" className="inline-block text-cyan-700 underline">📍 {t('openMap')}</a>}
        <div className="text-sm">{job.Lines.map((l) => `${l.Name} × ${l.Quantity}`).join('، ')}</div>
        {job.Team.length > 0 && <div className="text-sm text-slate-500">{t('team')}: {job.Team.join('، ')}</div>}
        {job.Notes && <div className="rounded-lg bg-slate-50 p-2 text-sm dark:bg-slate-800">{job.Notes}</div>}
        <div className="text-sm">{t('total')}: <b>{money(job.Total)}</b> · {t('stillDue')}: <b>{money(due)}</b></div>
      </section>
      {err && <ErrorBox message={err} />}
      <ol className="space-y-2">
        {ORDER.filter((s) => !off.has(s) && (s !== 'cash' || can.includes('cash') || done.has('cash'))).map((s) => {
          const evs = job.Events.filter((e) => e.Stage === s);
          const ok = can.includes(s);
          return (
            <li key={s} className={`rounded-2xl p-3 ring-1 ${ok ? 'bg-cyan-50 ring-cyan-600 dark:bg-slate-900' : 'bg-white ring-slate-200 dark:bg-slate-900 dark:ring-slate-800'}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-lg">{done.has(s) ? '✔️' : ICON[s]} <span className="font-semibold">{name(s)}</span></div>
                {ok && <Button className="!px-5 !py-3 text-base" onClick={() => setStage(s)}>{t('doIt')}</Button>}
              </div>
              {evs.map((e) => <div key={e.Id} className="mt-1 text-sm text-slate-600 dark:text-slate-300">{time(e.CreatedAt)}{e.Amount != null ? ` · ${money(e.Amount)}${e.Method === 'transfer' ? ` (${t('payTransfer')})` : ''}` : ''}{e.Note ? ` · ${e.Note}` : ''}{e.Files ? ` · 📎${e.Files}` : ''}</div>)}
            </li>
          );
        })}
      </ol>
      {stage && <StageSheet job={job} stage={stage} rule={rules.find((r) => r.stage === stage)} due={due} onClose={() => setStage(null)} onDone={() => { const was = stage; setStage(null); if (was === 'next') void goNext(); else load(); }} />}
    </div>
  );
}

function StageSheet({ job, stage, rule, due, onClose, onDone }: { job: Job; stage: Stage; rule?: Rule; due: number; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [note, setNote] = useState('');
  const pays = stage === 'cash' || (stage === 'finish' && due > 0);
  const [amount, setAmount] = useState(pays ? String(due) : '');
  const [method, setMethod] = useState<'cash' | 'transfer'>('cash');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const add = async (list: FileList | null, video: boolean) => {
    if (!list) return;
    const out: File[] = [];
    for (const f of Array.from(list)) {
      if (video && f.size > 15 * 1024 * 1024) { setErr(t('videoTooBig')); continue; }
      out.push(video ? f : await shrink(f));
    }
    setFiles((x) => [...x, ...out]);
  };
  const photos = files.filter((f) => f.type.startsWith('image/')).length;
  const videos = files.filter((f) => f.type.startsWith('video/')).length;
  const submit = async () => {
    setErr('');
    if (pays && !(Number(amount) > 0)) { setErr(t('needAmount')); return; }
    if (rule?.noteReq && !note.trim()) { setErr(t('needNote')); return; }
    if (rule?.photoReq && photos === 0) { setErr(t('needPhoto')); return; }
    if (rule?.videoReq && videos === 0) { setErr(t('needVideo')); return; }
    setBusy(true);
    try {
      let lat: number | undefined; let lng: number | undefined;
      if ((stage === 'arrive' || stage === 'depart') && navigator.geolocation) {
        await new Promise<void>((ok) => navigator.geolocation.getCurrentPosition((p) => { lat = p.coords.latitude; lng = p.coords.longitude; ok(); }, () => ok(), { timeout: 5000 }));
      }
      await api(`/field/jobs/${job.Id}/events`, { method: 'POST', body: { stage, note: note.trim() || undefined, amount: pays ? Number(amount) : undefined, method: pays ? method : undefined, lat, lng, files: await Promise.all(files.map(async (f) => ({ fileName: f.name, dataBase64: await fileToBase64(f) }))) } });
      onDone();
    } catch (e) { setErr(e instanceof ApiError ? (({ INVALID_STATE: t('badState'), OVER_PAYMENT: t('overPay'), FILE_TOO_LARGE: t('videoTooBig') } as Record<string, string>)[e.code] ?? e.message) : 'Error'); } finally { setBusy(false); }
  };
  const star = (r?: boolean) => (r ? <span className="text-red-600"> *</span> : null);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" role="dialog" aria-modal="true">
      <div className="max-h-[92vh] w-full max-w-xl space-y-3 overflow-y-auto rounded-t-3xl bg-white p-5 dark:bg-slate-900 sm:rounded-3xl">
        <div className="flex items-center justify-between"><h2 className="text-lg font-bold">{ICON[stage]} {rule?.label || t(`st_${stage}` as Key)}</h2><button type="button" onClick={onClose} className="text-2xl" aria-label={t('cancel')}>×</button></div>
        {err && <ErrorBox message={err} />}
        {pays && <div className="flex gap-2">{(['cash', 'transfer'] as const).map((m) => <button key={m} type="button" aria-pressed={method === m} onClick={() => setMethod(m)} className={`flex-1 rounded-xl border-2 px-3 py-2 ${method === m ? 'border-cyan-700 bg-cyan-50 font-semibold dark:bg-slate-800' : 'border-slate-300 dark:border-slate-600'}`}>{m === 'cash' ? `💵 ${t('payCashLbl')}` : `🏦 ${t('payTransfer')}`}</button>)}</div>}
        {pays && <label className="block text-sm">{t('amountReceived')}<input type="number" inputMode="decimal" min={0} step="0.01" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3 text-lg dark:border-slate-600 dark:bg-slate-800" /></label>}
        <label className="block text-sm">{t('noteLbl')}{star(rule?.noteReq)}<textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-800" /></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="cursor-pointer rounded-xl border-2 border-dashed border-slate-300 p-3 text-center dark:border-slate-600">📷 {stage === 'finish' ? t('proofPhoto') : t('addPhoto')}{star(rule?.photoReq)} ({photos})<input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { void add(e.target.files, false); e.target.value = ''; }} /></label>
          <label className="cursor-pointer rounded-xl border-2 border-dashed border-slate-300 p-3 text-center dark:border-slate-600">🎥 {t('addVideo')}{star(rule?.videoReq)} ({videos})<input type="file" accept="video/*" className="sr-only" onChange={(e) => { void add(e.target.files, true); e.target.value = ''; }} /></label>
        </div>
        {files.length > 0 && <ul className="flex flex-wrap gap-2 text-xs">{files.map((f, i) => <li key={i} className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 dark:bg-slate-800">{f.type.startsWith('video/') ? '🎥' : '📷'} {Math.round(f.size / 1024)} KB <button type="button" onClick={() => setFiles(files.filter((_, k) => k !== i))} aria-label="x">✕</button></li>)}</ul>}
        <Button className="w-full !py-3 text-base" disabled={busy} onClick={() => void submit()}>{busy ? t('loading') : t('confirmStage')}</Button>
      </div>
    </div>
  );
}

/** The office sees the same log on the booking screen. */
export function StageLog({ bookingId, events, labels = {} }: { bookingId: number; labels?: Record<string, string>; events: { Id: number; Stage: Stage; Note: string | null; Amount: number | null; Method?: string | null; CreatedAt: string; ByName: string | null; Files: { Id: number; Kind: string; FileName: string }[] }[] }) {
  const { t } = useI18n();
  if (events.length === 0) return null;
  return (
    <div className="space-y-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
      <div className="font-semibold">{t('fieldLog')}</div>
      <ol className="space-y-2">
        {events.map((e) => (
          <li key={e.Id} className="text-sm">
            <div>{ICON[e.Stage]} <b>{labels[e.Stage] || t(`st_${e.Stage}` as Key)}</b> · <span className="text-slate-500">{time(e.CreatedAt)}{e.ByName ? ` · ${e.ByName}` : ''}{e.Amount != null ? ` · ${money(e.Amount)}${e.Method === 'transfer' ? ` (${t('payTransfer')})` : ''}` : ''}</span></div>
            {e.Note && <div className="text-slate-600 dark:text-slate-300">{e.Note}</div>}
            {e.Files.length > 0 && <div className="mt-1 flex flex-wrap gap-2">{e.Files.map((f) => f.Kind === 'photo'
              ? <AuthImg key={f.Id} path={`/bookings/${bookingId}/stage-files/${f.Id}`} />
              : <button key={f.Id} type="button" onClick={() => void openFile(`/bookings/${bookingId}/stage-files/${f.Id}`)} className="rounded-lg bg-slate-100 px-3 py-4 text-sm dark:bg-slate-800">🎥 {t('viewVideo')}</button>)}</div>}
          </li>))}
      </ol>
    </div>
  );
}
