import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { useI18n } from '../i18n';
import { Button, ErrorBox, Field, Input, Modal, money, Select, Skeleton } from '../ui';

interface Svc { Id: number; Name: string; PricingMethod: string; DefaultMinutes: number; DefaultTechnicians: number; CurrentPrice: number | null }
const METHODS = ['fixed', 'hourly', 'per_technician', 'per_sqm', 'per_item', 'per_visit', 'per_room', 'per_property_type'];

export default function Services() {
  const { t, lang } = useI18n();
  const { can } = useAuth();
  const [rows, setRows] = useState<Svc[] | null>(null);
  const [err, setErr] = useState('');
  const [adding, setAdding] = useState(false);
  const load = useCallback(() => { api<{ items: Svc[] }>('/services').then((r) => setRows(r.items)).catch((e: Error) => setErr(e.message)); }, []);
  useEffect(load, [load]);

  return (
    <div className="space-y-4">
      {can('services.manage') && <Button onClick={() => setAdding(true)}>+ {t('services')}</Button>}
      {err && <ErrorBox message={err} />}
      {!rows ? <Skeleton /> : rows.length === 0 ? <p className="text-slate-500">{t('noData')}</p> : (
        <div className="overflow-x-auto rounded-xl bg-white dark:bg-slate-900">
          <table className="w-full text-sm">
            <thead className="text-slate-500"><tr>{[t('name'), t('pricingMethod'), t('defaultMinutes'), t('price')].map((h) => <th key={h} className="p-3 text-start">{h}</th>)}</tr></thead>
            <tbody>{rows.map((r) => <tr key={r.Id} className="border-t border-slate-100 dark:border-slate-800"><td className="p-3">{r.Name}</td><td className="p-3">{r.PricingMethod}</td><td className="p-3">{r.DefaultMinutes}</td><td className="p-3">{r.CurrentPrice === null ? '—' : money(r.CurrentPrice, lang)}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      {adding && <NewService onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
    </div>
  );
}

function NewService({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [f, setF] = useState({ name: '', pricingMethod: 'fixed', defaultMinutes: '120', price: '', imageUrl: '', category: '' });
  const [err, setErr] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api('/services', { method: 'POST', body: { name: f.name, pricingMethod: f.pricingMethod, defaultMinutes: Number(f.defaultMinutes), price: Number(f.price), imageUrl: f.imageUrl.trim() || null, category: f.category.trim() || null } });
      onSaved();
    } catch (ex) { setErr(ex instanceof ApiError ? ex.message : 'Error'); }
  };
  return (
    <Modal title={t('services')} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label={t('name')}><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label={t('pricingMethod')}><Select value={f.pricingMethod} onChange={(e) => setF({ ...f, pricingMethod: e.target.value })}>{METHODS.map((m) => <option key={m}>{m}</option>)}</Select></Field>
        <Field label={t('defaultMinutes')}><Input type="number" min={15} required value={f.defaultMinutes} onChange={(e) => setF({ ...f, defaultMinutes: e.target.value })} /></Field>
        <Field label={t('price')}><Input type="number" min={0} step="0.01" required value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
        <Field label={t('categoryLbl')}><Input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></Field>
        <Field label={t('imageUrlSvc')}><Input dir="ltr" placeholder="https://…" value={f.imageUrl} onChange={(e) => setF({ ...f, imageUrl: e.target.value })} /></Field>
        {err && <div className="sm:col-span-2"><ErrorBox message={err} /></div>}
        <div className="flex gap-2 sm:col-span-2"><Button type="submit">{t('save')}</Button><Button type="button" variant="ghost" onClick={onClose}>{t('cancel')}</Button></div>
      </form>
    </Modal>
  );
}
