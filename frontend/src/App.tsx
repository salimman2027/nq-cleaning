import { useState } from 'react';
import { Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { useI18n, type Key } from './i18n';
import { Skeleton } from './ui';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Bookings from './pages/Bookings';
import Customers from './pages/Customers';
import Technicians from './pages/Technicians';
import Services from './pages/Services';
import Home from './pages/Home';
import Storefront from './pages/Storefront';
import Register from './pages/Register';
import Company from './pages/Company';
import Review from './pages/Review';

const NAV: { to: string; key: Key; perm: string; icon: string }[] = [
  { to: '/app/review', key: 'review', perm: 'platform.companies.view', icon: '✅' },
  { to: '/app/company', key: 'company', perm: 'company.profile.manage', icon: '🏢' },
  { to: '/app', key: 'dashboard', perm: 'dashboard.view', icon: '▦' },
  { to: '/app/bookings', key: 'bookings', perm: 'bookings.view', icon: '📅' },
  { to: '/app/customers', key: 'customers', perm: 'customers.view', icon: '👥' },
  { to: '/app/technicians', key: 'technicians', perm: 'technicians.view', icon: '🧹' },
  { to: '/app/services', key: 'services', perm: 'services.view', icon: '🛠' },
];

function Layout() {
  const { me, logout, can } = useAuth();
  const { t, toggle, lang } = useI18n();
  const [open, setOpen] = useState(true);
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  if (!me) return <Navigate to="/login" replace />;

  const toggleDark = () => {
    const next = !dark;
    document.documentElement.classList.toggle('dark', next);
    try { localStorage.setItem('nq.dark', next ? '1' : '0'); } catch { /* ignore */ }
    setDark(next);
  };
  // Companies that are not approved yet only get their profile page; the server enforces this too.
  const approved = me.IsPlatform || me.CompanyStatus === 'approved';
  const links = NAV.filter((n) => can(n.perm) && (approved || n.to === '/app/company'));

  return (
    <div className="flex h-full bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <aside className={`${open ? 'w-56' : 'w-14'} hidden shrink-0 flex-col border-e border-slate-200 bg-white transition-all md:flex dark:border-slate-800 dark:bg-slate-900`}>
        <button onClick={() => setOpen(!open)} className="p-4 text-start font-bold text-cyan-700 dark:text-cyan-400">{open ? t('app') : 'NQ'}</button>
        <nav className="flex-1 space-y-1 px-2">
          {links.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/app'} className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${isActive ? 'bg-cyan-700 text-white' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
              <span>{n.icon}</span>{open && <span>{t(n.key)}</span>}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
          <span className="text-sm text-slate-500">{me.FullName} · {me.CompanyName}</span>
          <div className="flex items-center gap-2 text-sm">
            <button onClick={toggleDark} className="rounded-lg border px-3 py-1 dark:border-slate-700">{t('dark')}</button>
            <button onClick={toggle} className="rounded-lg border px-3 py-1 dark:border-slate-700">{t('lang')}</button>
            <button onClick={logout} className="rounded-lg border px-3 py-1 dark:border-slate-700">{t('logout')}</button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 pb-24 md:pb-4" key={lang}><Outlet /></main>
        <nav className="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t border-slate-200 bg-white py-2 md:hidden dark:border-slate-800 dark:bg-slate-900">
          {links.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/app'} className={({ isActive }) => `flex flex-col items-center text-xs ${isActive ? 'text-cyan-700 dark:text-cyan-400' : 'text-slate-500'}`}>
              <span className="text-lg">{n.icon}</span>{t(n.key)}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}

function AppHome() {
  const { me, can } = useAuth();
  if (me && !me.IsPlatform && me.CompanyStatus !== 'approved') return <Navigate to="/app/company" replace />;
  if (can('platform.companies.view') && !can('dashboard.view')) return <Navigate to="/app/review" replace />;
  return <Dashboard />;
}

export default function App() {
  const { ready, me } = useAuth();
  if (!ready) return <div className="p-8"><Skeleton rows={3} /></div>;
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/c/:slug" element={<Storefront />} />
      <Route path="/join" element={me ? <Navigate to="/app" replace /> : <Register />} />
      <Route path="/login" element={me ? <Navigate to="/app" replace /> : <Login />} />
      <Route path="/app" element={<Layout />}>
        <Route index element={<AppHome />} />
        <Route path="company" element={<Company />} />
        <Route path="review" element={<Review />} />
        <Route path="bookings" element={<Bookings />} />
        <Route path="customers" element={<Customers />} />
        <Route path="technicians" element={<Technicians />} />
        <Route path="services" element={<Services />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
