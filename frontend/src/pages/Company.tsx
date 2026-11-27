import type { ChangeEvent } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, fileToBase64, openFile } from '../api';
import { useAuth } from '../auth';
import { useI18n, type Key } from '../i18n';
import { Button, ErrorBox, Field, ImageUpload, Input, Modal, Skeleton } from '../ui';

interface Addr { buildingNo: string; street: string; district: string; city: string; postalCode: string; additionalNo: string }
interface Profile {
  name: string; slug: string; logoUrl: string | null; coverUrl: string | null; whatsapp: string | null; primaryColor: string | null; status: string; description: string | null; crNumber: string | null; vatNumber: string | null;
  nationalAddress: Addr | null; documents: Doc[]; extractionEnabled: boolean; reviewNote: string | null; sectorCodes: string[]; missing: string[];
}
interface Doc { kind: 'cr' | 'vat' | 'address'; fileName: string; mimeType: string; extracted: { crNumber?: string; vatNumber?: string; nationalAddress?: Partial<Addr> } | null; mismatch: string[] }
const KINDS = ['cr', 'vat', 'address'] as const;
const EMPTY: Addr = { buildingNo: '', street: '', district: '', city: '', postalCode: '', additionalNo: '' };

const dictKeys: Record<string, true> = Object.fromEntries(['INCOMPLETE', 'COMPANY_LOCKED', 'LEGAL_FIELDS_LOCKED', 'CR_TAKEN', 'FILE_TOO_LARGE', 'UNSUPPORTED_FILE', 'VALIDATION_ERROR', 'BAD_STATE', 'EMPTY_FILE'].map((c) => [`err_${c}`, true]));
const MISSING: Record<string, Key> = { name: 'companyName', crNumber: 'cr', vatNumber: 'vat', nationalAddress: 'natAddr', sectors: 'sectors', 'doc:cr': 'doc_cr', 'doc:vat': 'doc_vat', 'doc:address': 'doc_address' };

