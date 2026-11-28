import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useI18n } from '../i18n';
import { Button, ErrorBox, money, Skeleton } from '../ui';

interface Stats {
  days: number; requests: number; confirmed: number; cancelled: number; waitingOver24h: number; value: number; approvedCompanies: number; ratingAvg: number | null; ratingsCount: number; complaints: number;
  topServices: { service: string; category: string; requests: number; units: number; value: number }[];
  categories: { category: string; requests: number }[]; cities: { city: string; requests: number }[];
}
interface Resp { stats: Stats; configured: boolean; last: { at: string; days: number; provider: string; model: string; text: string } | null }

/** Minimal rendering of the model's answer: headings, bullets and bold; everything else is plain text (never HTML). */
function Narrative({ text }: { text: string }) {
  const bold = (s: string) => s.split(/\*\*(.+?)\*\*/g).map((p, i) => (i % 2 ? <b key={i}>{p}</b> : p));
  return (
    <div className="space-y-2 text-sm leading-7">
      {text.split('\n').map((l, i) => {
        const line = l.trim(); if (!line) return null;
        if (/^#{1,4}\s/.test(line)) return <h3 key={i} className="pt-2 text-base font-bold">{bold(line.replace(/^#+\s*/, ''))}</h3>;
        if (/^[-•*]\s/.test(line)) return <p key={i} className="ps-4">• {bold(line.replace(/^[-•*]\s*/, ''))}</p>;
        return <p key={i}>{bold(line)}</p>;
      })}
    </div>
  );
}

function Bars({ rows, label, value }: { rows: Record<string, any>[]; label: string; value: string }) {
  const max = Math.max(1, ...rows.map((r) => Number(r[value])));
  if (rows.length === 0) return <p className="text-sm text-slate-400">—</p>;
  return (
    <ul className="space-y-2">
      {rows.map((r, i) => (
        <li key={i} className="text-sm">
          <div className="flex justify-between gap-2"><span className="truncate">{String(r[label])}</span><b>{Number(r[value])}</b></div>
          <div className="mt-1 h-2 rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-2 rounded-full bg-cyan-700" style={{ width: `${(Number(r[value]) / max) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

export default function AiReport() {
  const { t, lang } = useI18n();
  const [days, setDays] = useState(30);
  const [d, setD] = useState<Resp | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<Resp>(`/platform/ai-report?days=${days}`).then((r) => { setD(r); setErr(''); }).catch(() => setErr('Error')); }, [days]);
  useEffect(load, [load]);
  const generate = async () => {
    setBusy(true); setErr('');
    try { setD(await api<Resp>('/platform/ai-report', { method: 'POST', body: { days } })); }
    catch (e) { setErr(e instanceof ApiError ? (e.code === 'AI_NOT_CONFIGURED' ? t('aiNeedKey') : e.message) : 'Error'); } finally { setBusy(false); }
  };
  const box = 'rounded-2xl bg-white p-4 shadow dark:bg-slate-900';
  const s = d?.stats;
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">{t('aiReportTitle')}</h1>
        <div role="group" className="inline-flex overflow-hidden rounded-lg border border-slate-300 text-sm dark:border-slate-600">
          {[7, 30, 90].map((n) => <button key={n} type="button" aria-pressed={days === n} onClick={() => setDays(n)} className={`px-3 py-1.5 ${days === n ? 'bg-cyan-700 text-white' : 'bg-white dark:bg-slate-900'}`}>{n} {t('daysUnit')}</button>)}
        </div>
      </div>
      {err && <ErrorBox message={err} />}
      {!d || !s ? <Skeleton rows={4} /> : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {([['requests', s.requests], ['aiConfirmed', s.confirmed], ['aiCancelled', s.cancelled], ['aiWaiting', s.waitingOver24h]] as const).map(([k, v]) => <div key={k} className={box}><div className="text-xs text-slate-500">{t(k === 'requests' ? 'requestsLbl' : k)}</div><div className="text-2xl font-bold">{v}</div></div>)}
            <div className={box}><div className="text-xs text-slate-500">{t('valueLbl')}</div><div className="text-lg font-bold">{money(s.value, lang)}</div></div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <section className={box}><h2 className="mb-3 font-semibold">{t('topServices')}</h2>
              {s.topServices.length === 0 ? <p className="text-sm text-slate-400">{t('noData')}</p> : <Bars rows={s.topServices} label="service" value="requests" />}</section>
            <section className="space-y-4">
              <div className={box}><h2 className="mb-3 font-semibold">{t('topCategories')}</h2><Bars rows={s.categories} label="category" value="requests" /></div>
              <div className={box}><h2 className="mb-3 font-semibold">{t('topCities')}</h2><Bars rows={s.cities} label="city" value="requests" /></div>
            </section>
          </div>
          <section className={`${box} space-y-3`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">{t('aiNarrative')}</h2>
              <Button disabled={busy || !d.configured} onClick={() => void generate()}>{busy ? t('loading') : t('aiGenerate')}</Button>
            </div>
            {!d.configured && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">{t('aiNeedKey')} <Link to="/app/settings" className="font-semibold underline">{t('settings')}</Link></p>}
            {d.last ? (
              <>
                <p className="text-xs text-slate-500">{new Date(d.last.at).toLocaleString(lang === 'ar' ? 'ar-SA' : 'en-GB', { timeZone: 'Asia/Riyadh' })} · {d.last.provider} · {d.last.model} · {d.last.days} {t('daysUnit')}</p>
                <Narrative text={d.last.text} />
                <p className="text-xs text-slate-400">{t('aiDisclaimer')}</p>
              </>
            ) : d.configured && <p className="text-sm text-slate-500">{t('aiNoReport')}</p>}
          </section>
        </>
      )}
    </div>
  );
}
