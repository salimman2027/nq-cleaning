import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { useI18n } from '../i18n';
import { Button, ErrorBox, Field, Input, Modal, Select, Skeleton } from '../ui';

interface Tech { Id: number; Code: string; FullName: string; Status: string; SupervisorId: number | null }
interface Sup { Id: number; FullName: string; Mobile: string | null; BranchId: number; MaxBookingsPerDay: number; technicians: Tech[] }

/** Who supervises whom. Moving a technician changes their usual supervisor; each booking can still pick any supervisor. */
export default function Supervisors() {
  const { t } = useI18n();
  const { can, me } = useAuth();
  const [data, setData] = useState<{ items: Sup[]; unassigned: Tech[] } | null>(null);
  const [err, setErr] = useState('');
  const [adding, setAdding] = useState(false);
  const load = useCallback(() => { api<{ items: Sup[]; unassigned: Tech[] }>('/supervisors').then(setData).catch((e: Error) => setErr(e.message)); }, []);
  useEffect(load, [load]);
  const manage = can('technicians.manage');
  const move = async (techId: number, v: string) => { try { await api(`/supervisors/technician/${techId}`, { method: 'PUT', body: { supervisorId: v ? Number(v) : null } }); load(); } catch (e) { setErr((e as Error).message); } };
  const remove = async (s: Sup) => { if (!window.confirm(`${t('removeSupervisor')}: ${s.FullName}?`)) return; try { await api(`/supervisors/${s.Id}`, { method: 'DELETE' }); load(); } catch (e) { setErr((e as Error).message); } };
  const picker = (techId: number, cur: number | null) => manage && data ? (
    <Select value={cur ?? ''} onChange={(e) => move(techId, e.target.value)} aria-label={t('moveTo')}><option value="">{t('noSupervisor')}</option>{data.items.map((x) => <option key={x.Id} value={x.Id}>{x.FullName}</option>)}</Select>
  ) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><h1 className="text-xl font-bold">{t('supervisors')}</h1>{manage && <div className="flex gap-2"><Button variant="ghost" onClick={async () => { try { await api('/supervisors/test-team', { method: 'POST' }); load(); } catch (e) { setErr(e instanceof Error ? e.message : 'Error'); } }}>{t('createTestTeam')}</Button><Button onClick={() => setAdding(true)}>+ {t('supervisor')}</Button></div>}</div>
      {err && <ErrorBox message={err} />}
      {!data ? <Skeleton rows={4} /> : (
        <>
          {data.items.length === 0 && <p className="rounded-xl border border-dashed p-6 text-center text-slate-500 dark:border-slate-700">{t('noSupervisors')}</p>}
          <div className="grid gap-3 md:grid-cols-2">
            {data.items.map((s) => (
              <section key={s.Id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
                <div className="flex items-start justify-between gap-2">
                  <div><div className="font-bold">{s.FullName}</div><div className="text-xs text-slate-500" dir="ltr">{s.Mobile ?? '—'} · {t('maxPerDay')}: {s.MaxBookingsPerDay}</div></div>
                  {manage && <Button variant="ghost" onClick={() => remove(s)}>{t('remove')}</Button>}
                </div>
                <div className="mt-3 text-xs font-medium text-slate-500">{t('technicians')} ({s.technicians.length})</div>
                <ul className="mt-1 space-y-1.5">
                  {s.technicians.length === 0 && <li className="text-sm text-slate-400">—</li>}
                  {s.technicians.map((x) => <li key={x.Id} className="flex items-center justify-between gap-2 text-sm"><span>{x.FullName}</span><span className="w-40">{picker(x.Id, x.SupervisorId)}</span></li>)}
                </ul>
              </section>
            ))}
          </div>
          {data.unassigned.length > 0 && (
            <section className="rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200 dark:bg-slate-900 dark:ring-slate-700">
              <div className="mb-2 font-semibold">{t('noSupervisor')} ({data.unassigned.length})</div>
              <ul className="space-y-1.5">{data.unassigned.map((x) => <li key={x.Id} className="flex items-center justify-between gap-2 text-sm"><span>{x.FullName}</span><span className="w-40">{picker(x.Id, null)}</span></li>)}</ul>
            </section>
          )}
        </>
      )}
      {adding && <NewSup branchId={me?.BranchId ?? null} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
    </div>
  );
}

function NewSup({ branchId, onClose, onSaved }: { branchId: number | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [f, setF] = useState({ fullName: '', mobile: '', branchId: branchId ? String(branchId) : '', max: '10' });
  const [branches, setBranches] = useState<{ Id: number; Name: string }[]>([]);
  const [err, setErr] = useState('');
  useEffect(() => { api<{ items: { Id: number; Name: string }[] }>('/branches').then((r) => { setBranches(r.items); setF((p) => (p.branchId || r.items.length !== 1 ? p : { ...p, branchId: String(r.items[0].Id) })); }).catch(() => undefined); }, []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try { await api('/supervisors', { method: 'POST', body: { fullName: f.fullName, mobile: f.mobile || undefined, branchId: Number(f.branchId), maxBookingsPerDay: Number(f.max) } }); onSaved(); } catch (ex) { setErr(ex instanceof ApiError ? ex.message : 'Error'); }
  };
  return (
    <Modal title={t('supervisor')} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label={t('name')}><Input required minLength={2} value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Field>
        <Field label={t('mobile')}><Input dir="ltr" value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} /></Field>
        <Field label={t('branch')}><Select required value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}><option value="" />{branches.map((b) => <option key={b.Id} value={b.Id}>{b.Name}</option>)}</Select></Field>
        <Field label={t('maxPerDay')}><Input type="number" min={1} max={100} value={f.max} onChange={(e) => setF({ ...f, max: e.target.value })} /></Field>
        {err && <div className="sm:col-span-2"><ErrorBox message={err} /></div>}
        <div className="flex gap-2 sm:col-span-2"><Button type="submit">{t('save')}</Button><Button type="button" variant="ghost" onClick={onClose}>{t('cancel')}</Button></div>
      </form>
    </Modal>
  );
}
