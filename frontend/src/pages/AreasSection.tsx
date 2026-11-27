import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { useI18n } from '../i18n';
import { Button, ErrorBox } from '../ui';
import type { ServiceArea } from '../AreaSelect';

/** The company chooses the cities (and districts) it serves; customers can only order inside them. */
export default function AreasSection({ canEdit, onSaved }: { canEdit: boolean; onSaved: () => void }) {
  const { t } = useI18n();
  const [areas, setAreas] = useState<ServiceArea[] | null>(null);
  const [cat, setCat] = useState<{ cities: string[]; districts: Record<string, string[]> } | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    api<{ areas: ServiceArea[] }>('/company/areas').then((r) => setAreas(r.areas)).catch(() => setErr('Error'));
    api<{ cities: string[]; districts: Record<string, string[]> }>('/market/areas-catalog').then(setCat).catch(() => undefined);
  }, []);
  if (!areas) return null;
  const has = (c: string) => areas.some((a) => a.city === c);
  const toggle = (c: string) => setAreas(has(c) ? areas.filter((a) => a.city !== c) : [...areas, { city: c, districts: [] }]);
  const addD = (c: string, d: string) => { const v = d.trim(); if (v.length < 2) return; setAreas(areas.map((a) => (a.city === c && !a.districts.includes(v) ? { ...a, districts: [...a.districts, v] } : a))); setDraft({ ...draft, [c]: '' }); };
  const rmD = (c: string, d: string) => setAreas(areas.map((a) => (a.city === c ? { ...a, districts: a.districts.filter((x) => x !== d) } : a)));
  const save = async () => {
    setErr(''); setMsg('');
    try { const r = await api<{ areas: ServiceArea[] }>('/company/areas', { method: 'PUT', body: { areas } }); setAreas(r.areas); setMsg(t('saved')); onSaved(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Error'); }
  };
  return (
    <section className="space-y-3 rounded-2xl bg-white p-4 shadow dark:bg-slate-900">
      <div><h2 className="font-semibold">{t('serviceAreas')}</h2><p className="text-xs text-slate-500">{t('serviceAreasHint')}</p></div>
      {err && <ErrorBox message={err} />}
      <div className="flex flex-wrap gap-2">
        {(cat?.cities ?? []).map((c) => (
          <button key={c} type="button" disabled={!canEdit} onClick={() => toggle(c)} aria-pressed={has(c)}
            className={`rounded-full px-3 py-1.5 text-sm ring-1 ${has(c) ? 'bg-cyan-700 text-white ring-cyan-700' : 'bg-white text-slate-700 ring-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-600'}`}>{c}</button>
        ))}
      </div>
      {areas.map((a) => (
        <div key={a.city} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
          <div className="mb-2 flex items-center justify-between"><b>{a.city}</b><span className="text-xs text-slate-500">{a.districts.length === 0 ? t('wholeCity') : `${a.districts.length} ${t('districtsCount')}`}</span></div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {a.districts.map((d) => <span key={d} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs dark:bg-slate-800">{d}{canEdit && <button type="button" onClick={() => rmD(a.city, d)} aria-label={t('remove')}>×</button>}</span>)}
          </div>
          {canEdit && (
            <div className="flex gap-2">
              <input list={`dl-${a.city}`} value={draft[a.city] ?? ''} onChange={(e) => setDraft({ ...draft, [a.city]: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addD(a.city, draft[a.city] ?? ''); } }} placeholder={t('addDistrict')} className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800" />
              <datalist id={`dl-${a.city}`}>{(cat?.districts[a.city] ?? []).filter((d) => !a.districts.includes(d)).map((d) => <option key={d} value={d} />)}</datalist>
              <Button type="button" variant="ghost" onClick={() => addD(a.city, draft[a.city] ?? '')}>{t('add')}</Button>
            </div>
          )}
        </div>
      ))}
      {canEdit && <div className="flex items-center gap-3"><Button type="button" onClick={save}>{t('save')}</Button>{msg && <span className="text-sm text-emerald-700">{msg}</span>}</div>}
    </section>
  );
}
