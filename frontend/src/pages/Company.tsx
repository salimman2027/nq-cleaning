import type { ChangeEvent } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { useI18n, type Key } from '../i18n';
import { Button, ErrorBox, Field, Input, Skeleton } from '../ui';

interface Addr { buildingNo: string; street: string; district: string; city: string; postalCode: string; additionalNo: string }
interface Profile {
  name: string; slug: string; logoUrl: string | null; primaryColor: string | null; status: string; description: string | null; crNumber: string | null; vatNumber: string | null;
  nationalAddress: Addr | null; reviewNote: string | null; sectorCodes: string[]; missing: string[];
}
const EMPTY: Addr = { buildingNo: '', street: '', district: '', city: '', postalCode: '', additionalNo: '' };

export default function Company() {
  const { t } = useI18n();
  const { reload } = useAuth();
  const [p, setP] = useState<Profile | null>(null);
  const [form, setForm] = useState({ name: '', slug: '', description: '', logoUrl: '', primaryColor: '', crNumber: '', vatNumber: '', addr: EMPTY });
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const apply = useCallback((r: Profile) => {
    setP(r);
    setForm({ name: r.name, slug: r.slug ?? '', description: r.description ?? '', logoUrl: r.logoUrl ?? '', primaryColor: r.primaryColor ?? '', crNumber: r.crNumber ?? '', vatNumber: r.vatNumber ?? '', addr: r.nationalAddress ?? EMPTY });
  }, []);
  useEffect(() => { api<Profile>('/company').then(apply).catch(() => setError('Error')); }, [apply]);

  if (!p) return error ? <ErrorBox message={error} /> : <Skeleton rows={5} />;
  const editable = p.status === 'draft' || p.status === 'rejected' || p.status === 'approved';
  const locked = p.status === 'approved';
  const addrComplete = Object.values(form.addr).every(Boolean);

  const act = async (fn: () => Promise<Profile>) => {
    setBusy(true); setError(''); setMsg('');
    try { apply(await fn()); await reload(); setMsg(t('saved')); } catch (e) { setError(e instanceof ApiError ? `${e.message}${Array.isArray((e.details as { missing?: string[] })?.missing) ? ': ' + (e.details as { missing: string[] }).missing.join(', ') : ''}` : 'Error'); } finally { setBusy(false); }
  };
  const save = () => act(() => api<Profile>('/company', { method: 'PUT', body: {
    name: form.name, slug: form.slug, description: form.description || null, logoUrl: form.logoUrl.trim() || null, primaryColor: form.primaryColor || null,
    ...(locked ? {} : { ...(form.crNumber ? { crNumber: form.crNumber } : {}), ...(form.vatNumber ? { vatNumber: form.vatNumber } : {}), ...(addrComplete ? { nationalAddress: form.addr } : {}) }),
  } }));
  const submit = () => act(async () => { await api('/company/submit', { method: 'POST' }); return api<Profile>('/company'); });
  const setA = (k: keyof Addr) => (e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, addr: { ...form.addr, [k]: e.target.value } });

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">{t('company')}</h1>
        <span className="rounded-full bg-slate-200 px-3 py-1 text-xs dark:bg-slate-800">{t(`st_${p.status}` as Key)}</span>
      </div>
      {p.status === 'pending_review' && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">{t('pendingNote')}</p>}
      {p.status === 'rejected' && p.reviewNote && <ErrorBox message={`${t('rejectionReason')}: ${p.reviewNote}`} />}
      {p.status === 'draft' && p.missing.length > 0 && <p className="text-sm text-slate-500">{t('missingFields')}: {p.missing.join(', ')}</p>}
      {locked && <p className="text-xs text-slate-500">{t('lockedNote')}</p>}
      {error && <ErrorBox message={error} />}
      {msg && <p className="text-sm text-green-700">{msg}</p>}
      <fieldset disabled={!editable || busy} className="space-y-3 rounded-2xl bg-white p-4 shadow dark:bg-slate-900">
        <Field label={t('companyName')}><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label={t('slugLabel')}><Input dir="ltr" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })} /></Field>
        <Field label={t('description')}><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <Field label={t('logoUrl')}><Input dir="ltr" placeholder="https://…" value={form.logoUrl} onChange={(e) => setForm({ ...form, logoUrl: e.target.value })} /></Field>
        <Field label={t('brandColor')}><Input type="color" value={form.primaryColor || '#0f3f8f'} onChange={(e) => setForm({ ...form, primaryColor: e.target.value })} /></Field>
        <Field label={t('cr')}><Input dir="ltr" inputMode="numeric" disabled={locked} value={form.crNumber} onChange={(e) => setForm({ ...form, crNumber: e.target.value })} /></Field>
        <Field label={t('vat')}><Input dir="ltr" inputMode="numeric" disabled={locked} value={form.vatNumber} onChange={(e) => setForm({ ...form, vatNumber: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <p className="col-span-2 text-sm font-medium">{t('natAddr')}</p>
          <Field label={t('building')}><Input disabled={locked} inputMode="numeric" maxLength={4} value={form.addr.buildingNo} onChange={setA('buildingNo')} /></Field>
          <Field label={t('additional')}><Input disabled={locked} inputMode="numeric" maxLength={4} value={form.addr.additionalNo} onChange={setA('additionalNo')} /></Field>
          <Field label={t('street')}><Input disabled={locked} value={form.addr.street} onChange={setA('street')} /></Field>
          <Field label={t('district')}><Input disabled={locked} value={form.addr.district} onChange={setA('district')} /></Field>
          <Field label={t('city')}><Input disabled={locked} value={form.addr.city} onChange={setA('city')} /></Field>
          <Field label={t('postal')}><Input disabled={locked} inputMode="numeric" maxLength={5} value={form.addr.postalCode} onChange={setA('postalCode')} /></Field>
        </div>
      </fieldset>
      <div className="flex gap-2">
        {editable && <Button variant="ghost" onClick={save} disabled={busy}>{t('save')}</Button>}
        {(p.status === 'draft' || p.status === 'rejected') && <Button onClick={submit} disabled={busy}>{t('submitReview')}</Button>}
      </div>
    </div>
  );
}
