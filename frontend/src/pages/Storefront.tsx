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
  services: { Id: number; Name: string; DefaultMinutes: number; FromPrice: number | null }[];
}

function RequestForm({ store, color }: { store: Store; color: string }) {
  const { t } = useI18n();
  const [f, setF] = useState({ serviceId: '', customerName: '', phone: '', address: '', date: '', period: 'morning', notes: '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
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
    <form onSubmit={submit} className="mt-8 space-y-3 rounded-2xl bg-white p-5 shadow ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
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
            <div className="grid gap-3 sm:grid-cols-2">
              {s.services.map((x) => (
                <div key={x.Id} className="flex items-center justify-between gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
                  <div className="min-w-0"><div className="font-semibold">{x.Name}</div><div className="mt-0.5 text-xs text-slate-500">{x.DefaultMinutes} {t('minutes')}</div></div>
                  {x.FromPrice != null && <div className="shrink-0 text-end"><div className="text-xs text-slate-500">{t('servicesFrom')}</div><div className="text-lg font-bold" style={{ color }}>{money(x.FromPrice, lang)}</div></div>}
                </div>
              ))}
            </div>
            {s.services.length > 0 && <RequestForm store={s} color={color} />}
          </main>
        </>
      )}
    </PublicShell>
  );
}
