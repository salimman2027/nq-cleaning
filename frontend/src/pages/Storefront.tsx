import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useI18n } from '../i18n';
import { SectorIcon } from '../sectorIcons';
import { ErrorBox, money, Skeleton } from '../ui';
import { PublicShell } from './Home';

interface Store {
  slug: string; name: string; description: string | null; logoUrl: string | null; primaryColor: string | null;
  sectors: { Code: string; NameAr: string; NameEn: string }[];
  services: { Id: number; Name: string; DefaultMinutes: number; FromPrice: number | null }[];
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
          <section className="lattice text-white" style={{ background: color }}>
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
            <p className="mt-8 rounded-xl bg-amber-50 p-3 text-center text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">{t('bookSoon')}</p>
          </main>
        </>
      )}
    </PublicShell>
  );
}
