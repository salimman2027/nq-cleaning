import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { useI18n } from '../i18n';
import { Button, ErrorBox, Field, ImageUpload, Input, Modal, money, Select, Skeleton } from '../ui';

interface Svc {
  Id: number; Name: string; PricingMethod: string; DefaultMinutes: number; DefaultTechnicians: number; CurrentPrice: number | null; Unit: string | null; IsActive: boolean | number;
  ImageUrl: string | null; Category: string | null; Description: string | null; Includes: string | null; Notes: string | null;
}
const METHODS = ['fixed', 'hourly', 'per_technician', 'per_sqm', 'per_item', 'per_visit', 'per_room', 'per_property_type'];

export default function Services() {
  const { t, lang } = useI18n();
  const { can } = useAuth();
  const [rows, setRows] = useState<Svc[] | null>(null);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState<Svc | 'new' | null>(null);
  const load = useCallback(() => { api<{ items: Svc[] }>('/services').then((r) => setRows(r.items)).catch((e: Error) => setErr(e.message)); }, []);
  useEffect(load, [load]);
  const manage = can('services.manage');

  return (
    <div className="space-y-4">
      {manage && <Button onClick={() => setEditing('new')}>+ {t('newService')}</Button>}
      {err && <ErrorBox message={err} />}
      {!rows ? <Skeleton /> : rows.length === 0 ? <p className="text-slate-500">{t('noData')}</p> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => (
            <button key={r.Id} disabled={!manage} onClick={() => setEditing(r)} className="card-lift flex items-center gap-3 rounded-xl bg-white p-3 text-start shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
              <span className="h-16 w-20 shrink-0 overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">{r.ImageUrl && <img src={r.ImageUrl} alt="" className="h-full w-full object-cover" />}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{r.Name}</span>
                <span className="block truncate text-xs text-slate-500">{r.Category ?? '—'} · {r.DefaultMinutes} {t('minutes')}</span>
                <span className="block text-sm font-semibold text-cyan-700">{r.CurrentPrice === null ? '—' : money(r.CurrentPrice, lang)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {editing && <ServiceForm svc={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function ServiceForm({ svc, onClose, onSaved }: { svc: Svc | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [f, setF] = useState({
    name: svc?.Name ?? '', pricingMethod: svc?.PricingMethod ?? 'fixed', defaultMinutes: String(svc?.DefaultMinutes ?? 120), price: svc?.CurrentPrice != null ? String(svc.CurrentPrice) : '',
    imageUrl: svc?.ImageUrl ?? '', category: svc?.Category ?? '', description: svc?.Description ?? '', includes: (svc?.Includes ?? '').split('\n').filter(Boolean).join('\n'), notes: svc?.Notes ?? '',
    isActive: svc ? Boolean(svc.IsActive) : true,
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    const detail = {
      imageUrl: f.imageUrl || null, category: f.category.trim() || null, description: f.description.trim() || null,
      includes: f.includes.split('\n').map((x) => x.trim()).filter(Boolean), notes: f.notes.trim() || null,
    };
    try {
      if (!svc) {
        await api('/services', { method: 'POST', body: { name: f.name, pricingMethod: f.pricingMethod, defaultMinutes: Number(f.defaultMinutes), price: Number(f.price), ...detail } });
      } else {
        await api(`/services/${svc.Id}`, { method: 'PUT', body: { name: f.name, pricingMethod: f.pricingMethod, defaultMinutes: Number(f.defaultMinutes), defaultTechnicians: svc.DefaultTechnicians, isActive: f.isActive, ...detail } });
        if (f.price !== '' && Number(f.price) !== svc.CurrentPrice) await api(`/services/${svc.Id}/prices`, { method: 'POST', body: { price: Number(f.price), unit: svc.Unit ?? 'unit' } });
      }
      onSaved();
    } catch (ex) { setErr(ex instanceof ApiError ? ex.message : 'Error'); } finally { setBusy(false); }
  };
  return (
    <Modal title={svc ? t('editService') : t('newService')} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><ImageUpload value={f.imageUrl} onChange={(u) => setF({ ...f, imageUrl: u })} /></div>
        <Field label={t('name')}><Input required value={f.name} onChange={set('name')} /></Field>
        <Field label={t('categoryLbl')}><Input value={f.category} onChange={set('category')} /></Field>
        <Field label={t('pricingMethod')}><Select value={f.pricingMethod} onChange={set('pricingMethod')}>{METHODS.map((m) => <option key={m}>{m}</option>)}</Select></Field>
        <Field label={t('price')}><Input type="number" min={0} step="0.01" required value={f.price} onChange={set('price')} /></Field>
        <Field label={t('defaultMinutes')}><Input type="number" min={15} required value={f.defaultMinutes} onChange={set('defaultMinutes')} /></Field>
        {svc && <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />{t('hideSvc')}</label>}
        <div className="sm:col-span-2"><Field label={t('svcDescription')}><textarea rows={2} maxLength={1000} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800" value={f.description} onChange={set('description')} /></Field></div>
        <div className="sm:col-span-2"><Field label={t('svcIncludes')}><textarea rows={4} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800" value={f.includes} onChange={set('includes')} /></Field></div>
        <div className="sm:col-span-2"><Field label={t('svcNotes')}><textarea rows={2} maxLength={500} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800" value={f.notes} onChange={set('notes')} /></Field></div>
        {err && <div className="sm:col-span-2"><ErrorBox message={err} /></div>}
        <div className="flex gap-2 sm:col-span-2"><Button type="submit" disabled={busy}>{t('save')}</Button><Button type="button" variant="ghost" onClick={onClose}>{t('cancel')}</Button></div>
      </form>
    </Modal>
  );
}