export default function Company() {
  const { t } = useI18n();
  const lab = (ks: string[]) => ks.map((k) => (MISSING[k] ? t(MISSING[k]) : k)).join('، ');
  const { reload } = useAuth();
  const [p, setP] = useState<Profile | null>(null);
  const [form, setForm] = useState({ name: '', slug: '', description: '', logoUrl: '', coverUrl: '', whatsapp: '', primaryColor: '', crNumber: '', vatNumber: '', addr: EMPTY });
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [popup, setPopup] = useState<string[] | null>(null);

  const apply = useCallback((r: Profile) => {
    setP(r);
    setForm({ name: r.name, slug: r.slug ?? '', description: r.description ?? '', logoUrl: r.logoUrl ?? '', coverUrl: r.coverUrl ?? '', whatsapp: r.whatsapp ?? '', primaryColor: r.primaryColor ?? '', crNumber: r.crNumber ?? '', vatNumber: r.vatNumber ?? '', addr: r.nationalAddress ?? EMPTY });
  }, []);
  useEffect(() => { api<Profile>('/company').then(apply).catch(() => setError('Error')); }, [apply]);

  if (!p) return error ? <ErrorBox message={error} /> : <Skeleton rows={5} />;
  const editable = p.status === 'draft' || p.status === 'rejected' || p.status === 'approved';
  const locked = p.status === 'approved';
  const addrComplete = Object.values(form.addr).every(Boolean);
  const a = form.addr;
  const bad: Record<string, boolean> = {
    name: form.name.trim().length < 2, cr: !/^\d{10}$/.test(form.crNumber), vat: !/^3\d{13}3$/.test(form.vatNumber),
    building: !/^\d{4}$/.test(a.buildingNo), additional: !/^\d{4}$/.test(a.additionalNo), postal: !/^\d{5}$/.test(a.postalCode),
    street: a.street.trim().length < 2, district: a.district.trim().length < 2, city: a.city.trim().length < 2,
    doc_cr: !p.documents.some((d) => d.kind === 'cr'), doc_vat: !p.documents.some((d) => d.kind === 'vat'), doc_address: !p.documents.some((d) => d.kind === 'address'),
    sectors: p.sectorCodes.length < 1,
  };
  const red = (k: string) => (tried && bad[k] ? '!border-red-500 !ring-2 !ring-red-300' : '');
  const labelOf: Record<string, Key> = { name: 'companyName', cr: 'cr', vat: 'vat', building: 'building', additional: 'additional', postal: 'postal', street: 'street', district: 'district', city: 'city', doc_cr: 'doc_cr', doc_vat: 'doc_vat', doc_address: 'doc_address', sectors: 'sectors' };

  const act = async (fn: () => Promise<Profile>) => {
    setBusy(true); setError(''); setMsg('');
    try { apply(await fn()); await reload(); setMsg(t('saved')); } catch (e) { setPopup([e instanceof ApiError ? `${t((`err_${e.code}` in dictKeys ? `err_${e.code}` : 'err_VALIDATION_ERROR') as Key)}${Array.isArray((e.details as { missing?: string[] })?.missing) ? ': ' + lab((e.details as { missing: string[] }).missing) : ''}` : 'Error']); } finally { setBusy(false); }
  };
  const save = () => act(() => api<Profile>('/company', { method: 'PUT', body: {
    name: form.name, slug: form.slug, description: form.description || null, logoUrl: form.logoUrl.trim() || null, coverUrl: form.coverUrl.trim() || null, whatsapp: /^05\d{8}$/.test(form.whatsapp) ? form.whatsapp : null, primaryColor: form.primaryColor || null,
    ...(locked ? {} : { ...(form.crNumber ? { crNumber: form.crNumber } : {}), ...(form.vatNumber ? { vatNumber: form.vatNumber } : {}), ...(addrComplete ? { nationalAddress: form.addr } : {}) }),
  } }));
  const submit = () => {
    setTried(true);
    const problems = Object.keys(bad).filter((k) => bad[k] && k in labelOf).map((k) => `${t(labelOf[k])}: ${t('fieldBad')}`);
    if (problems.length) { setPopup([...problems, t('fixRed')]); return; }
    return act(async () => { await api('/company/submit', { method: 'POST' }); return api<Profile>('/company'); });
  };
  const upload = (kind: string, f: File | undefined) => {
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { setPopup([t('err_FILE_TOO_LARGE')]); return; }
    return act(async () => api<Profile>(`/company/documents/${kind}`, { method: 'PUT', body: { fileName: f.name, dataBase64: await fileToBase64(f) } }));
  };
  const useExtracted = (d: Doc) => {
    const x = d.extracted;
    if (!x) return;
    setForm((f) => ({ ...f, crNumber: x.crNumber ?? f.crNumber, vatNumber: x.vatNumber ?? f.vatNumber, addr: { ...f.addr, ...(x.nationalAddress ?? {}) } }));
  };
  const docsOpen = p.status === 'draft' || p.status === 'rejected';
  const setA = (k: keyof Addr) => (e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, addr: { ...form.addr, [k]: e.target.value } });

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">{t('company')}</h1>
        <span className="rounded-full bg-slate-200 px-3 py-1 text-xs dark:bg-slate-800">{t(`st_${p.status}` as Key)}</span>
      </div>
      {p.status === 'pending_review' && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">{t('pendingNote')}</p>}
      {p.status === 'rejected' && p.reviewNote && <ErrorBox message={`${t('rejectionReason')}: ${p.reviewNote}`} />}
      {p.status === 'draft' && p.missing.length > 0 && <p className="text-sm text-slate-500">{t('missingFields')}: {lab(p.missing)}</p>}
      {locked && <p className="text-xs text-slate-500">{t('lockedNote')}</p>}
      {error && <ErrorBox message={error} />}
      {msg && <p className="text-sm text-green-700">{msg}</p>}
      <section className="space-y-3 rounded-2xl bg-white p-4 shadow dark:bg-slate-900">
        <div><h2 className="font-semibold">{t('docs')}</h2><p className="text-xs text-slate-500">{t('docsHint')}</p></div>
        {KINDS.map((k) => {
          const d = p.documents.find((x) => x.kind === k);
          const needsFill = d?.extracted && !(k === 'cr' ? form.crNumber : k === 'vat' ? form.vatNumber : form.addr.buildingNo);
          return (
            <div key={k} className={`rounded-xl border p-3 ${tried && bad[`doc_${k}`] ? 'border-red-500 bg-red-50 dark:bg-red-950/30' : 'border-slate-200 dark:border-slate-700'}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0"><div className="text-sm font-medium">{t(`doc_${k}` as Key)}</div>
                  <div className="truncate text-xs text-slate-500" dir="ltr">{d ? d.fileName : t('docMissing')}</div></div>
                <div className="flex gap-2">
                  {d && <Button variant="ghost" onClick={() => openFile(`/company/documents/${k}/file`).catch(() => setError('Error'))}>{t('viewFile')}</Button>}
                  {docsOpen && <label className="cursor-pointer rounded-lg bg-cyan-700 px-3 py-2 text-sm font-medium text-white hover:bg-cyan-800">
                    {d ? t('replaceFile') : t('upload')}
                    <input type="file" className="sr-only" accept="application/pdf,image/png,image/jpeg,image/webp" disabled={busy} onChange={(e) => { void upload(k, e.target.files?.[0]); e.target.value = ''; }} />
                  </label>}
                </div>
              </div>
              {d?.extracted && (needsFill || d.mismatch.length > 0) && docsOpen && (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                  {d.mismatch.length > 0 && <span>{t('fileMismatch')}</span>}
                  <button type="button" className="font-semibold underline" onClick={() => useExtracted(d)}>{t('applyExtracted')}</button>
                </div>
              )}
            </div>
          );
        })}
      </section>
      <fieldset disabled={!editable || busy} className="space-y-3 rounded-2xl bg-white p-4 shadow dark:bg-slate-900">
        <Field label={t('companyName')}><Input className={red('name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label={t('slugLabel')}><Input dir="ltr" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })} /></Field>
        <Field label={t('description')}><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <Field label={t('logoUrl').replace(/^رابط |\s*URL|\s*\(https\)/g, '')}><ImageUpload value={form.logoUrl} onChange={(u) => setForm({ ...form, logoUrl: u })} round /></Field>
        <Field label={t('coverUrl').replace(/^رابط |\s*URL|\s*\(https\)/g, '')}><ImageUpload value={form.coverUrl} onChange={(u) => setForm({ ...form, coverUrl: u })} /></Field>
        <Field label={t('whatsappLbl')}><Input dir="ltr" inputMode="numeric" placeholder="05XXXXXXXX" maxLength={10} value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} /></Field>
        <Field label={t('brandColor')}><Input type="color" value={form.primaryColor || '#0f3f8f'} onChange={(e) => setForm({ ...form, primaryColor: e.target.value })} /></Field>
        <Field label={t('cr')}><Input className={red('cr')} dir="ltr" inputMode="numeric" disabled={locked} value={form.crNumber} onChange={(e) => setForm({ ...form, crNumber: e.target.value })} /></Field>
        <Field label={t('vat')}><Input className={red('vat')} dir="ltr" inputMode="numeric" disabled={locked} value={form.vatNumber} onChange={(e) => setForm({ ...form, vatNumber: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <p className="col-span-2 text-sm font-medium">{t('natAddr')}</p>
          <Field label={t('building')}><Input className={red('building')} disabled={locked} inputMode="numeric" maxLength={4} value={form.addr.buildingNo} onChange={setA('buildingNo')} /></Field>
          <Field label={t('additional')}><Input className={red('additional')} disabled={locked} inputMode="numeric" maxLength={4} value={form.addr.additionalNo} onChange={setA('additionalNo')} /></Field>
          <Field label={t('street')}><Input className={red('street')} disabled={locked} value={form.addr.street} onChange={setA('street')} /></Field>
          <Field label={t('district')}><Input className={red('district')} disabled={locked} value={form.addr.district} onChange={setA('district')} /></Field>
          <Field label={t('city')}><Input className={red('city')} disabled={locked} value={form.addr.city} onChange={setA('city')} /></Field>
          <Field label={t('postal')}><Input className={red('postal')} disabled={locked} inputMode="numeric" maxLength={5} value={form.addr.postalCode} onChange={setA('postalCode')} /></Field>
        </div>
      </fieldset>
      <div className="flex gap-2">
        {editable && <Button variant="ghost" onClick={save} disabled={busy}>{t('save')}</Button>}
        {(p.status === 'draft' || p.status === 'rejected') && <Button onClick={submit} disabled={busy}>{t('submitReview')}</Button>}
      </div>
      {popup && (
        <Modal title={t('popupTitle')} onClose={() => setPopup(null)}>
          <ul className="list-disc space-y-1.5 ps-5 text-sm">{popup.map((m, i) => <li key={i}>{m}</li>)}</ul>
          <div className="mt-5 flex justify-end"><Button onClick={() => setPopup(null)}>{t('okBtn')}</Button></div>
        </Modal>
      )}
    </div>
  );
}
