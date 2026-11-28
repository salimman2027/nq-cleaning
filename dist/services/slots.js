"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.periodOf = exports.DEFAULT_SCHEDULE = void 0;
exports.loadSchedule = loadSchedule;
exports.slotTimes = slotTimes;
exports.loadTeams = loadTeams;
exports.durationOf = durationOf;
exports.slotsWithAvailability = slotsWithAvailability;
exports.assertSlot = assertSlot;
const db_1 = require("../db");
const errors_1 = require("../errors");
exports.DEFAULT_SCHEDULE = { open: '08:00', close: '20:00', slotMinutes: 120, days: '0123456', maxPerSlot: 3 };
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toStr = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
async function loadSchedule(companyId) {
    const r = (await (0, db_1.query)(`SELECT OpenTime, CloseTime, SlotMinutes, Days, MaxPerSlot FROM CompanySchedule WHERE CompanyId=@c`, { c: companyId }))[0];
    return r ? { open: r.OpenTime, close: r.CloseTime, slotMinutes: Number(r.SlotMinutes), days: r.Days, maxPerSlot: Number(r.MaxPerSlot) } : exports.DEFAULT_SCHEDULE;
}
/** Slot start times for a calendar day (YYYY-MM-DD); empty when the company does not work that weekday. */
function slotTimes(s, date) {
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (!s.days.includes(String(dow)))
        return [];
    const out = [];
    for (let m = toMin(s.open); m + s.slotMinutes <= toMin(s.close); m += s.slotMinutes)
        out.push({ time: toStr(m), end: toStr(m + s.slotMinutes) });
    return out;
}
/** Every team with the hours it really works: its own schedule when set, otherwise the company hours (one job per slot). */
async function loadTeams(companyId, company) {
    const base = company ?? (await loadSchedule(companyId));
    const rows = await (0, db_1.query)(`SELECT s.Id, s.FullName, t.OpenTime, t.CloseTime, t.Days, t.MaxPerSlot FROM Supervisors s LEFT JOIN SupervisorSchedule t ON t.SupervisorId=s.Id WHERE s.CompanyId=@c AND s.IsDeleted=0 ORDER BY s.Id`, { c: companyId });
    return rows.map((r) => ({
        supervisorId: Number(r.Id), fullName: r.FullName, custom: r.OpenTime != null,
        open: r.OpenTime ?? base.open, close: r.CloseTime ?? base.close, days: r.Days ?? base.days, maxPerSlot: r.MaxPerSlot != null ? Number(r.MaxPerSlot) : 1,
    }));
}
/** How many jobs the company can take at a slot: the sum of what each team working then can take; the company number when no teams exist. */
function capacityAt(s, teams, date, time, dur) {
    if (teams.length === 0)
        return s.maxPerSlot;
    const dow = String(new Date(`${date}T00:00:00Z`).getUTCDay());
    const start = toMin(time);
    return teams.reduce((n, t) => (t.days.includes(dow) && start >= toMin(t.open) && start + dur <= toMin(t.close) ? n + t.maxPerSlot : n), 0);
}
/** How long a job takes: the sum of the chosen services' durations (set per service by the company). Falls back to one slot. */
async function durationOf(companyId, serviceIds, fallback) {
    const ids = [...new Set((serviceIds ?? []).filter((x) => Number.isInteger(x) && x > 0))].slice(0, 20);
    if (ids.length === 0)
        return fallback;
    const r = await (0, db_1.query)(`SELECT SUM(DefaultMinutes) AS M FROM Services WHERE CompanyId=@c AND Id IN (${ids.join(',')})`, { c: companyId });
    return Math.max(30, Number(r[0]?.M ?? fallback));
}
async function slotsWithAvailability(companyId, date, serviceIds) {
    const s = await loadSchedule(companyId);
    const teams = await loadTeams(companyId, s);
    const dur = await durationOf(companyId, serviceIds, s.slotMinutes);
    // Existing requests on that day block the time they really take (their services' durations), not just their start.
    const used = await (0, db_1.query)(`SELECT r.PreferredTime AS T,
            COALESCE((SELECT SUM(sv.DefaultMinutes) FROM BookingRequestItems i JOIN Services sv ON sv.Id=i.ServiceId WHERE i.RequestId=r.Id), (SELECT DefaultMinutes FROM Services WHERE Id=r.ServiceId), @sm) AS D
       FROM BookingRequests r WHERE r.CompanyId=@c AND r.PreferredDate=@d AND r.Status<>'cancelled' AND r.PreferredTime IS NOT NULL`, { c: companyId, d: date, sm: s.slotMinutes });
    const busy = used.map((u) => ({ from: toMin(u.T), to: toMin(u.T) + Number(u.D) }));
    const widest = { ...s, days: '0123456', open: [s.open, ...teams.map((t) => t.open)].sort()[0], close: [s.close, ...teams.map((t) => t.close)].sort().slice(-1)[0] };
    const dow = String(new Date(`${date}T00:00:00Z`).getUTCDay());
    const slots = slotTimes({ ...widest, close: toStr(Math.min(24 * 60 - 1, toMin(widest.close) + Math.max(0, s.slotMinutes - dur))) }, date)
        .map((x) => ({ ...x, cap: teams.length === 0 ? (toMin(x.time) + dur <= toMin(s.close) && s.days.includes(dow) ? s.maxPerSlot : 0) : capacityAt(s, teams, date, x.time, dur) }))
        .filter((x) => x.cap > 0)
        .map((x) => {
        const start = toMin(x.time);
        const overlap = busy.filter((b) => b.from < start + dur && b.to > start).length;
        return { time: x.time, end: toStr(start + dur), available: overlap < x.cap };
    });
    return { schedule: s, durationMinutes: dur, slots };
}
/** Rejects a time that is not one of the company's slots on that day, or a slot that is already full. */
async function assertSlot(companyId, date, time, serviceIds) {
    const { slots } = await slotsWithAvailability(companyId, date, serviceIds);
    const sl = slots.find((x) => x.time === time);
    if (!sl)
        throw new errors_1.HttpError(400, 'BAD_SLOT', 'This time is outside the company working hours');
    if (!sl.available)
        throw new errors_1.HttpError(409, 'SLOT_FULL', 'This time slot is full');
}
const periodOf = (time) => { const h = Number(time.slice(0, 2)); return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'; };
exports.periodOf = periodOf;
