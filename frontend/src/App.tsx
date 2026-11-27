import { useState } from 'react';
import { Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { useI18n, type Key } from './i18n';
import { Skeleton, ZoomControl } from './ui';
import { LogoMark } from './Logo';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Bookings from './pages/Bookings';
import Customers from './pages/Customers';
import Technicians from './pages/Technicians';
import Services from './pages/Services';
import Home from './pages/Home';
import Storefront from './pages/Storefront';
import Register from './pages/Register';
import Account from './pages/Account';
import Cart from './pages/Cart';
import Categories from './pages/Categories';
import Requests from './pages/Requests';
import Company from './pages/Company';
import Monitor from './pages/Monitor';
import Complaints from './pages/Complaints';
import Supervisors from './pages/Supervisors';
import Finance from './pages/Finance';
import StaffReport from './pages/StaffReport';
import Review from './pages/Review';
import Settings from './pages/Settings';
import Ratings from './pages/Ratings';
import Rate from './pages/Rate';

const NAV: { to: string; key: Key; perm: string; icon: string }[] = [
  { to: '/app/review', key: 'review', perm: 'platform.companies.view', icon: '✅' },
  { to: '/app/monitor', key: 'monitor', perm: 'platform.companies.view', icon: '📊' },
  { to: '/app/complaints', key: 'complaints', perm: 'platform.companies.view', icon: '🚩' },
  { to: '/app/settings', key: 'settings', perm: 'platform.brand.manage', icon: '⚙' },
  { to: '/app/company', key: 'company', perm: 'company.profile.manage', icon: '🏢' },
  { to: '/app', key: 'dashboard', perm: 'dashboard.view', icon: '▦' },
  { to: '/app/requests', key: 'requests', perm: 'bookings.view', icon: '📥' },
  { to: '/app/bookings', key: 'bookings', perm: 'bookings.view', icon: '📅' },
  { to: '/app/customers', key: 'customers', perm: 'customers.view', icon: '👥' },
  { to: '/app/technicians', key: 'technicians', perm: 'technicians.view', icon: '🧹' },
  { to: '/app/supervisors', key: 'supervisors', perm: 'technicians.view', icon: '🧑‍💼' },
  { to: '/app/staff-report', key: 'staffReport', perm: 'finance.view_cost', icon: '📈' },
  { to: '/app/ratings', key: 'ratingsTitle', perm: 'bookings.view', icon: '⭐' },
  { to: '/app/finance', key: 'finance', perm: 'finance.view_cost', icon: '💰' },
  { to: '/app/categories', key: 'categories', perm: 'services.view', icon: '🗂' },
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
    <div className="flex h-full bg-[#f4f6fa] text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <aside className={`${open ? 'w-60' : 'w-16'} lattice hidden shrink-0 flex-col bg-cyan-900 text-white transition-all md:flex`}>
        <button onClick={() => setOpen(!open)} className="flex items-center gap-2.5 p-4 text-start text-lg font-bold"><LogoMark className="h-9 w-9" />{open && <span>{t('app')}</span>}</button>
        <nav className="flex-1 space-y-1 px-2">
          {links.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/app'} className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm ${isActive ? 'bg-white font-semibold text-cyan-900' : 'text-white/80 hover:bg-white/10'}`}>
              <span>{n.icon}</span>{open && <span>{t(n.key)}</span>}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900"><span className="text-sm font-medium">{me.FullName} <span className="text-slate-400">·</span> <span className="text-slate-500">{me.CompanyName}</span></span>
                    <div className="flex items-center gap-2 text-sm">
            <ZoomControl />
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
      <Route path="/account" element={<Account />} />
      <Route path="/cart" element={<Cart />} />
      <Route path="/rate/:token" element={<Rate />} />
      <Route path="/join" element={me ? <Navigate to="/app" replace /> : <Register />} />
      <Route path="/login" element={me ? <Navigate to="/app" replace /> : <Login />} />
      <Route path="/app" element={<Layout />}>
        <Route index element={<AppHome />} />
        <Route path="company" element={<Company />} />
        <Route path="review" element={<Review />} />
        <Route path="monitor" element={<Monitor />} />
        <Route path="complaints" element={<Complaints />} />
        <Route path="settings" element={<Settings />} />
        <Route path="requests" element={<Requests />} />
        <Route path="bookings" element={<Bookings />} />
        <Route path="customers" element={<Customers />} />
        <Route path="supervisors" element={<Supervisors />} />
        <Route path="ratings" element={<Ratings />} />
        <Route path="finance" element={<Finance />} />
        <Route path="staff-report" element={<StaffReport />} />
        <Route path="technicians" element={<Technicians />} />
        <Route path="categories" element={<Categories />} />
        <Route path="services" element={<Services />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
