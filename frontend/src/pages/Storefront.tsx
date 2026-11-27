import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useI18n } from '../i18n';
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
      <Link to="/" className="text-sm text-slate-500">← {t('back')}</Link>
      {error && <div className="mt-3"><ErrorBox message={error} /></div>}
      {!s && !error && <div className="mt-4"><Skeleton rows={4} /></div>}
      {s && (
        <>
          <div className="mt-3 rounded-2xl p-6 text-white" style={{ background: color }}>
            <h1 className="text-2xl font-bold">{s.name}</h1>
            <p className="mt-1 text-sm opacity-90">{s.sectors.map((x) => (lang === 'ar' ? x.NameAr : x.NameEn)).join(' · ')}</p>
            {s.description && <p className="mt-3 text-sm">{s.description}</p>}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {s.services.map((x) => (
              <div key={x.Id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <div><div className="font-medium">{x.Name}</div><div className="text-xs text-slate-500">{x.DefaultMinutes} {t('minutes')}</div></div>
                {x.FromPrice != null && <div className="text-sm font-semibold" style={{ color }}>{t('servicesFrom')} {money(x.FromPrice, lang)}</div>}
              </div>
            ))}
          </div>
          <p className="mt-6 rounded-lg bg-amber-50 p-3 text-center text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">{t('bookSoon')}</p>
        </>
      )}
    </PublicShell>
  );
}
