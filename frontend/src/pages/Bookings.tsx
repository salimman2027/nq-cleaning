import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ApiError, fileToBase64, openFile } from '../api';
import { useAuth } from '../auth';
import { STATUS_LABEL, useI18n } from '../i18n';
import { StageLog } from './Field';
import { Button, dateTime, ErrorBox, Field, Input, Modal, money, Select, Skeleton } from '../ui';

interface Row { Id: number; BookingNo: string; Status: string; StartAt: string; EndAt: string; Total: number; Paid: number; CustomerName: string; CustomerMobile: string; TechnicianCount: number }
interface Detail extends Row {
  SupervisorId: number | null;
  TeamNotes?: string | null; stageEvents?: { Id: number; Stage: 'depart' | 'arrive' | 'start' | 'progress' | 'finish' | 'cash' | 'next'; Note: string | null; Amount: number | null; CreatedAt: string; ByName: string | null; Files: { Id: number; Kind: string; FileName: string }[] }[]; teamFiles?: { Id: number; FileName: string }[];
  Notes: string | null; City: string | null; District: string | null; Street: string | null; MapUrl: string | null;
  lines: { Id: number; ServiceName: string; Quantity: number; UnitPrice: number; LineTotal: number }[];
  assignments: { Id: number; TechnicianId: number; FullName: string; IsActive: boolean }[];
  history: { FromStatus: string | null; ToStatus: string; Reason: string | null; ChangedByName: string | null; ChangedAt: string }[];
}

// Mirrors backend/src/lib/transitions.ts; the server is the authority and re-validates every change.
const NEXT: Record<string, string[]> = {
  new: ['awaiting_confirmation', 'confirmed', 'cancelled', 'postponed'], awaiting_confirmation: ['confirmed', 'cancelled', 'postponed'],
  confirmed: ['awaiting_assignment', 'assigned', 'cancelled', 'postponed'], awaiting_assignment: ['assigned', 'cancelled', 'postponed'],
  assigned: ['on_the_way', 'awaiting_assignment', 'cancelled', 'postponed'], on_the_way: ['arrived', 'cancelled'], arrived: ['in_progress', 'cancelled'],
  in_progress: ['paused', 'awaiting_review'], paused: ['in_progress', 'cancelled'], awaiting_review: ['done', 'redo', 'in_progress'], done: ['closed', 'redo'],
  redo: ['assigned', 'awaiting_assignment', 'cancelled'], postponed: ['confirmed', 'awaiting_assignment', 'cancelled'], closed: [], cancelled: [],
};
const NEEDS_REASON = ['cancelled', 'postponed', 'redo', 'paused'];

export function useStatusLabel() {
  const { lang } = useI18n();
  return (s: string) => STATUS_LABEL[s]?.[lang] ?? s;
}

