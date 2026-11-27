import { useEffect, useState, type PointerEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { useI18n } from '../i18n';
import { SectorIcon } from '../sectorIcons';
import { ErrorBox, Skeleton } from '../ui';

interface Sector { Code: string; NameAr: string; NameEn: string; Companies: number }
interface Co { CoverUrl?: string | null; ReviewedAt?: string | null; Slug: string; Name: string; Description: string | null; LogoUrl: string | null; PrimaryColor: string | null; Sectors: string[] }

export function PublicShell({ children, flush = false }: { children: ReactNode; flush?: boolean }) {
  const { t, toggle } = useI18n();
  const { me } = useAuth();
  const [logo, setLogo] = useState<string | null>(null);
  useEffect(() => { api<{ logoUrl: string | null }>('/market/brand').then((r) => setLogo(r.logoUrl)).catch(() => undefined); }, []);
  return (
    <div className="min-h-full bg-[#f4f6fa] text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="lattice bg-cyan-900 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4">
          <Link to="/" className="flex items-center gap-2.5 text-lg font-bold">
            {logo ? <img src={logo} alt="" className="h-9 w-auto" /> : <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-accent)] text-base font-bold text-cyan-950">NQ</span>}
            <span>{t('app')}</span>
          </Link>
          <nav className="flex items-center gap-2 text-sm">
            <Link to="/join" className="hidden rounded-lg px-3 py-2 text-white/85 hover:bg-white/10 sm:block">{t('joinAsCompany')}</Link>
            <Link to={me ? '/app' : '/login'} className="rounded-lg bg-white px-4 py-2 font-medium text-cyan-900 hover:bg-cyan-50">{me ? t('company') : t('companyLogin')}</Link>
            <button onClick={toggle} className="rounded-lg px-3 py-2 text-white/85 hover:bg-white/10">{t('lang')}</button>
          </nav>
        </div>
        {!flush && <div className="h-0" />}
      </header>
      {children}
    </div>
  );
}

