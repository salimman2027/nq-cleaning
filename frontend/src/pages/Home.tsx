import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { useI18n } from '../i18n';
import { ErrorBox, Input, Skeleton } from '../ui';

interface Sector { Code: string; NameAr: string; NameEn: string; Companies: number }
interface Co { Slug: string; Name: string; Description: string | null; LogoUrl: string | null; PrimaryColor: string | null; Sectors: string[] }

export function PublicShell({ children }: { children: ReactNode }) {
  const { t, toggle } = useI18n();
  const { me } = useAuth();
  return (
    <div className="min-h-full bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
        <Link to="/" className="font-bold text-cyan-700 dark:text-cyan-400">{t('app')}</Link>
        <nav className="flex items-center gap-2 text-sm">
          <Link to="/join" className="rounded-lg border px-3 py-1 dark:border-slate-700">{t('joinAsCompany')}</Link>
          <Link to={me ? '/app' : '/login'} className="rounded-lg bg-cyan-700 px-3 py-1 text-white">{me ? t('company') : t('companyLogin')}</Link>
          <button onClick={toggle} className="rounded-lg border px-3 py-1 dark:border-slate-700">{t('lang')}</button>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl p-4">{children}</main>
    </div>
  );
}

export default function Home() {
  const { t, lang } = useI18n();
  const [sectors, setSectors] = useState<Sector[] | null>(null);
  const [items, setItems] = useState<Co[] | null>(null);
  const [sector, setSector] = useState('');
  const [q, setQ] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ items: Sector[] }>('/market/sectors').then((r) => setSectors(r.items)).catch(() => setError('Error'));
  }, []);
  useEffect(() => {
    const p = new URLSearchParams();
    if (sector) p.set('sector', sector);
    if (q.trim()) p.set('q', q.trim());
    const h = setTimeout(() => {
      api<{ items: Co[] }>(`/market/companies?${p}`).then((r) => setItems(r.items)).catch(() => setError('Error'));
    }, 250);
    return () => clearTimeout(h);
  }, [sector, q]);

  const chip = (active: boolean) => `whitespace-nowrap rounded-full border px-4 py-1.5 text-sm ${active ? 'border-cyan-700 bg-cyan-700 text-white' : 'border-slate-300 dark:border-slate-700'}`;
  return (
    <PublicShell>
      <section className="py-6 text-center">
        <h1 className="text-2xl font-bold sm:text-3xl">{t('marketTitle')}</h1>
        <p className="mt-2 text-slate-500">{t('marketSub')}</p>
      </section>
      {error && <ErrorBox message={error} />}
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        <button className={chip(sector === '')} onClick={() => setSector('')}>{t('allSectors')}</button>
        {sectors?.map((s) => (
          <button key={s.Code} className={chip(sector === s.Code)} onClick={() => setSector(s.Code)}>{lang === 'ar' ? s.NameAr : s.NameEn}</button>
        ))}
      </div>
      <div className="mb-4"><Input placeholder={t('searchCompany')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {!items ? <Skeleton rows={3} /> : items.length === 0 ? <p className="py-10 text-center text-slate-500">{t('noCompanies')}</p> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((c) => (
            <Link key={c.Slug} to={`/c/${c.Slug}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:shadow dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl text-lg font-bold text-white" style={{ background: c.PrimaryColor ?? '#0e7490' }}>
                  {c.LogoUrl ? <img src={c.LogoUrl} alt="" className="h-full w-full object-cover" /> : c.Name.slice(0, 1)}
                </div>
                <div className="min-w-0"><div className="truncate font-semibold">{c.Name}</div>
                  <div className="truncate text-xs text-slate-500">{c.Sectors.map((s) => sectors?.find((x) => x.Code === s)).filter(Boolean).map((s) => (lang === 'ar' ? s!.NameAr : s!.NameEn)).join(' · ')}</div></div>
              </div>
              {c.Description && <p className="mt-3 line-clamp-2 text-sm text-slate-600 dark:text-slate-300">{c.Description}</p>}
            </Link>
          ))}
        </div>
      )}
    </PublicShell>
  );
}
