import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { useI18n } from '../i18n';
import { Button, ErrorBox, Field, Input, Modal, Skeleton } from '../ui';

interface Row { Id: number; Code: string; Name: string; Type: string; Mobile: string; Email: string | null }

export default function Customers() {
  const { t } = useI18n();
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    api<{ items: Row[] }>(`/customers?q=${encodeURIComponent(q)}`).then((r) => { setRows(r.items); setErr(''); }).catch((e: Error) => setErr(e.message));
  }, [q]);
  useEffect(() => { const id = setTimeout(load, 250); return () => clearTimeout(id); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input placeholder={t('search')} value={q} onChange={(e) => setQ(e.target.value)} />
        {can('customers.create') && <Button onClick={() => setAdding(true)}>{t('newCustomer')}</Button>}
      </div>
      {err && <ErrorBox message={err} />}
      {!rows ? <Skeleton /> : rows.length === 0 ? <p className="text-slate-500">{t('noData')}</p> : (
        <div className="overflow-x-auto rounded-xl bg-white dark:bg-slate-900">
          <table className="w-full text-sm">
            <thead className="text-start text-slate-500"><tr>{[t('code'), t('name'), t('mobile')].map((h) => <th key={h} className="p-3 text-start">{h}</th>)}</tr></thead>
            <tbody>{rows.map((r) => <tr key={r.Id} className="border-t border-slate-100 dark:border-slate-800"><td className="p-3">{r.Code}</td><td className="p-3">{r.Name}</td><td className="p-3" dir="ltr">{r.Mobile}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      {adding && <NewCustomer onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
    </div>
  );
}

function NewCustomer({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [f, setF] = useState({ name: '', mobile: '', city: '', district: '', street: '', mapUrl: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: FormEvent, force = false) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    const address = { city: f.city || undefined, district: f.district || undefined, street: f.street || undefined, mapUrl: f.mapUrl || undefined };
    try {
      await api('/customers', { method: 'POST', body: { name: f.name, mobile: f.mobile, force, addresses: Object.values(address).some(Boolean) ? [address] : [] } });
      onSaved();
    } catch (ex) {
      if (ex instanceof ApiError && ex.code === 'DUPLICATE_CUSTOMER' && window.confirm(`${t('duplicateWarn')}\n${(ex.details as { Name?: string })?.Name ?? ''}`)) {
        setBusy(false);
        return submit(e, true);
      }
      setErr(ex instanceof ApiError ? ex.message : 'Error');
    } finally { setBusy(false); }
  };

  return (
    <Modal title={t('newCustomer')} onClose={onClose}>
      <form onSubmit={(e) => submit(e)} className="grid gap-3 sm:grid-cols-2">
        <Field label={t('name')}><Input required minLength={2} value={f.name} onChange={set('name')} /></Field>
        <Field label={t('mobile')}><Input required dir="ltr" inputMode="tel" value={f.mobile} onChange={set('mobile')} /></Field>
        <Field label="City"><Input value={f.city} onChange={set('city')} /></Field>
        <Field label="District"><Input value={f.district} onChange={set('district')} /></Field>
        <Field label={t('address')}><Input value={f.street} onChange={set('street')} /></Field>
        <Field label="Google Maps"><Input type="url" dir="ltr" value={f.mapUrl} onChange={set('mapUrl')} /></Field>
        {err && <div className="sm:col-span-2"><ErrorBox message={err} /></div>}
        <div className="flex gap-2 sm:col-span-2"><Button type="submit" disabled={busy}>{t('save')}</Button><Button type="button" variant="ghost" onClick={onClose}>{t('cancel')}</Button></div>
      </form>
    </Modal>
  );
}
