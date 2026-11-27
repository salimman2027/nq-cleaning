import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useI18n, type Key } from '../i18n';
import { SectorIcon } from '../sectorIcons';
import { ErrorBox, money, Skeleton } from '../ui';
import { PublicShell } from './Home';

interface Store {
  slug: string; name: string; description: string | null; logoUrl: string | null; coverUrl?: string | null; primaryColor: string | null;
  sectors: { Code: string; NameAr: string; NameEn: string }[];
  services: { Id: number; Name: string; DefaultMinutes: number; FromPrice: number | null; ImageUrl: string | null; Category: string | null }[];
}

function RequestForm({ store, color, picked }: { store: Store; color: string; picked: string }) {
  const { t } = useI18n();
  const [f, setF] = useState({ serviceId: picked, customerName: '', phone: '', address: '', date: '', period: 'morning', notes: '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  useEffect(() => { if (picked) setF((x) => ({ ...x, serviceId: picked })); }, [picked]);
  const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      await api(`/market/companies/${store.slug}/requests`, { method: 'POST', body: { serviceId: Number(f.serviceId), customerName: f.customerName, phone: f.phone, address: f.address || undefined, date: f.date, period: f.period, notes: f.notes || undefined } });
      setDone(true);
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Error'); } finally { setBusy(false); }
  };
  if (done) return <div className="rise mt-8 rounded-2xl p-6 text-center text-lg font-semibold text-white" style={{ background: color }}>{t('reqDone')}</div>;
  const cls = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base dark:border-slate-600 dark:bg-slate-800';
  return (
    <form id="request" onSubmit={submit} className="mt-8 space-y-3 rounded-2xl bg-white p-5 shadow ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <div><h2 className="text-lg font-bold">{t('reqTitle')}</h2><p className="text-sm text-slate-500">{t('reqSub')}</p></div>
      {error && <ErrorBox message={error} />}
      <select required className={cls} value={f.serviceId} onChange={set('serviceId')}><option value="">{t('pickService')}</option>{store.services.map((x) => <option key={x.Id} value={x.Id}>{x.Name}</option>)}</select>
      <div className="grid gap-3 sm:grid-cols-2">
        <input required className={cls} placeholder={t('yourName')} value={f.customerName} onChange={set('customerName')} />
        <input required dir="ltr" inputMode="numeric" pattern="05[0-9]{8}" className={cls} placeholder={t('yourPhone')} value={f.phone} onChange={set('phone')} />
        <input required type="date" min={today} className={cls} value={f.date} onChange={set('date')} aria-label={t('prefDate')} />
        <select className={cls} value={f.period} onChange={set('period')} aria-label={t('period')}>{['morning', 'afternoon', 'evening'].map((p) => <option key={p} value={p}>{t(`p_${p}` as Key)}</option>)}</select>
      </div>
      <input className={cls} placeholder={t('addressOpt')} value={f.address} onChange={set('address')} />
      <input className={cls} placeholder={t('notesOpt')} value={f.notes} onChange={set('notes')} />
      <button disabled={busy} className="tile w-full rounded-xl px-4 py-3 font-semibold text-white disabled:opacity-60" style={{ background: color }}>{t('sendRequest')}</button>
    </form>
  );
}

export default function Storefront() {
  const { slug } = useParams();
  const { t, lang } = useI18n();
  const [s, setS] = useState<Store | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api<Store>(`/market/companies/${slug}`).then(setS).catch((e) => setError(e instanceof ApiError && e.status === 404 ? t('noCompanies') : 'Error'));
  }, [slug, t]);
  const color = s?.primaryColor ?? '#0f3f8f';
  const [picked, setPicked] = useState('');
  const groups = (() => {
    const m = new Map<string, Store['services']>();
    for (const x of s?.services ?? []) { const k = x.Category || t('otherServices'); m.set(k, [...(m.get(k) ?? []), x]); }
    return [...m.entries()];
  })();
  return (
    <PublicShell>
      {error && <div className="mx-auto max-w-5xl p-4"><ErrorBox message={error} /></div>}
      {!s && !error && <div className="mx-auto max-w-5xl p-4"><Skeleton rows={4} /></div>}
      {s && (
        <>
          <section className="lattice text-white" style={{ background: s.coverUrl ? `linear-gradient(${color}d9, ${color}f2), url("${s.coverUrl}") center/cover` : color }}>
            <div className="mx-auto max-w-5xl px-4 pb-10 pt-6">
              <Link to="/" className="text-sm text-white/75 hover:text-white">← {t('back')}</Link>
              <div className="mt-5 flex items-center gap-4">
                <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-3xl bg-white text-3xl font-bold shadow-lg" style={{ color }}>
                  {s.logoUrl ? <img src={s.logoUrl} alt="" className="h-full w-full object-cover" /> : s.name.slice(0, 1)}
                </div>
                <div className="min-w-0">
                  <h1 className="text-2xl font-bold sm:text-3xl">{s.name}</h1>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {s.sectors.map((x) => <span key={x.Code} className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-sm"><SectorIcon code={x.Code} className="h-4 w-4" />{lang === 'ar' ? x.NameAr : x.NameEn}</span>)}
                  </div>
                </div>
              </div>
              {s.description && <p className="mt-5 max-w-2xl text-white/85">{s.description}</p>}
            </div>
          </section>
          <main className="mx-auto max-w-5xl px-4 py-8">
            {groups.length > 1 && (
              <nav aria-label="categories" className="-mx-4 mb-6 flex gap-2 overflow-x-auto px-4 pb-1">
                {groups.map(([cat], i) => (
                  <a key={cat} href={`#cat-${i}`} onClick={(e) => { e.preventDefault(); document.getElementById(`cat-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
                    className="tile shrink-0 rounded-full bg-white px-4 py-2 text-sm font-medium shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700" style={{ color }}>{cat}</a>
                ))}
              </nav>
            )}
            {groups.map(([cat, list], gi) => (
              <section key={cat} id={`cat-${gi}`} className="mb-8 scroll-mt-4">
                <h2 className="mb-3 flex items-center gap-2 text-lg font-bold"><span className="h-6 w-1.5 rounded-full" style={{ background: color }} />{cat}</h2>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {list.map((x) => (
                    <article key={x.Id} className="card-lift overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
                      <div className="lattice relative flex h-28 items-end justify-end p-2.5 text-white sm:h-36" style={{ background: x.ImageUrl ? `linear-gradient(transparent 35%, ${color}e6), url("${x.ImageUrl}") center/cover` : `linear-gradient(135deg, ${color}, ${color}99)` }}>
                        {!x.ImageUrl && <SectorIcon code={s.sectors[0]?.Code ?? 'cleaning'} className="absolute start-3 top-3 h-9 w-9 opacity-40" />}
                        <span className="text-sm font-semibold leading-tight drop-shadow">{x.Name}</span>
                      </div>
                      <div className="p-3">
                        <div className="text-xs text-slate-500">{x.DefaultMinutes} {t('minutes')}</div>
                        <div className="mt-1 h-6 font-bold" style={{ color }}>{x.FromPrice != null && <><span className="me-1 text-xs font-normal text-slate-500">{t('servicesFrom')}</span>{money(x.FromPrice, lang)}</>}</div>
                        <button onClick={() => { setPicked(String(x.Id)); document.getElementById('request')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}
                          className="tile mt-2 w-full rounded-full px-3 py-2 text-sm font-semibold text-white" style={{ background: color }}>{t('orderNow')}</button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))}
            {s.services.length > 0 && <RequestForm store={s} color={color} picked={picked} />}
          </main>
        </>
      )}
    </PublicShell>
  );
}
