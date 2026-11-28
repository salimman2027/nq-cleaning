import { query } from '../db';
import { HttpError } from '../errors';

export interface Schedule { open: string; close: string; slotMinutes: number; days: string; maxPerSlot: number }
export const DEFAULT_SCHEDULE: Schedule = { open: '08:00', close: '20:00', slotMinutes: 120, days: '0123456', maxPerSlot: 3 };

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toStr = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export async function loadSchedule(companyId: number): Promise<Schedule> {
  const r = (await query<Record<string, any>>(`SELECT OpenTime, CloseTime, SlotMinutes, Days, MaxPerSlot FROM CompanySchedule WHERE CompanyId=@c`, { c: companyId }))[0];
  return r ? { open: r.OpenTime, close: r.CloseTime, slotMinutes: Number(r.SlotMinutes), days: r.Days, maxPerSlot: Number(r.MaxPerSlot) } : DEFAULT_SCHEDULE;
}

/** Slot start times for a calendar day (YYYY-MM-DD); empty when the company does not work that weekday. */
export function slotTimes(s: Schedule, date: string): { time: string; end: string }[] {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (!s.days.includes(String(dow))) return [];
  const out: { time: string; end: string }[] = [];
  for (let m = toMin(s.open); m + s.slotMinutes <= toMin(s.close); m += s.slotMinutes) out.push({ time: toStr(m), end: toStr(m + s.slotMinutes) });
  return out;
}

export interface TeamSchedule { supervisorId: number; fullName: string; custom: boolean; open: string; close: string; days: string; maxPerSlot: number }

/** Every team with the hours it really works: its own schedule when set, otherwise the company hours (one job per slot). */
export async function loadTeams(companyId: number, company?: Schedule): Promise<TeamSchedule[]> {
  const base = company ?? (await loadSchedule(companyId));
  const rows = await query<Record<string, any>>(
    `SELECT s.Id, s.FullName, t.OpenTime, t.CloseTime, t.Days, t.MaxPerSlot FROM Supervisors s LEFT JOIN SupervisorSchedule t ON t.SupervisorId=s.Id WHERE s.CompanyId=@c AND s.IsDeleted=0 ORDER BY s.Id`, { c: companyId });
  return rows.map((r) => ({
    supervisorId: Number(r.Id), fullName: r.FullName, custom: r.OpenTime != null,
    open: r.OpenTime ?? base.open, close: r.CloseTime ?? base.close, days: r.Days ?? base.days, maxPerSlot: r.MaxPerSlot != null ? Number(r.MaxPerSlot) : 1,
  }));
}

/** How many jobs the company can take at a slot: the sum of what each team working then can take; the company number when no teams exist. */
function capacityAt(s: Schedule, teams: TeamSchedule[], date: string, time: string): number {
  if (teams.length === 0) return s.maxPerSlot;
  const dow = String(new Date(`${date}T00:00:00Z`).getUTCDay());
  const start = toMin(time);
  return teams.reduce((n, t) => (t.days.includes(dow) && start >= toMin(t.open) && start + s.slotMinutes <= toMin(t.close) ? n + t.maxPerSlot : n), 0);
}

export async function slotsWithAvailability(companyId: number, date: string) {
  const s = await loadSchedule(companyId);
  const teams = await loadTeams(companyId, s);
  const used = await query<{ T: string; N: number }>(`SELECT PreferredTime AS T, COUNT(*) AS N FROM BookingRequests WHERE CompanyId=@c AND PreferredDate=@d AND Status<>'cancelled' AND PreferredTime IS NOT NULL GROUP BY PreferredTime`, { c: companyId, d: date });
  const n = new Map(used.map((u) => [u.T, Number(u.N)]));
  // The grid is built from the earliest start to the latest end across the company and its teams, then filtered by who is actually working.
  const widest: Schedule = { ...s, days: '0123456', open: [s.open, ...teams.map((t) => t.open)].sort()[0], close: [s.close, ...teams.map((t) => t.close)].sort().slice(-1)[0] };
  const slots = slotTimes(widest, date)
    .map((x) => ({ ...x, cap: capacityAt(s, teams, date, x.time) }))
    .filter((x) => x.cap > 0 && (teams.length > 0 || s.days.includes(String(new Date(`${date}T00:00:00Z`).getUTCDay()))))
    .map((x) => ({ time: x.time, end: x.end, available: (n.get(x.time) ?? 0) < x.cap }));
  return { schedule: s, slots };
}

/** Rejects a time that is not one of the company's slots on that day, or a slot that is already full. */
export async function assertSlot(companyId: number, date: string, time: string): Promise<void> {
  const { slots } = await slotsWithAvailability(companyId, date);
  const sl = slots.find((x) => x.time === time);
  if (!sl) throw new HttpError(400, 'BAD_SLOT', 'This time is outside the company working hours');
  if (!sl.available) throw new HttpError(409, 'SLOT_FULL', 'This time slot is full');
}

export const periodOf = (time: string): 'morning' | 'afternoon' | 'evening' => { const h = Number(time.slice(0, 2)); return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'; };
