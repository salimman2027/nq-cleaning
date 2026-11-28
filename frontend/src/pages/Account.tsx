import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useI18n, type Key } from '../i18n';
import { useShop } from '../shop';
import { Remember } from '../Remember';
import { Button, ErrorBox, Field, Input, PasswordInput, money, Skeleton } from '../ui';
import ComplaintForm from './ComplaintForm';
import TrackOrder from './TrackOrder';
import { PublicShell } from './Home';

interface Order { Unseen?: number; Id: number; Status: string; PaymentMethod: string; PaymentStatus: string; Total: number | null; PreferredDate: string; PreferredPeriod: string; PreferredTime?: string | null; JobStatus?: string | null; CompanyName: string; Slug: string; CreatedAt: string; Items: { Name: string; Qty: number; UnitPrice: number }[] }

const COLS = ['new', 'confirmed', 'running', 'done', 'cancelled'] as const;
type Col = (typeof COLS)[number];
const DOT: Record<Col, string> = { new: 'bg-amber-500', confirmed: 'bg-sky-500', running: 'bg-indigo-500', done: 'bg-emerald-500', cancelled: 'bg-red-500' };
/** Which column of the board an order belongs to: the request status, refined by the job status once the company confirmed it. */
function colOf(o: Order): Col {
  if (o.Status === 'cancelled') return 'cancelled';
  if (o.Status === 'confirmed') {
    if (o.JobStatus === 'done' || o.JobStatus === 'awaiting_review') return 'done';
    if (['assigned', 'on_the_way', 'arrived', 'in_progress'].includes(o.JobStatus ?? '')) return 'running';
    return 'confirmed';
  }
  return 'new';
}

