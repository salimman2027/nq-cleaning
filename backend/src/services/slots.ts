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

export async function slotsWithAvailability(companyId: number, date: string) {
  const s = await loadSchedule(companyId);
  const used = await query<{ T: string; N: number }>(`SELECT PreferredTime AS T, COUNT(*) AS N FROM BookingRequests WHERE CompanyId=@c AND PreferredDate=@d AND Status<>'cancelled' AND PreferredTime IS NOT NULL GROUP BY PreferredTime`, { c: companyId, d: date });
  const n = new Map(used.map((u) => [u.T, Number(u.N)]));
  return { schedule: s, slots: slotTimes(s, date).map((x) => ({ ...x, available: (n.get(x.time) ?? 0) < s.maxPerSlot })) };
}

/** Rejects a time that is not one of the company's slots on that day, or a slot that is already full. */
export async function assertSlot(companyId: number, date: string, time: string): Promise<void> {
  const { slots } = await slotsWithAvailability(companyId, date);
  const sl = slots.find((x) => x.time === time);
  if (!sl) throw new HttpError(400, 'BAD_SLOT', 'This time is outside the company working hours');
  if (!sl.available) throw new HttpError(409, 'SLOT_FULL', 'This time slot is full');
}

export const periodOf = (time: string): 'morning' | 'afternoon' | 'evening' => { const h = Number(time.slice(0, 2)); return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'; };
