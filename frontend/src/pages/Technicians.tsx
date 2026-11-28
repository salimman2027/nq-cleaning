import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, fileToBase64, openFile } from '../api';
import { useAuth } from '../auth';
import { useI18n } from '../i18n';
import { Button, ErrorBox, Field, Input, Modal, Select, Skeleton } from '../ui';

interface Tech { SupervisorId: number | null; Id: number; Code: string; FullName: string; Mobile: string | null; BranchId: number; Status: string; IqamaNumber?: string | null; HasIqamaPhoto?: boolean }
const STATUS = ['available', 'booked', 'on_the_way', 'working', 'break', 'absent', 'leave', 'off_duty'];

export default function Technicians() {
  const { t } = useI18n();
  const { can, me } = useAuth();
  const [rows, setRows] = useState<Tech[] | null>(null);
  const [err, setErr] = useState('');
  const [adding, setAdding] = useState(false);
  const [iq, setIq] = useState<Tech | null>(null);
  const [sups, setSups] = useState<{ Id: number; FullName: string }[]>([]);
  useEffect(() => { api<{ items: { Id: number; FullName: string }[] }>('/supervisors').then((r) => setSups(r.items)).catch(() => undefined); }, []);
  const setSup = async (id: number, v: string) => { try { await api(`/supervisors/technician/${id}`, { method: 'PUT', body: { supervisorId: v ? Number(v) : null } }); load(); } catch (e) { setErr((e as Error).message); } };
  const load = useCallback(() => { api<{ items: Tech[] }>('/technicians').then((r) => setRows(r.items)).catch((e: Error) => setErr(e.message)); }, []);
  useEffect(load, [load]);

  const setStatus = async (id: number, status: string) => {
    try { await api(`/technicians/${id}/status`, { method: 'PATCH', body: { status } }); load(); } catch (e) { setErr((e as Error).message); }
  };

  return (
    <div className="space-y-4">
      {can('technicians.manage') && <Button onClick={() => setAdding(true)}>+ {t('technicians')}</Button>}
      {err && <ErrorBox message={err} />}
      {!rows ? <Skeleton /> : rows.length === 0 ? <p className="text-slate-500">{t('noData')}</p> : (
        <div className="overflow-x-auto rounded-xl bg-white dark:bg-slate-900">
          <table className="w-full text-sm">
            <thead className="text-slate-500"><tr>{[t('code'), t('name'), t('mobile'), t('supervisor'), t('status'), t('iqama')].map((h) => <th key={h} className="p-3 text-start">{h}</th>)}</tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.Id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="p-3">{r.Code}</td><td className="p-3">{r.FullName}</td><td className="p-3" dir="ltr">{r.Mobile ?? '—'}</td>
                <td className="p-3">{can('technicians.manage') ? <Select value={r.SupervisorId ?? ''} onChange={(e) => setSup(r.Id, e.target.value)}><option value="">—</option>{sups.map((x) => <option key={x.Id} value={x.Id}>{x.FullName}</option>)}</Select> : (sups.find((x) => x.Id === r.SupervisorId)?.FullName ?? '—')}</td>
                <td className="p-3">{can('technicians.manage') ? <Select value={r.Status} onChange={(e) => setStatus(r.Id, e.target.value)}>{STATUS.map((s) => <option key={s}>{s}</option>)}</Select> : r.Status}</td>
                <td className="p-3 whitespace-nowrap"><button type="button" onClick={() => setIq(r)} className="underline"><span dir="ltr">{r.IqamaNumber ?? '—'}</span> {r.HasIqamaPhoto ? '🪪' : ''}</button></td>
              </tr>))}
            </tbody>
          </table>
        </div>
      )}
      {iq && <IqamaModal tech={iq} canEdit={can('technicians.manage')} onClose={() => setIq(null)} onSaved={() => { setIq(null); load(); }} />}
      {adding && <NewTech branchId={me?.BranchId ?? null} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
    </div>
  );
}

