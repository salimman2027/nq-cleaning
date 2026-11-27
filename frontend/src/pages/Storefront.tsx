import { useEffect, useState, type FormEvent, type PointerEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useI18n, type Key } from '../i18n';
import { SectorIcon } from '../sectorIcons';
import { ErrorBox, Modal, money, Skeleton } from '../ui';
import { useShop } from '../shop';
import ComplaintForm from './ComplaintForm';
import { PublicShell } from './Home';

interface Store {
  slug: string; name: string; description: string | null; logoUrl: string | null; coverUrl?: string | null; whatsapp?: string | null; categories?: { Name: string; ImageUrl: string }[]; primaryColor: string | null;
  sectors: { Code: string; NameAr: string; NameEn: string }[];
  services: { Id: number; Name: string; DefaultMinutes: number; FromPrice: number | null; ImageUrl: string | null; Category: string | null; Description: string | null; Includes: string | null; Notes: string | null }[];
}

function RequestForm({ store, color, picked }: { store: Store; color: string; picked: string }) {
  const { t } = useI18n();
  const { customer } = useShop();
  const [f, setF] = useState({ serviceId: picked, customerName: customer?.name ?? '', phone: customer?.phone ?? '', address: '', date: '', period: 'morning', notes: '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  useEffect(() => { if (picked) setF((x) => ({ ...x, serviceId: picked })); }, [picked]);
  const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      await api(`/market/companies/${store.slug}/requests`, { method: 'POST', customer: !!customer, body: { serviceId: Number(f.serviceId), customerName: f.customerName, phone: f.phone, address: f.address || undefined, date: f.date, period: f.period, notes: f.notes || undefined } });
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

const glowMove = (e: PointerEvent<HTMLElement>) => {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty('--x', `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty('--y', `${e.clientY - r.top}px`);
};

export default function Storefront() {
  const { slug } = useParams();
  const { t, lang } = useI18n();
  const [s, setS] = useState<Store | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api<Store>(`/market/companies/${slug}`).then(setS).catch((e) => setError(e instanceof ApiError && e.status === 404 ? t('noCompanies') : 'Error'));
  }, [slug, t]);
  const color = s?.primaryColor ?? '#0f3f8f';
  const shop = useShop();
  const [added, setAdded] = useState(false);
  const nav = useNavigate();
  const [complain, setComplain] = useState(false);
  const [conflict, setConflict] = useState<Store['services'][number] | null>(null);
  const cartItem = (x: Store['services'][number]) => ({ serviceId: x.Id, name: x.Name, price: x.FromPrice ?? 0, image: x.ImageUrl });
  const afterAdd = () => {
    setDetail(null);
    if (!shop.customer) { nav('/account?mode=register&next=cart'); return; }
    setAdded(true);
  };
  const addToCart = (x: Store['services'][number]) => {
    if (x.FromPrice == null) return;
    if (shop.add(slug!, s!.name, cartItem(x)) === 'other-company') { setConflict(x); return; }
    afterAdd();
  };
  const [picked, setPicked] = useState('');
  const [detail, setDetail] = useState<Store['services'][number] | null>(null);
  const order = (id: number) => { setDetail(null); setPicked(String(id)); setTimeout(() => document.getElementById('request')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50); };
  const collage = (s?.services ?? []).map((x) => x.ImageUrl).filter((x): x is string => Boolean(x));
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
          {s.sectors.length > 0 && (
            <div className="px-4 py-1.5 text-center text-xs font-medium text-white" style={{ background: color }}>
              {t('bookOnline')} · {s.sectors.map((x) => (lang === 'ar' ? x.NameAr : x.NameEn)).join(' · ')}
            </div>
          )}
          <section className="relative overflow-hidden" style={{ background: `linear-gradient(160deg, ${color}14, transparent 60%)` }}>
            <div className="mx-auto grid max-w-5xl items-center gap-8 px-4 py-10 md:grid-cols-2 md:py-14">
              <div className="rise">
                <Link to="/" className="text-sm text-slate-500 hover:text-slate-800">← {t('back')}</Link>
                <div className="mt-5 flex items-center gap-4">
                  <span className="logo-pop flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-3xl bg-white text-4xl font-bold shadow-lg ring-1 ring-slate-200 sm:h-28 sm:w-28" style={{ color }}>
                    {s.logoUrl ? <img src={s.logoUrl} alt="" className="h-full w-full object-contain p-1.5" /> : s.name.slice(0, 1)}
                  </span>
                  <span className="text-2xl font-bold leading-tight sm:text-3xl">{s.name}</span>
                </div>
                <h1 className="mt-4 text-3xl font-bold leading-[1.3] sm:text-5xl sm:leading-[1.25]">{t('storeHeadline1')}<br /><span style={{ color }}>{t('storeHeadline2')}</span></h1>
                {s.description && <p className="mt-4 max-w-md text-slate-600 dark:text-slate-300">{s.description}</p>}
                <div className="mt-5 flex flex-wrap gap-2">
                  {s.sectors.map((x) => <span key={x.Code} className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-sm shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700" style={{ color }}><SectorIcon code={x.Code} className="h-4 w-4" />{lang === 'ar' ? x.NameAr : x.NameEn}</span>)}
                </div>
                <div className="mt-6 flex flex-wrap gap-3">
                  <button onClick={() => document.getElementById('request')?.scrollIntoView({ behavior: 'smooth', block: 'center' })} className="tile rounded-full px-6 py-3 font-semibold text-white shadow-lg" style={{ background: color }}>{t('bookNow')}</button>
                  <button onClick={() => document.getElementById('cat-0')?.scrollIntoView({ behavior: 'smooth' })} className="tile rounded-full bg-white px-6 py-3 font-semibold shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">{t('exploreSections')}</button>
                </div>
              </div>
              <div className="relative mx-auto grid h-72 w-full max-w-sm grid-cols-2 gap-3 sm:h-96" aria-hidden>
                {[0, 1, 2].map((i) => {
                  const img = i === 0 ? (s.coverUrl ?? collage[0]) : collage[i];
                  return (
                    <div key={i} className={`lattice overflow-hidden shadow-lg ${i === 0 ? 'row-span-2 rounded-[2rem] rounded-es-[5rem]' : 'rounded-3xl'}`}
                      style={{ background: img ? `url("${img}") center/cover` : `linear-gradient(${135 + i * 40}deg, ${color}, ${color}88)` }}>
                      {!img && <div className="flex h-full items-center justify-center text-white/40"><SectorIcon code={s.sectors[i % Math.max(1, s.sectors.length)]?.Code ?? 'cleaning'} className="h-14 w-14" /></div>}
                    </div>
                  );
                })}
                <div className="star-float absolute -start-3 top-1/2 flex -translate-y-1/2 items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-xl dark:bg-slate-900">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl text-white" style={{ background: color }}><SectorIcon code={s.sectors[0]?.Code ?? 'cleaning'} className="h-5 w-5" /></span>
                  <span><b className="block text-xl leading-none">+{s.services.length}</b><span className="text-xs text-slate-500">{t('servicesAvailable')}</span></span>
                </div>
              </div>
            </div>
          </section>
          <main className="mx-auto max-w-5xl px-4 py-8">
            {groups.length > 1 && (
              <section className="mb-10">
                <h2 className="mb-1 text-2xl font-bold">{t('oneBrandTitle')}</h2>
                <p className="mb-4 text-sm text-slate-500">{t('oneBrandSub')}</p>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                  {groups.map(([cat, list], i) => {
                    const img = s.categories?.find((c) => c.Name === cat)?.ImageUrl ?? list.find((x) => x.ImageUrl)?.ImageUrl;
                    const from = Math.min(...list.map((x) => x.FromPrice ?? Infinity));
                    return (
                      <button key={cat} onClick={() => document.getElementById(`cat-${i}`)?.scrollIntoView({ behavior: 'smooth' })} onPointerMove={glowMove}
                        className="card-lift glow lattice relative flex h-40 flex-col justify-end overflow-hidden rounded-3xl p-4 text-start text-white shadow-md sm:h-48"
                        style={{ background: img ? `linear-gradient(to top, rgba(6,23,58,.92) 0%, rgba(6,23,58,.6) 42%, rgba(6,23,58,0) 78%), url("${img}") center/cover` : `linear-gradient(145deg, ${color}, ${color}aa)` }}>
                        {Number.isFinite(from) && <span className="absolute end-3 top-3 rounded-full bg-white px-2.5 py-0.5 text-xs font-bold" style={{ color }}>{t('fromShort')} {money(from, lang)}</span>}
                        <span className="text-lg font-bold [text-shadow:0_1px_6px_rgba(0,0,0,.7)]">{cat}</span>
                        <span className="text-xs text-white/90 [text-shadow:0_1px_4px_rgba(0,0,0,.7)]">{list.length} {t('servicesCount')}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}
            {groups.map(([cat, list], gi) => (
              <section key={cat} id={`cat-${gi}`} className="mb-8 scroll-mt-4">
                <h2 className="mb-3 flex items-center gap-2 text-lg font-bold"><span className="h-6 w-1.5 rounded-full" style={{ background: color }} />{cat}</h2>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {list.map((x) => (
                    <article key={x.Id} className="card-lift overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
                      <div className="lattice relative flex h-28 items-end justify-end p-2.5 text-white sm:h-36" style={{ background: x.ImageUrl ? `url("${x.ImageUrl}") center/cover` : `linear-gradient(135deg, ${color}, ${color}99)` }}>
                        {!x.ImageUrl && <SectorIcon code={s.sectors[0]?.Code ?? 'cleaning'} className="absolute start-3 top-3 h-9 w-9 opacity-40" />}
                      </div>
                      <div className="p-3">
                        <h3 className="line-clamp-2 min-h-10 text-sm font-bold leading-snug">{x.Name}</h3>
                        <div className="text-xs text-slate-500">{x.DefaultMinutes} {t('minutes')}</div>
                        <div className="mt-1 h-6 font-bold" style={{ color }}>{x.FromPrice != null && <><span className="me-1 text-xs font-normal text-slate-500">{t('servicesFrom')}</span>{money(x.FromPrice, lang)}</>}</div>
                        <div className="mt-2 flex gap-2">
                          <button onClick={() => setDetail(x)} className="tile flex-1 rounded-full border px-2 py-2 text-sm font-medium" style={{ color, borderColor: color }}>{t('details')}</button>
                          <button onClick={() => addToCart(x)} disabled={x.FromPrice == null} className="tile flex-1 rounded-full px-2 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: color }}>{t('addToCart')}</button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))}
            {detail && (
              <Modal title={detail.Name} onClose={() => setDetail(null)}>
                {detail.ImageUrl && <img src={detail.ImageUrl} alt="" className="mb-3 h-48 w-full rounded-xl object-cover" />}
                <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                  <span className="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-800">{detail.DefaultMinutes} {t('minutes')}</span>
                  {detail.FromPrice != null && <span className="font-bold" style={{ color }}>{t('servicesFrom')} {money(detail.FromPrice, lang)}</span>}
                </div>
                {detail.Description && <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">{detail.Description}</p>}
                {detail.Includes && <><h3 className="mb-1 text-sm font-semibold">{t('includesTitle')}</h3><ul className="mb-3 list-disc space-y-1 ps-5 text-sm">{detail.Includes.split('\n').map((i) => <li key={i}>{i}</li>)}</ul></>}
                {detail.Notes && <><h3 className="mb-1 text-sm font-semibold">{t('notesTitle')}</h3><p className="mb-3 rounded-lg bg-amber-50 p-2.5 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">{detail.Notes}</p></>}
                <button onClick={() => addToCart(detail)} disabled={detail.FromPrice == null} className="tile w-full rounded-xl px-4 py-3 font-semibold text-white disabled:opacity-50" style={{ background: color }}>{t('addToCart')}</button>
                <button onClick={() => order(detail.Id)} className="mt-2 w-full rounded-xl border px-4 py-2.5 text-sm font-medium dark:border-slate-700">{t('orderNow')}</button>
              </Modal>
            )}
            <section className="mb-8 grid gap-3 sm:grid-cols-3">
              {([['1', 'step1'], ['2', 'step2'], ['3', 'step3']] as const).map(([n, k]) => (
                <div key={n} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold text-white" style={{ background: color }}>{n}</span>
                  <div className="mt-2 font-semibold">{t(k)}</div>
                  <p className="text-sm text-slate-500">{t(`${k}d` as Key)}</p>
                </div>
              ))}
            </section>
            {s.services.length > 0 && <RequestForm store={s} color={color} picked={picked} />}
          </main>
          {added && (
            <Modal title={t('addedToCart')} onClose={() => setAdded(false)}>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button className="flex-1 rounded-xl border px-4 py-3 font-medium dark:border-slate-700" onClick={() => setAdded(false)}>{t('continueShopping')}</button>
                <button className="tile flex-1 rounded-xl px-4 py-3 font-semibold text-white" style={{ background: color }} onClick={() => nav('/cart')}>{t('goToCart')}</button>
              </div>
            </Modal>
          )}
          {conflict && (
            <Modal title={t('otherCompanyTitle')} onClose={() => setConflict(null)}>
              <p className="text-sm">{t('otherCompanyText')}</p>
              <div className="mt-4 flex gap-2"><button className="rounded-lg bg-cyan-700 px-4 py-2 text-sm font-medium text-white" onClick={() => { shop.replaceWith(slug!, s.name, cartItem(conflict)); setConflict(null); afterAdd(); }}>{t('replaceCart')}</button><button className="rounded-lg border px-4 py-2 text-sm" onClick={() => setConflict(null)}>{t('cancel')}</button></div>
            </Modal>
          )}
          <div className="px-4 pb-28 pt-4 text-center"><button onClick={() => setComplain(true)} className="text-sm text-slate-500 underline hover:text-slate-700 dark:hover:text-slate-300">{t('complain')}</button></div>
          {complain && <ComplaintForm slug={slug!} onClose={() => setComplain(false)} />}
          {s.whatsapp && (
            <a href={`https://wa.me/${s.whatsapp}?text=${encodeURIComponent(`${t('waHello')} ${s.name}`)}`} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp"
              className="tile fixed bottom-5 start-5 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-[#25d366] text-white shadow-xl">
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 12a8 8 0 0 1-11.8 7L4 20l1.1-4.1A8 8 0 1 1 20 12z" /><path d="M9 9.5c0 3 2.500 5.500 5.500 5.500l1-1.500-1.800-.9-.8.800a4 4 0 0 1-1.800-1.800l.8-.8L10.200 8.500z" /></svg>
            </a>
          )}
        </>
      )}
    </PublicShell>
  );
}
