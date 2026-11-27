import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useI18n, type Key } from '../i18n';
import { useShop } from '../shop';
import { Button, ErrorBox, money } from '../ui';
import { AreaSelect, type ServiceArea } from '../AreaSelect';
import { PublicShell } from './Home';

const PAY_LABEL: Record<string, Key> = { cash: 'payCash', card: 'payCard', tabby: 'payTabby', tamara: 'payTamara' };
const DEFAULT_METHODS = [{ code: 'cash', enabled: true }, { code: 'card', enabled: false }, { code: 'tabby', enabled: false }, { code: 'tamara', enabled: false }];

export default function Cart() {
  const { t, lang } = useI18n();
  const { cart, customer, setQty, clear, total } = useShop();
  const nav = useNavigate();
  const [methods, setMethods] = useState<{ code: string; enabled: boolean }[]>(DEFAULT_METHODS);
  useEffect(() => { api<{ paymentMethods?: { code: string; enabled: boolean }[] }>('/market/config').then((r) => { if (r.paymentMethods) setMethods(r.paymentMethods); }).catch(() => undefined); }, []);
  const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
  const [f, setF] = useState({ date: '', period: 'morning', address: '', notes: '', pay: 'cash', city: '', district: '' });
  const [areas, setAreas] = useState<ServiceArea[]>([]);
  useEffect(() => { if (cart?.slug) api<{ areas?: ServiceArea[] }>(`/market/companies/${cart.slug}`).then((r) => setAreas(r.areas ?? [])).catch(() => undefined); }, [cart?.slug]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const cls = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base dark:border-slate-600 dark:bg-slate-800';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!cart) return;
    setBusy(true); setErr('');
    try {
      const r = await api<{ id: number }>('/shop/orders', { method: 'POST', customer: true, body: { slug: cart.slug, items: cart.items.map((i) => ({ serviceId: i.serviceId, qty: i.qty })), date: f.date, period: f.period, city: f.city || undefined, district: f.district || undefined, address: f.address, notes: f.notes || undefined, paymentMethod: f.pay } });
      clear(); setDone(r.id);
    } catch (ex) { setErr(ex instanceof ApiError ? (ex.code === 'BAD_SERVICE' ? t('cartStale') : ex.code === 'BAD_DATE' ? t('badDate') : ex.code === 'OUT_OF_AREA' ? t('outOfArea') : t('err_VALIDATION_ERROR')) : 'Error'); } finally { setBusy(false); }
  };

  if (done) return (
    <PublicShell><div className="mx-auto max-w-md px-4 py-16 text-center">
      <div className="rise rounded-3xl bg-white p-8 shadow-lg ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
        <div className="text-4xl">✓</div><h1 className="mt-2 text-xl font-bold">{t('orderDone')}</h1><p className="mt-1 text-sm text-slate-500">#{done} · {t('orderDoneSub')}</p>
        <Button className="mt-5" onClick={() => nav('/account')}>{t('myOrders')}</Button>
      </div></div></PublicShell>
  );
  if (!cart || cart.items.length === 0) return (
    <PublicShell><div className="mx-auto max-w-md px-4 py-16 text-center"><p className="text-lg font-semibold">{t('cartEmpty')}</p><Link to="/" className="mt-4 inline-block rounded-lg bg-cyan-700 px-4 py-2 text-sm font-medium text-white">{t('browseStores')}</Link></div></PublicShell>
  );
  return (
    <PublicShell>
      <div className="mx-auto grid max-w-5xl gap-5 px-4 py-8 md:grid-cols-5">
        <section className="space-y-3 md:col-span-3">
          <h1 className="text-2xl font-bold">{t('cart')}</h1>
          <p className="text-sm text-slate-500"><Link to={`/c/${cart.slug}`} className="underline">{cart.company}</Link></p>
          {cart.items.map((i) => (
            <div key={i.serviceId} className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
              <span className="h-14 w-16 shrink-0 overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">{i.image && <img src={i.image} alt="" className="h-full w-full object-cover" />}</span>
              <div className="min-w-0 flex-1"><div className="truncate font-medium">{i.name}</div><div className="text-sm text-slate-500">{money(i.price, lang)}</div></div>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setQty(i.serviceId, i.qty - 1)} className="h-8 w-8 rounded-lg border text-lg dark:border-slate-700" aria-label="−">−</button>
                <span className="w-8 text-center">{i.qty}</span>
                <button type="button" onClick={() => setQty(i.serviceId, i.qty + 1)} className="h-8 w-8 rounded-lg border text-lg dark:border-slate-700" aria-label="+">+</button>
              </div>
            </div>
          ))}
          <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">{t('priceNote')}</p>
        </section>
        <form onSubmit={submit} className="space-y-3 rounded-2xl bg-white p-4 shadow ring-1 ring-slate-200 md:col-span-2 dark:bg-slate-900 dark:ring-slate-800">
          <h2 className="font-semibold">{t('checkout')}</h2>
          {err && <ErrorBox message={err} />}
          <input required type="date" min={today} className={cls} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} aria-label={t('prefDate')} />
          <select className={cls} value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })} aria-label={t('period')}>{['morning', 'afternoon', 'evening'].map((p) => <option key={p} value={p}>{t(`p_${p}` as Key)}</option>)}</select>
          <AreaSelect areas={areas} city={f.city} district={f.district} onChange={(city, district) => setF({ ...f, city, district })} className={cls} />
          <input required minLength={3} className={cls} placeholder={t('addressReq')} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
          <input className={cls} placeholder={t('notesOpt')} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          <fieldset className="space-y-2"><legend className="mb-1 text-sm font-medium">{t('payment')}</legend>
            {methods.map((m) => (
              <label key={m.code} className={`flex items-center gap-2 rounded-xl border p-3 text-sm ${m.enabled ? 'border-cyan-600 bg-cyan-50 dark:bg-slate-800' : 'border-slate-200 text-slate-400 dark:border-slate-700'}`}>
                <input type="radio" name="pay" disabled={!m.enabled} checked={f.pay === m.code} onChange={() => setF({ ...f, pay: m.code })} />{t(PAY_LABEL[m.code] ?? 'payCash')}
                {!m.enabled && <span className="ms-auto rounded bg-slate-100 px-2 text-xs dark:bg-slate-800">{t('soon')}</span>}
              </label>
            ))}
          </fieldset>
          <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-lg font-bold dark:border-slate-800"><span>{t('total')}</span><span>{money(total, lang)}</span></div>
          {customer ? <Button type="submit" disabled={busy} className="w-full">{t('confirmOrder')}</Button> : <Link to="/account?next=cart" className="block rounded-lg bg-cyan-700 px-4 py-2.5 text-center text-sm font-medium text-white">{t('loginToOrder')}</Link>}
        </form>
      </div>
    </PublicShell>
  );
}
