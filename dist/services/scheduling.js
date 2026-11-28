"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertTechniciansFree = assertTechniciansFree;
const db_1 = require("../db");
const config_1 = require("../config");
const errors_1 = require("../errors");
/**
 * Locks every technician (sorted, to avoid deadlocks) for the duration of the transaction,
 * then verifies no overlapping assignment or leave exists. Because the lock is held until
 * commit, two concurrent requests for the same technician are serialized and the second one
 * sees the first one's row. A DB trigger (migration 002) is the last line of defence.
 */
async function assertTechniciansFree(tx, companyId, technicianIds, startAt, endAt, excludeBookingId = null) {
    const ids = [...new Set(technicianIds)].sort((a, b) => a - b);
    if (ids.length === 0)
        return;
    for (const id of ids)
        await (0, db_1.applock)(tx, `tech:${companyId}:${id}`);
    const params = { c: companyId };
    const names = ids.map((id, i) => {
        params[`t${i}`] = id;
        return `@t${i}`;
    });
    const inList = names.join(',');
    const known = await (0, db_1.query)(`SELECT Id FROM Technicians WHERE CompanyId = @c AND IsDeleted = 0 AND Id IN (${inList})`, params, tx);
    const knownIds = new Set(known.map((k) => Number(k.Id)));
    const conflicts = ids.filter((i) => !knownIds.has(i)).map((i) => ({ technicianId: i, reason: 'unknown_technician' }));
    const buffer = config_1.config.travelBufferMinutes * 60 * 1000;
    const bookingConflicts = await (0, db_1.query)(`SELECT a.TechnicianId, b.BookingNo, a.StartAt, a.EndAt
       FROM BookingAssignments a
       JOIN Bookings b ON b.Id = a.BookingId
      WHERE a.IsActive = 1 AND b.IsDeleted = 0 AND b.CompanyId = @c
        AND b.Status NOT IN ('cancelled','postponed')
        AND a.TechnicianId IN (${inList})
        AND a.StartAt < @endB AND a.EndAt > @startB
        AND (@excl IS NULL OR a.BookingId <> @excl)`, {
        ...params,
        startB: (0, db_1.dt)(new Date(startAt.getTime() - buffer)),
        endB: (0, db_1.dt)(new Date(endAt.getTime() + buffer)),
        excl: excludeBookingId,
    }, tx);
    for (const r of bookingConflicts) {
        conflicts.push({ technicianId: Number(r.TechnicianId), reason: 'booking', bookingNo: r.BookingNo, from: r.StartAt, to: r.EndAt });
    }
    const leaves = await (0, db_1.query)(`SELECT TechnicianId, FromAt, ToAt FROM TechnicianLeaves
      WHERE TechnicianId IN (${inList}) AND FromAt < @e AND ToAt > @s`, { ...params, s: (0, db_1.dt)(startAt), e: (0, db_1.dt)(endAt) }, tx);
    for (const l of leaves)
        conflicts.push({ technicianId: Number(l.TechnicianId), reason: 'leave', from: l.FromAt, to: l.ToAt });
    if (conflicts.length) {
        throw new errors_1.HttpError(409, 'TECHNICIAN_CONFLICT', 'One or more technicians are not available in this time range', conflicts);
    }
}