function NewTech({ branchId, onClose, onSaved }: { branchId: number | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [f, setF] = useState({ fullName: '', mobile: '', branchId: branchId ? String(branchId) : '', hourlyCost: '0' });
  const [err, setErr] = useState('');
  const [branches, setBranches] = useState<{ Id: number; Name: string }[]>([]);
  useEffect(() => {
    api<{ items: { Id: number; Name: string }[] }>('/branches').then((r) => {
      setBranches(r.items);
      setF((p) => (p.branchId || r.items.length !== 1 ? p : { ...p, branchId: String(r.items[0].Id) }));
    }).catch(() => undefined);
  }, []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api('/technicians', { method: 'POST', body: { fullName: f.fullName, mobile: f.mobile || undefined, branchId: Number(f.branchId), hourlyCost: Number(f.hourlyCost) } });
      onSaved();
    } catch (ex) { setErr(ex instanceof ApiError ? ex.message : 'Error'); }
  };
  return (
    <Modal title={t('technicians')} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label={t('name')}><Input required value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Field>
        <Field label={t('mobile')}><Input dir="ltr" value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} /></Field>
        <Field label={t('branch')}><Select required value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}><option value="" />{branches.map((b) => <option key={b.Id} value={b.Id}>{b.Name}</option>)}</Select></Field>
        <Field label="Hourly cost"><Input type="number" min={0} step="0.01" value={f.hourlyCost} onChange={(e) => setF({ ...f, hourlyCost: e.target.value })} /></Field>
        {err && <div className="sm:col-span-2"><ErrorBox message={err} /></div>}
        <div className="flex gap-2 sm:col-span-2"><Button type="submit">{t('save')}</Button><Button type="button" variant="ghost" onClick={onClose}>{t('cancel')}</Button></div>
      </form>
    </Modal>
  );
}

/** Residence ID of one technician: the number and a private photo. */
function IqamaModal({ tech, canEdit, onClose, onSaved }: { tech: Tech; canEdit: boolean; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [num, setNum] = useState(tech.IqamaNumber ?? '');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const saveNum = async () => { try { await api(`/technicians/${tech.Id}/iqama`, { method: 'PUT', body: { number: num } }); onSaved(); } catch (e) { setErr(e instanceof ApiError ? t('iqamaBad') : 'Error'); } };
  const upload = async (f?: File) => {
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { setErr(t('imgTooBig')); return; }
    setBusy(true);
    try { await api(`/technicians/${tech.Id}/iqama-photo`, { method: 'POST', body: { dataBase64: await fileToBase64(f) } }); onSaved(); } catch { setErr(t('imgFail')); } finally { setBusy(false); }
  };
  const remove = async () => { if (!window.confirm(t('deleteFileQ'))) return; try { await api(`/technicians/${tech.Id}/iqama-photo`, { method: 'DELETE' }); onSaved(); } catch { setErr('Error'); } };
  return (
    <Modal title={`${t('iqama')}: ${tech.FullName}`} onClose={onClose}>
      <div className="space-y-3">
        {err && <ErrorBox message={err} />}
        <Field label={t('iqamaNumber')}><Input dir="ltr" inputMode="numeric" maxLength={10} disabled={!canEdit} value={num} onChange={(e) => setNum(e.target.value.replace(/\D/g, ''))} /></Field>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && <Button disabled={num === (tech.IqamaNumber ?? '')} onClick={() => void saveNum()}>{t('save')}</Button>}
          {tech.HasIqamaPhoto && <Button variant="ghost" onClick={() => void openFile(`/technicians/${tech.Id}/iqama-photo`).catch(() => setErr('Error'))}>{t('viewPhoto')}</Button>}
          {canEdit && <label className="cursor-pointer rounded-lg bg-cyan-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-800">{busy ? t('loading') : tech.HasIqamaPhoto ? t('replaceFile') : `📎 ${t('uploadIqama')}`}<input type="file" className="sr-only" accept="image/png,image/jpeg,image/webp,application/pdf" disabled={busy} onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} /></label>}
          {canEdit && tech.HasIqamaPhoto && <button type="button" onClick={() => void remove()} className="text-sm text-red-600 underline">{t('removeImage')}</button>}
        </div>
        <p className="text-xs text-slate-500">{t('iqamaPrivate')}</p>
      </div>
    </Modal>
  );
}