const glowMove = (e: PointerEvent<HTMLElement>) => {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty('--x', `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty('--y', `${e.clientY - r.top}px`);
};

export default function Home() {
  const { t, lang } = useI18n();
  const [sectors, setSectors] = useState<Sector[] | null>(null);
  const [items, setItems] = useState<Co[] | null>(null);
  const [sector, setSector] = useState('');
  const [q, setQ] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { api<{ items: Sector[] }>('/market/sectors').then((r) => setSectors(r.items)).catch(() => setError('Error')); }, []);
  useEffect(() => {
    const p = new URLSearchParams();
    if (sector) p.set('sector', sector);
    if (q.trim()) p.set('q', q.trim());
    const h = setTimeout(() => { api<{ items: Co[] }>(`/market/companies?${p}`).then((r) => setItems(r.items)).catch(() => setError('Error')); }, 250);
    return () => clearTimeout(h);
  }, [sector, q]);

  const name = (s: Sector) => (lang === 'ar' ? s.NameAr : s.NameEn);
  return (
    <PublicShell>
      <section className="lattice relative overflow-hidden bg-cyan-900 pb-24 pt-10 text-white sm:pt-16">
        <svg aria-hidden viewBox="0 0 64 64" className="star-float pointer-events-none absolute -bottom-4 end-6 h-28 w-28 text-[var(--color-accent)] opacity-30"><path d="M32 4l7 17 17 7-17 7-7 17-7-17-17-7 17-7z" fill="currentColor" /></svg>
        <div className="relative mx-auto max-w-6xl px-4">
          <h1 className="rise max-w-2xl text-3xl font-bold leading-tight sm:text-5xl sm:leading-[1.25]">{t('marketTitle')}</h1>
          <p className="rise mt-4 max-w-xl text-base text-white/75 sm:text-lg" style={{ animationDelay: '80ms' }}>{t('marketSub')}</p>
          <div className="rise mt-8 flex max-w-xl items-center rounded-2xl bg-white p-1.5 shadow-lg" style={{ animationDelay: '160ms' }}>
            <svg viewBox="0 0 24 24" className="mx-3 h-5 w-5 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></svg>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('searchCompany')} className="min-w-0 flex-1 bg-transparent py-2.5 text-base text-slate-900 outline-none placeholder:text-slate-400" />
          </div>
        </div>
      </section>

      <div className="mx-auto -mt-14 max-w-6xl px-4">
        {error && <ErrorBox message={error} />}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(sectors ?? []).map((s) => {
            const on = sector === s.Code;
            return (
              <button key={s.Code} onClick={() => setSector(on ? '' : s.Code)} aria-pressed={on}
                onPointerMove={glowMove} className={`tile glow flex items-center gap-3 rounded-2xl p-4 text-start shadow-md ${on ? 'bg-[var(--color-accent)] text-cyan-950' : 'bg-white hover:bg-cyan-50 dark:bg-slate-900 dark:hover:bg-slate-800'}`}>
                <span className={`tile-ico flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${on ? 'bg-white/40' : 'bg-cyan-100 text-cyan-800 dark:bg-slate-800 dark:text-cyan-300'}`}><SectorIcon code={s.Code} /></span>
                <span className="min-w-0"><span className="block truncate font-semibold">{name(s)}</span><span className={`block text-xs ${on ? 'text-cyan-950/70' : 'text-slate-500'}`}>{s.Companies}</span></span>
              </button>
            );
          })}
          {!sectors && Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton h-[76px]" />)}
        </div>

        <h2 className="mb-4 mt-10 text-xl font-bold">{sector ? name(sectors!.find((s) => s.Code === sector)!) : t('allSectors')}</h2>
        {!items ? <Skeleton rows={3} /> : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
            <p className="font-medium">{t('noCompanies')}</p>
            <Link to="/join" className="mt-3 inline-block rounded-lg bg-cyan-700 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-800">{t('joinAsCompany')}</Link>
          </div>
        ) : (
          <div className="pb-16">
            {!sector && !q.trim() && (() => {
              const c = items[0];
              const color = c.PrimaryColor ?? '#0f3f8f';
              return (
                <Link to={`/c/${c.Slug}`} onPointerMove={glowMove} className="card-lift glow lattice rise mb-5 flex items-center gap-4 rounded-3xl p-5 text-white shadow-lg sm:p-7" style={{ background: color }}>
                  <span className="logo-pop flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white text-2xl font-bold shadow sm:h-20 sm:w-20" style={{ color }}>
                    {c.LogoUrl ? <img src={c.LogoUrl} alt="" className="h-full w-full object-cover" /> : c.Name.slice(0, 1)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="shine inline-block rounded-full bg-[var(--color-accent)] px-3 py-0.5 text-xs font-bold text-cyan-950">{t('newBadge')}</span>
                    <span className="mt-1 block truncate text-xl font-bold sm:text-2xl">{c.Name}</span>
                    <span className="block text-sm text-white/80">{t('welcomeNew')}</span>
                  </span>
                  <span className="hidden rounded-xl bg-white px-4 py-2 text-sm font-semibold text-cyan-900 sm:block">{t('openStore')}</span>
                </Link>
              );
            })()}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(!sector && !q.trim() ? items.slice(1) : items).map((c) => {
              const color = c.PrimaryColor ?? '#0f3f8f';
              return (
                <Link key={c.Slug} to={`/c/${c.Slug}`} onPointerMove={glowMove} className="card-lift glow group overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
                  <div className="lattice h-24 bg-cover bg-center" style={{ background: c.CoverUrl ? `linear-gradient(transparent 40%, ${color}cc), url("${c.CoverUrl}") center/cover` : color }} />
                  <div className="-mt-8 px-4 pb-4">
                    <div className="logo-pop flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-white text-2xl font-bold shadow ring-4 ring-white dark:bg-slate-800 dark:ring-slate-900" style={{ color }}>
                      {c.LogoUrl ? <img src={c.LogoUrl} alt="" className="h-full w-full object-cover" /> : c.Name.slice(0, 1)}
                    </div>
                    <div className="mt-3 font-semibold">{c.Name}</div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {c.Sectors.map((code) => sectors?.find((x) => x.Code === code)).filter(Boolean).map((s) => (
                        <span key={s!.Code} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300"><SectorIcon code={s!.Code} className="h-3.5 w-3.5" />{name(s!)}</span>
                      ))}
                    </div>
                    {c.Description && <p className="mt-3 line-clamp-2 text-sm text-slate-600 dark:text-slate-300">{c.Description}</p>}
                  </div>
                </Link>
              );
            })}
          </div>
          </div>
        )}
      </div>
    </PublicShell>
  );
}