export default function Bookings() {
  const { t, lang } = useI18n();
  const { can } = useAuth();
  const label = useStatusLabel();
  const [sp, setSp] = useSearchParams();
  const status = sp.get('status') ?? '';
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState('');
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);

  const load = useCallback(() => {
    api<{ items: Row[] }>(`/bookings?pageSize=50${status ? `&status=${status}` : ''}`).then((r) => { setRows(r.items); setErr(''); }).catch((e: Error) => setErr(e.message));
  }, [status]);
  useEffect(load, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Select className="!w-auto" value={status} onChange={(e) => setSp(e.target.value ? { status: e.target.value } : {})}>
          <option value="">{t('allStatuses')}</option>
          {Object.keys(STATUS_LABEL).map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </Select>
        {can('bookings.create') && <Button onClick={() => setAdding(true)}>{t('newBooking')}</Button>}
      </div>
      {err && <ErrorBox message={err} />}
      {!rows ? <Skeleton /> : rows.length === 0 ? <p className="text-slate-500">{t('noData')}</p> : (
        <div className="overflow-x-auto rounded-xl bg-white dark:bg-slate-900">
          <table className="w-full text-sm">
            <thead className="text-slate-500"><tr>{['#', t('customer'), t('date'), t('status'), t('total')].map((h) => <th key={h} className="p-3 text-start">{h}</th>)}</tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.Id} onClick={() => setOpenId(r.Id)} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800">
                <td className="p-3">{r.BookingNo}</td><td className="p-3">{r.CustomerName}</td><td className="p-3">{dateTime(r.StartAt, lang)}</td>
                <td className="p-3">{label(r.Status)}</td><td className="p-3">{money(r.Total, lang)}</td>
              </tr>))}
            </tbody>
          </table>
        </div>
      )}
      {adding && <NewBooking onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
      {openId !== null && <BookingDetail id={openId} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
}

function BookingDetail({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { t, lang } = useI18n();
  const { can } = useAuth();
  const label = useStatusLabel();
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => { api<Detail>(`/bookings/${id}`).then(setD).catch((e: Error) => setErr(e.message)); }, [id]);
  useEffect(load, [load]);

  const change = async (status: string) => {
    let reason: string | undefined;
    if (NEEDS_REASON.includes(status)) {
      reason = window.prompt(t('reason')) ?? '';
      if (!reason.trim()) return;
    }
    try { await api(`/bookings/${id}/status`, { method: 'POST', body: { status, reason } }); setErr(''); load(); onChanged(); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Error'); }
  };

  return (
    <Modal title={d ? d.BookingNo : t('loading')} onClose={onClose}>
      {err && <ErrorBox message={err} />}
      {!d ? <Skeleton rows={3} /> : (
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <div><div className="text-slate-500">{t('customer')}</div>{d.CustomerName} <span dir="ltr">{d.CustomerMobile}</span></div>
            <div><div className="text-slate-500">{t('status')}</div>{label(d.Status)}</div>
            <div><div className="text-slate-500">{t('date')}</div>{dateTime(d.StartAt, lang)}</div>
            <div><div className="text-slate-500">{t('total')}</div>{money(d.Total, lang)}</div>
            <div className="col-span-2"><div className="text-slate-500">{t('address')}</div>{[d.City, d.District, d.Street].filter(Boolean).join(' - ') || '—'}{d.MapUrl && <> · <a className="text-cyan-700 underline" href={d.MapUrl} target="_blank" rel="noreferrer">Maps</a></>}</div>
          </div>
          <div>
            <div className="mb-1 font-semibold">{t('services')}</div>
            {d.lines.map((l) => <div key={l.Id} className="flex justify-between"><span>{l.ServiceName} × {l.Quantity}</span><span>{money(l.LineTotal, lang)}</span></div>)}
          </div>
          <div>
            <div className="mb-1 font-semibold">{t('assigned')}</div>
            {d.assignments.filter((a) => a.IsActive).map((a) => <div key={a.Id}>{a.FullName}</div>)}
            {d.assignments.every((a) => !a.IsActive) && <span className="text-slate-500">—</span>}
          </div>
          {can('bookings.assign') && !['closed', 'cancelled'].includes(d.Status) && !['new', 'confirmed', 'awaiting_assignment', 'assigned', 'redo'].includes(d.Status) && <SupervisorPicker booking={d} onDone={() => { load(); onChanged(); }} onError={setErr} />}
          {can('bookings.assign') && ['new', 'confirmed', 'awaiting_assignment', 'assigned', 'redo'].includes(d.Status) && <AssignPanel booking={d} onDone={() => { load(); onChanged(); }} onError={setErr} />}
          {can('bookings.assign') && !['closed', 'cancelled'].includes(d.Status) && <TeamPanel booking={d} onDone={() => { load(); }} onError={setErr} />}
          {(d.stageEvents?.length ?? 0) > 0 && <StageLog bookingId={d.Id} events={d.stageEvents!} />}
          {can('bookings.status') && NEXT[d.Status]?.length > 0 && (
            <div className="flex flex-wrap gap-2">{NEXT[d.Status].map((s) => <Button key={s} variant={s === 'cancelled' ? 'danger' : 'ghost'} onClick={() => change(s)}>{label(s)}</Button>)}</div>
          )}
          <div>
            <div className="mb-1 font-semibold">{t('history')}</div>
            {d.history.map((h, i) => <div key={i} className="text-slate-600 dark:text-slate-300">{dateTime(h.ChangedAt, lang)} · {label(h.ToStatus)}{h.Reason ? ` (${h.Reason})` : ''} · {h.ChangedByName ?? ''}</div>)}
          </div>
        </div>
      )}
    </Modal>
  );
}

function AssignPanel({ booking, onDone, onError }: { booking: Detail; onDone: () => void; onError: (m: string) => void }) {
  const { t } = useI18n();
  const [techs, setTechs] = useState<{ Id: number; FullName: string; SupervisorId?: number | null; IqamaNumber?: string | null; HasIqamaPhoto?: boolean }[]>([]);
  const [manual, setManual] = useState(false);
  const [chosen, setChosen] = useState<number[]>([]);
  const [find, setFind] = useState('');
  const [sups, setSups] = useState<{ Id: number; FullName: string }[]>([]);
  const [supId, setSupId] = useState<string>(booking.SupervisorId ? String(booking.SupervisorId) : '');
  const [count, setCount] = useState(Math.max(1, booking.assignments.filter((a) => a.IsActive).length));
  useEffect(() => { api<{ items: { Id: number; FullName: string }[] }>('/supervisors').then((r) => setSups(r.items)).catch(() => undefined); }, []);
  useEffect(() => {
    // Technicians already on this booking are not "available" for their own slot, so list them too.
    api<{ items: { Id: number; FullName: string; SupervisorId?: number | null }[] }>(`/technicians/available?start=${encodeURIComponent(booking.StartAt)}&end=${encodeURIComponent(booking.EndAt)}`)
      .then((r) => setTechs([...booking.assignments.filter((a) => a.IsActive).map((a) => ({ Id: a.TechnicianId, FullName: a.FullName, SupervisorId: undefined as number | null | undefined })), ...r.items]))
      .catch((e: Error) => onError(e.message));
  }, [booking, onError]);
  // The manager only says how many technicians are needed; the system picks free ones: current crew first, then the supervisor's team, then the rest.
  const pickIds = () => {
    const current = new Set(booking.assignments.filter((a) => a.IsActive).map((a) => a.TechnicianId));
    const rank = (x: { Id: number; SupervisorId?: number | null }) => (current.has(x.Id) ? 0 : supId && String(x.SupervisorId) === supId ? 1 : 2);
    if (manual) return chosen;
    return [...techs].sort((x, y) => rank(x) - rank(y)).slice(0, count).map((x) => x.Id);
  };
  const save = async () => {
    const sel = pickIds();
    if (manual ? sel.length === 0 : sel.length < count) { onError(`${t('notEnoughTechs')} (${techs.length})`); return; }
    try { await api(`/bookings/${booking.Id}/assign`, { method: 'POST', body: { technicianIds: sel, supervisorId: supId ? Number(supId) : null } }); onDone(); } catch (e) { onError(e instanceof ApiError ? e.message : 'Error'); }
  };
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-semibold">{t('supervisor')}</span>
        <select className="rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-600 dark:bg-slate-800" value={supId} onChange={(e) => setSupId(e.target.value)}>
          <option value="">—</option>{sups.map((x) => <option key={x.Id} value={x.Id}>{x.FullName}</option>)}
        </select>
      </div>
      <label className="mb-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)} />{t('pickManually')}</label>
      {manual && (
        <div className="mb-2 space-y-2">
          <input value={find} onChange={(e) => setFind(e.target.value)} placeholder={t('searchTech')} className="w-full max-w-xs rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-600 dark:bg-slate-800" />
          <ul className="max-h-52 space-y-1 overflow-y-auto">
            {techs.filter((x) => !find || x.FullName.includes(find) || (x.IqamaNumber ?? '').includes(find)).map((x) => (
              <li key={x.Id} className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1"><input type="checkbox" checked={chosen.includes(x.Id)} onChange={(e) => setChosen(e.target.checked ? [...chosen, x.Id] : chosen.filter((i) => i !== x.Id))} />{x.FullName}</label>
                <span dir="ltr" className="text-xs text-slate-500">{x.IqamaNumber ?? ''}</span>
                {x.HasIqamaPhoto && <button type="button" className="text-xs underline" onClick={() => void openFile(`/technicians/${x.Id}/iqama-photo`).catch(() => onError('Error'))}>🪪 {t('viewPhoto')}</button>}
              </li>))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {!manual && <label className="font-semibold" htmlFor="techCount">{t('techCount')}</label>}
        {!manual && <input id="techCount" type="number" min={1} max={30} dir="ltr" value={count} onChange={(e) => setCount(Math.max(1, Math.min(30, Number(e.target.value) || 1)))} className="w-20 rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-600 dark:bg-slate-800" />}
        <span className="text-xs text-slate-500">{t('availableNow')}: {techs.length}</span>
        <Button disabled={techs.length === 0} onClick={save}>{t('apply')}</Button>
      </div>
    </div>
  );
}

/** Notes for the crew's names, plus private copies of their residence IDs (shown only to staff who can assign). */
function TeamPanel({ booking, onDone, onError }: { booking: Detail; onDone: () => void; onError: (m: string) => void }) {
  const { t } = useI18n();
  const [notes, setNotes] = useState(booking.TeamNotes ?? '');
  const [busy, setBusy] = useState(false);
  const saveNotes = async () => { try { await api(`/bookings/${booking.Id}/team-notes`, { method: 'PUT', body: { notes } }); onDone(); } catch { onError('Error'); } };
  const upload = async (f?: File) => {
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { onError(t('imgTooBig')); return; }
    setBusy(true);
    try { await api(`/bookings/${booking.Id}/team-files`, { method: 'POST', body: { fileName: f.name, dataBase64: await fileToBase64(f) } }); onDone(); } catch (e) { onError(e instanceof ApiError ? e.message : 'Error'); } finally { setBusy(false); }
  };
  const remove = async (id: number) => { if (!window.confirm(t('deleteFileQ'))) return; try { await api(`/bookings/${booking.Id}/team-files/${id}`, { method: 'DELETE' }); onDone(); } catch { onError('Error'); } };
  return (
    <div className="space-y-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
      <div className="font-semibold">{t('teamNotes')}</div>
      <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('teamNotesPh')} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800" />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" disabled={notes === (booking.TeamNotes ?? '')} onClick={() => void saveNotes()}>{t('save')}</Button>
        <label className="cursor-pointer rounded-lg bg-cyan-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-800">{busy ? t('loading') : `📎 ${t('uploadIqama')}`}
          <input type="file" className="sr-only" accept="image/png,image/jpeg,image/webp,application/pdf" disabled={busy} onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} /></label>
        <span className="text-xs text-slate-500">{t('iqamaPrivate')}</span>
      </div>
      {(booking.teamFiles ?? []).length > 0 && (
        <ul className="flex flex-wrap gap-2">{booking.teamFiles!.map((f) => (
          <li key={f.Id} className="flex items-center gap-2 rounded-lg bg-slate-100 px-2 py-1 text-sm dark:bg-slate-800">
            <button type="button" className="max-w-[12rem] truncate underline" onClick={() => void openFile(`/bookings/${booking.Id}/team-files/${f.Id}`).catch(() => onError('Error'))}>{f.FileName}</button>
            <button type="button" aria-label={t('removeImage')} className="text-red-600" onClick={() => void remove(f.Id)}>✕</button>
          </li>))}
        </ul>
      )}
    </div>
  );
}

function SupervisorPicker({ booking, onDone, onError }: { booking: Detail; onDone: () => void; onError: (m: string) => void }) {
  const { t } = useI18n();
  const [sups, setSups] = useState<{ Id: number; FullName: string }[]>([]);
  const [v, setV] = useState(booking.SupervisorId ? String(booking.SupervisorId) : '');
  useEffect(() => { api<{ items: { Id: number; FullName: string }[] }>('/supervisors').then((r) => setSups(r.items)).catch(() => undefined); }, []);
  const save = async () => {
    try { await api(`/bookings/${booking.Id}/supervisor`, { method: 'POST', body: { supervisorId: v ? Number(v) : null } }); onDone(); } catch (e) { onError(e instanceof ApiError ? e.message : 'Error'); }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-semibold">{t('supervisor')}</span>
      <select className="rounded-lg border border-slate-300 bg-white px-2 py-1 dark:border-slate-600 dark:bg-slate-800" value={v} onChange={(e) => setV(e.target.value)}>
        <option value="">—</option>{sups.map((x) => <option key={x.Id} value={x.Id}>{x.FullName}</option>)}
      </select>
      <Button variant="ghost" disabled={v === (booking.SupervisorId ? String(booking.SupervisorId) : '')} onClick={save}>{t('changeSupervisor')}</Button>
    </div>
  );
}

interface Svc { Id: number; Name: string; DefaultMinutes: number; CurrentPrice: number | null }
interface Cust { Id: number; Name: string; Mobile: string; Code: string }

function NewBooking({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t, lang } = useI18n();
  const { can, me } = useAuth();
  const key = useRef(typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Cust[]>([]);
  const [cust, setCust] = useState<Cust | null>(null);
  const [addresses, setAddresses] = useState<{ Id: number; City: string | null; District: string | null; Street: string | null }[]>([]);
  const [addressId, setAddressId] = useState('');
  const [services, setServices] = useState<Svc[]>([]);
  const [lines, setLines] = useState<{ serviceId: string; quantity: string }[]>([{ serviceId: '', quantity: '1' }]);
  const [branches, setBranches] = useState<{ Id: number; Name: string }[]>([]);
  const [branchId, setBranchId] = useState(me?.BranchId ? String(me.BranchId) : '');
  const [start, setStart] = useState('');
  const [minutes, setMinutes] = useState('120');
  const [techs, setTechs] = useState<{ Id: number; FullName: string }[]>([]);
  const [sel, setSel] = useState<number[]>([]);
  const [discount, setDiscount] = useState('0');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ items: Svc[] }>('/services').then((r) => setServices(r.items)).catch((e: Error) => setErr(e.message));
    api<{ items: { Id: number; Name: string }[] }>('/branches').then((r) => { setBranches(r.items); if (!branchId && r.items.length === 1) setBranchId(String(r.items[0].Id)); }).catch(() => undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) { setFound([]); return; }
    const id = setTimeout(() => { api<{ items: Cust[] }>(`/customers?q=${encodeURIComponent(q)}&pageSize=5`).then((r) => setFound(r.items)).catch(() => undefined); }, 250);
    return () => clearTimeout(id);
  }, [q]);

  const pick = async (c: Cust) => {
    setCust(c); setFound([]); setQ('');
    const full = await api<{ addresses: { Id: number; City: string | null; District: string | null; Street: string | null }[] }>(`/customers/${c.Id}`);
    setAddresses(full.addresses);
    setAddressId(full.addresses[0] ? String(full.addresses[0].Id) : '');
  };

  const endIso = start ? new Date(new Date(start).getTime() + Number(minutes) * 60000).toISOString() : '';
  useEffect(() => {
    if (!start || !endIso || !can('technicians.view')) { setTechs([]); return; }
    api<{ items: { Id: number; FullName: string }[] }>(`/technicians/available?start=${encodeURIComponent(new Date(start).toISOString())}&end=${encodeURIComponent(endIso)}`)
      .then((r) => { setTechs(r.items); setSel((s) => s.filter((i) => r.items.some((x) => x.Id === i))); }).catch(() => setTechs([]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, minutes]);

  const onService = (i: number, serviceId: string) => {
    const next = lines.map((l, j) => (j === i ? { ...l, serviceId } : l));
    setLines(next);
    const total = next.reduce((s, l) => s + (services.find((x) => String(x.Id) === l.serviceId)?.DefaultMinutes ?? 0), 0);
    if (total) setMinutes(String(total));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!cust) { setErr(t('customer')); return; }
    setBusy(true); setErr('');
    try {
      await api('/bookings', {
        method: 'POST',
        body: {
          customerId: cust.Id, addressId: Number(addressId), branchId: branchId ? Number(branchId) : undefined,
          startAt: new Date(start).toISOString(), endAt: endIso,
          lines: lines.filter((l) => l.serviceId).map((l) => ({ serviceId: Number(l.serviceId), quantity: Number(l.quantity) })),
          technicianIds: sel, discount: Number(discount) || 0, source: 'phone', idempotencyKey: key.current,
        },
      });
      onSaved();
    } catch (ex) { setErr(ex instanceof ApiError ? ex.message : 'Error'); } finally { setBusy(false); }
  };

  const est = lines.reduce((s, l) => s + (services.find((x) => String(x.Id) === l.serviceId)?.CurrentPrice ?? 0) * Number(l.quantity || 0), 0);

  return (
    <Modal title={t('newBooking')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label={t('customer')}>
          {cust ? <div className="flex items-center gap-2"><span>{cust.Name} · <span dir="ltr">{cust.Mobile}</span></span><button type="button" className="text-sm text-cyan-700" onClick={() => setCust(null)}>×</button></div> : (
            <div className="relative">
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`${t('name')} / ${t('mobile')} / ${t('code')}`} />
              {found.length > 0 && <div className="absolute z-10 mt-1 w-full rounded-lg border bg-white shadow dark:border-slate-700 dark:bg-slate-800">{found.map((c) => <button type="button" key={c.Id} onClick={() => pick(c)} className="block w-full px-3 py-2 text-start hover:bg-slate-100 dark:hover:bg-slate-700">{c.Name} · <span dir="ltr">{c.Mobile}</span></button>)}</div>}
            </div>
          )}
        </Field>
        {cust && <Field label={t('address')}><Select required value={addressId} onChange={(e) => setAddressId(e.target.value)}>{addresses.map((a) => <option key={a.Id} value={a.Id}>{[a.City, a.District, a.Street].filter(Boolean).join(' - ') || `#${a.Id}`}</option>)}</Select></Field>}
        {(!me?.BranchId || branches.length > 1) && <Field label={t('branch')}><Select required value={branchId} onChange={(e) => setBranchId(e.target.value)}><option value="" />{branches.map((b) => <option key={b.Id} value={b.Id}>{b.Name}</option>)}</Select></Field>}
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_5rem] gap-2">
            <Select required={i === 0} value={l.serviceId} onChange={(e) => onService(i, e.target.value)}><option value="" />{services.map((s) => <option key={s.Id} value={s.Id}>{s.Name}{s.CurrentPrice !== null ? ` — ${money(s.CurrentPrice, lang)}` : ''}</option>)}</Select>
            <Input type="number" min={0.5} step="0.5" value={l.quantity} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} aria-label={t('quantity')} />
          </div>
        ))}
        <button type="button" className="text-sm text-cyan-700" onClick={() => setLines([...lines, { serviceId: '', quantity: '1' }])}>+ {t('addLine')}</button>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('start')}><Input type="datetime-local" required value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label={t('minutes')}><Input type="number" min={15} step={15} required value={minutes} onChange={(e) => setMinutes(e.target.value)} /></Field>
        </div>
        {techs.length > 0 && (
          <div><div className="mb-1 text-sm text-slate-600 dark:text-slate-300">{t('pickTechs')}</div>
            <div className="flex flex-wrap gap-3 text-sm">{techs.map((x) => <label key={x.Id} className="flex items-center gap-1"><input type="checkbox" checked={sel.includes(x.Id)} onChange={(e) => setSel(e.target.checked ? [...sel, x.Id] : sel.filter((i) => i !== x.Id))} />{x.FullName}</label>)}</div></div>
        )}
        {can('bookings.discount') && <Field label={t('discount')}><Input type="number" min={0} step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} /></Field>}
        <div className="text-sm text-slate-500">≈ {money(est, lang)} ({lang === 'ar' ? 'قبل الضريبة' : 'before VAT'})</div>
        {err && <ErrorBox message={err} />}
        <div className="flex gap-2"><Button type="submit" disabled={busy || !cust}>{t('save')}</Button><Button type="button" variant="ghost" onClick={onClose}>{t('cancel')}</Button></div>
      </form>
    </Modal>
  );
}