export default function Account() {
  const { t, lang } = useI18n();
  const { customer, ready, login, register, logout, refresh } = useShop();
  const nav = useNavigate();
  const [mode, setMode] = useState<'login' | 'register'>(new URLSearchParams(location.search).get('mode') === 'register' ? 'register' : 'login');
  const [f, setF] = useState({ name: '', phone: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [complain, setComplain] = useState<Order | null>(null);
  const [track, setTrack] = useState<number | null>(null);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [view, setViewState] = useState<'board' | 'table'>(() => { try { return localStorage.getItem('ordersView') === 'table' ? 'table' : 'board'; } catch { return 'board'; } });
  const setView = (v: 'board' | 'table') => { setViewState(v); try { localStorage.setItem('ordersView', v); } catch { /* ignore */ } };
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
      <div className={`mx-auto space-y-4 px-4 py-8 ${view === 'board' || view === 'table' ? 'max-w-6xl' : 'max-w-3xl'}`}>
        <div className="flex items-center justify-between gap-3">
          <div><h1 className="text-2xl font-bold">{t('myAccount')}</h1><p className="text-sm text-slate-500">{customer.name} · <span dir="ltr">{customer.phone}</span></p></div>
          <Button variant="ghost" onClick={logout}>{t('logout')}</Button>
        </div>
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">{t('myOrders')}</h2>
          <div role="group" className="inline-flex overflow-hidden rounded-lg border border-slate-300 text-sm dark:border-slate-600">
            {(['board', 'table'] as const).map((v) => <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={`px-3 py-1.5 ${view === v ? 'bg-cyan-700 text-white' : 'bg-white dark:bg-slate-900'}`}>{t(v === 'board' ? 'viewBoard' : 'viewTable')}</button>)}
          </div>
        </div>
        {err && <ErrorBox message={err} />}
        {orders?.filter((o) => o.Unseen).map((o) => (
          <div key={o.Id} role="status" className={`rise rounded-2xl p-4 text-sm font-medium ${o.Status === 'cancelled' ? 'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200' : 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'}`}>
            {t(`notice_${o.Status}` as Key)} · #{o.Id} · {o.CompanyName}
          </div>
        ))}
        {!orders ? <Skeleton rows={3} /> : orders.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700"><p>{t('noOrders')}</p><button type="button" onClick={claim} className="mt-3 block w-full text-sm text-cyan-800 underline dark:text-cyan-300">{t('claimOrders')}</button><Link to="/" className="mt-3 inline-block rounded-lg bg-cyan-700 px-4 py-2 text-sm font-medium text-white">{t('browseStores')}</Link></div>
        ) : view === 'board' ? (
          <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-3">
            {COLS.map((col) => {
              const list = orders.filter((o) => colOf(o) === col);
              return (
                <section key={col} className="w-72 shrink-0 snap-start rounded-2xl bg-slate-100 p-2.5 dark:bg-slate-800/60">
                  <h3 className="mb-2 flex items-center justify-between px-1 text-sm font-bold"><span className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${DOT[col]}`} />{t(`col_${col}` as Key)}</span><span className="rounded-full bg-white px-2 text-xs dark:bg-slate-700">{list.length}</span></h3>
                  <div className="space-y-2">
                    {list.length === 0 && <p className="px-1 py-3 text-xs text-slate-400">—</p>}
                    {list.map((o) => (
                      <article key={o.Id} className="rounded-xl bg-white p-3 text-sm shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
                        <div className="flex items-start justify-between gap-2"><Link to={`/c/${o.Slug}`} className="font-semibold hover:underline">{o.CompanyName}</Link><span className="text-xs text-slate-500">#{o.Id}</span></div>
                        <div className="mt-0.5 text-xs text-slate-500">{String(o.PreferredDate).slice(0, 10)} · {o.PreferredTime ?? t(`p_${o.PreferredPeriod}` as Key)}</div>
                        <div className="mt-2 text-xs">{o.Items[0]?.Name}{o.Items.length > 1 ? ` +${o.Items.length - 1}` : ''}</div>
                        <div className="mt-2 flex items-center justify-between"><b>{o.Total != null ? money(o.Total, lang) : '—'}</b><span className="text-xs text-slate-500">{o.PaymentStatus === 'paid' ? t('paid') : t('unpaid')}</span></div>
                        <div className="mt-2 flex items-center gap-3"><button onClick={() => setTrack(o.Id)} className="rounded-lg bg-cyan-700 px-2.5 py-1 text-xs font-medium text-white">{t('trackOrder')}</button><button onClick={() => setComplain(o)} className="text-xs text-slate-500 underline">{t('complain')}</button></div>
                      </article>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
            <table className="w-full text-start text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800"><tr>{(['#', 'company', 'date', 'services', 'status', 'total', ''] as const).map((h) => <th key={h} className="px-3 py-2 text-start font-medium">{h === '#' ? '#' : h ? t(`th_${h}` as Key) : ''}</th>)}</tr></thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.Id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-3 py-2 text-slate-500">{o.Id}</td>
                    <td className="px-3 py-2 font-medium"><Link to={`/c/${o.Slug}`} className="hover:underline">{o.CompanyName}</Link></td>
                    <td className="whitespace-nowrap px-3 py-2">{String(o.PreferredDate).slice(0, 10)} · {o.PreferredTime ?? t(`p_${o.PreferredPeriod}` as Key)}</td>
                    <td className="px-3 py-2">{o.Items.map((i) => `${i.Name} × ${i.Qty}`).join('، ')}</td>
                    <td className="px-3 py-2"><span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs dark:bg-slate-800"><span className={`h-2 w-2 rounded-full ${DOT[colOf(o)]}`} />{t(`col_${colOf(o)}` as Key)}</span></td>
                    <td className="whitespace-nowrap px-3 py-2 font-semibold">{o.Total != null ? money(o.Total, lang) : '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2"><button onClick={() => setTrack(o.Id)} className="me-3 rounded-lg bg-cyan-700 px-2.5 py-1 text-xs font-medium text-white">{t('trackOrder')}</button><button onClick={() => setComplain(o)} className="text-xs text-slate-500 underline">{t('complain')}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {track !== null && <TrackOrder orderId={track} onClose={() => setTrack(null)} />}
      {complain && <ComplaintForm slug={complain.Slug} orderId={complain.Id} onClose={() => setComplain(null)} />}
    </PublicShell>
  );
}
