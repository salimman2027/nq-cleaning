import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useI18n, type Key } from '../i18n';
import { useShop } from '../shop';
import { Remember } from '../Remember';
import { Button, ErrorBox, Field, Input, PasswordInput, money, Skeleton } from '../ui';
import ComplaintForm from './ComplaintForm';
import { PublicShell } from './Home';

interface Order { Unseen?: number; Id: number; Status: string; PaymentMethod: string; PaymentStatus: string; Total: number | null; PreferredDate: string; PreferredPeriod: string; PreferredTime?: string | null; CompanyName: string; Slug: string; CreatedAt: string; Items: { Name: string; Qty: number; UnitPrice: number }[] }

export default function Account() {
  const { t, lang } = useI18n();
  const { customer, ready, login, register, logout, refresh } = useShop();
  const nav = useNavigate();
  const [mode, setMode] = useState<'login' | 'register'>(new URLSearchParams(location.search).get('mode') === 'register' ? 'register' : 'login');
  const [f, setF] = useState({ name: '', phone: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [complain, setComplain] = useState<Order | null>(null);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const claim = async () => { try { await api('/shop/orders/claim', { method: 'POST', customer: true }); const r = await api<{ items: Order[] }>('/shop/orders', { customer: true }); setOrders(r.items); } catch { /* ignore */ } };
  useEffect(() => { if (customer) api<{ items: Order[] }>('/shop/orders', { customer: true }).then((r) => { setOrders(r.items); if (r.items.some((o) => o.Unseen)) api('/shop/orders/seen', { method: 'POST', customer: true }).then(refresh).catch(() => undefined); }).catch(() => setErr('Error')); }, [customer]);

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      if (mode === 'login') await login(f.phone, f.password); else await register(f.name, f.phone, f.password);
      const next = new URLSearchParams(location.search).get('next');
      if (next === 'cart') nav('/cart');
    } catch (ex) {
      setErr(ex instanceof ApiError ? (ex.code === 'BAD_CREDENTIALS' ? t('badPhonePass') : ex.code === 'PHONE_TAKEN' ? t('phoneTaken') : t('err_VALIDATION_ERROR')) : 'Error');
    } finally { setBusy(false); }
  };

  if (!ready) return <PublicShell><div className="mx-auto max-w-md p-6"><Skeleton rows={3} /></div></PublicShell>;
  if (!customer) {
    return (
      <PublicShell>
        <div className="mx-auto max-w-md px-4 py-10">
          <form onSubmit={submit} className="space-y-3 rounded-3xl bg-white p-6 shadow-lg ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
            <h1 className="text-2xl font-bold">{mode === 'login' ? t('customerLogin') : t('customerRegister')}</h1>
            <p className="text-sm text-slate-500">{t('customerHint')}</p>
            {err && <ErrorBox message={err} />}
            {mode === 'register' && <Field label={t('yourName')}><Input required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>}
            <Field label={t('yourPhone')}><Input required dir="ltr" inputMode="numeric" pattern="05[0-9]{8}" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
            <Field label={t('password')}><PasswordInput required minLength={8} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
            {mode === 'login' && <Remember />}
            <Button type="submit" disabled={busy} className="w-full">{mode === 'login' ? t('login') : t('createAccount')}</Button>
            <button type="button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setErr(''); }} className="w-full text-sm text-cyan-700 dark:text-cyan-400">{mode === 'login' ? t('noAccount') : t('haveAccount')}</button>
          </form>
        </div>
      </PublicShell>
    );
  }
  return (
    <PublicShell>
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-8">
        <div className="flex items-center justify-between gap-3">
          <div><h1 className="text-2xl font-bold">{t('myAccount')}</h1><p className="text-sm text-slate-500">{customer.name} · <span dir="ltr">{customer.phone}</span></p></div>
          <Button variant="ghost" onClick={logout}>{t('logout')}</Button>
        </div>
        <h2 className="font-semibold">{t('myOrders')}</h2>
        {err && <ErrorBox message={err} />}
        {orders?.filter((o) => o.Unseen).map((o) => (
          <div key={o.Id} role="status" className={`rise rounded-2xl p-4 text-sm font-medium ${o.Status === 'cancelled' ? 'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200' : 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'}`}>
            {t(`notice_${o.Status}` as Key)} · #{o.Id} · {o.CompanyName}
          </div>
        ))}
        {!orders ? <Skeleton rows={3} /> : orders.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700"><p>{t('noOrders')}</p><button type="button" onClick={claim} className="mt-3 block w-full text-sm text-cyan-800 underline dark:text-cyan-300">{t('claimOrders')}</button><Link to="/" className="mt-3 inline-block rounded-lg bg-cyan-700 px-4 py-2 text-sm font-medium text-white">{t('browseStores')}</Link></div>
        ) : orders.map((o) => (
          <article key={o.Id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link to={`/c/${o.Slug}`} className="font-semibold hover:underline">{o.CompanyName}</Link>
              <span className="rounded-full bg-slate-200 px-3 py-1 text-xs dark:bg-slate-800">{t(`rs_${o.Status}` as Key)}</span>
            </div>
            <div className="mt-1 text-sm text-slate-500">#{o.Id} · {String(o.PreferredDate).slice(0, 10)} · {t(`p_${o.PreferredPeriod}` as Key)}</div>
            <ul className="mt-2 space-y-0.5 text-sm">{o.Items.map((i, k) => <li key={k} className="flex justify-between"><span>{i.Name} × {i.Qty}</span><span>{money(i.UnitPrice * i.Qty, lang)}</span></li>)}</ul>
            <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2 text-sm dark:border-slate-800">
              <span>{t('payCash')} · {o.PaymentStatus === 'paid' ? t('paid') : t('unpaid')}</span>
              <b>{o.Total != null ? money(o.Total, lang) : '—'}</b>
            </div>
            <button onClick={() => setComplain(o)} className="mt-2 text-xs text-slate-500 underline">{t('complain')}</button>
          </article>
        ))}
      </div>
      {complain && <ComplaintForm slug={complain.Slug} orderId={complain.Id} onClose={() => setComplain(null)} />}
    </PublicShell>
  );
}
