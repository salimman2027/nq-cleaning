import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';
import { useI18n } from '../i18n';
import { Button, ErrorBox, Field, Input, Skeleton, money } from '../ui';

interface Profit {
  month: string;
  revenue: { orders: number; net: number; vat: number; gross: number; collected: number };
  expectedRevenue: { orders: number; gross: number };
  laborCost: number; laborHours: number;
  expenses: { total: number; byCategory: { category: string; total: number }[] };
  profit: number; isLoss: boolean;
}
interface Exp { Id: number; ExpenseDate: string; Category: string; Description: string | null; Amount: number }
const CATS = ['materials', 'fuel', 'rent', 'salaries', 'marketing', 'maintenance', 'other'] as const;

/** Monthly expenses and a simple profit-and-loss statement. */
export default function Finance() {
  const { t, lang } = useI18n();
  const [month, setMonth] = useState(() => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 7));
  const [p, setP] = useState<Profit | null>(null);
  const [items, setItems] = useState<Exp[] | null>(null);
  const [err, setErr] = useState('');
  const [f, setF] = useState({ date: '', category: 'materials', description: '', amount: '' });
  const load = useCallback(() => {
    setP(null); setItems(null);
    api<Profit>(`/finance/reports/profit?month=${month}`).then(setP).catch((e: Error) => setErr(e.message));
    api<{ items: Exp[] }>(`/finance/expenses?month=${month}`).then((r) => setItems(r.items)).catch((e: Error) => setErr(e.message));
  }, [month]);
  useEffect(load, [load]);
  const add = async (e: FormEvent) => {
    e.preventDefault(); setErr('');
    try { await api('/finance/expenses', { method: 'POST', body: { date: f.date, category: t(`exp_${f.category}` as never), description: f.description || undefined, amount: Number(f.amount) } }); setF({ ...f, description: '', amount: '' }); load(); }
    catch (ex) { setErr(ex instanceof ApiError ? ex.message : 'Error'); }
  };
  const del = async (id: number) => { if (!window.confirm(t('deleteExpense'))) return; try { await api(`/finance/expenses/${id}`, { method: 'DELETE' }); load(); } catch (ex) { setErr((ex as Error).message); } };
  const row = (label: string, v: number, strong = false, neg = false) => (
    <div className={`flex items-center justify-between py-2 ${strong ? 'border-t-2 border-slate-300 text-lg font-bold dark:border-slate-600' : 'border-t border-slate-100 dark:border-slate-800'}`}>
      <span>{label}</span><span className={neg ? 'text-red-600' : ''}>{neg ? '−' : ''}{money(Math.abs(v), lang)}</span>
    </div>
  );
  const min = `${month}-01`;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">{t('finance')}</h1>
        <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800" />
      </div>
      {err && <ErrorBox message={err} />}
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          <h2 className="mb-2 font-bold">{t('profitLoss')}</h2>
          {!p ? <Skeleton rows={5} /> : (
            <>
              {row(`${t('revenueDone')} (${p.revenue.orders})`, p.revenue.net)}
              {row(`${t('laborCost')} (${p.laborHours} ${t('hoursUnit')})`, p.laborCost, false, true)}
              {row(t('expensesTotal'), p.expenses.total, false, true)}
              {p.expenses.byCategory.map((c) => <div key={c.category} className="flex justify-between ps-4 text-xs text-slate-500"><span>{c.category}</span><span>{money(c.total, lang)}</span></div>)}
              <div className={p.isLoss ? 'text-red-600' : 'text-emerald-700'}>{row(p.isLoss ? t('netLoss') : t('netProfit'), p.profit, true)}</div>
              <p className="mt-3 text-xs text-slate-500">{t('expectedRev')}: {money(p.expectedRevenue.gross, lang)} ({p.expectedRevenue.orders}) · {t('vatNote')}: {money(p.revenue.vat, lang)}</p>
              <p className="mt-1 text-xs text-slate-500">{t('profitNote')}</p>
            </>
          )}
        </section>
        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          <h2 className="mb-2 font-bold">{t('expenses')}</h2>
          <form onSubmit={add} className="grid grid-cols-2 gap-2">
            <Field label={t('date')}><Input required type="date" min={min} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
            <Field label={t('amount')}><Input required type="number" min="0.01" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
            <Field label={t('category')}><select className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATS.map((c) => <option key={c} value={c}>{t(`exp_${c}` as never)}</option>)}</select></Field>
            <Field label={t('notes')}><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
            <div className="col-span-2"><Button type="submit">{t('addExpense')}</Button></div>
          </form>
          <div className="mt-3 max-h-72 overflow-y-auto">
            {!items ? <Skeleton rows={3} /> : items.length === 0 ? <p className="py-4 text-center text-sm text-slate-500">{t('noData')}</p> : items.map((x) => (
              <div key={x.Id} className="flex items-center justify-between gap-2 border-t border-slate-100 py-2 text-sm dark:border-slate-800">
                <div><div className="font-medium">{x.Category}{x.Description ? ` — ${x.Description}` : ''}</div><div className="text-xs text-slate-500">{String(x.ExpenseDate).slice(0, 10)}</div></div>
                <div className="flex items-center gap-2"><b>{money(x.Amount, lang)}</b><button onClick={() => del(x.Id)} aria-label={t('remove')} className="text-red-600">×</button></div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
