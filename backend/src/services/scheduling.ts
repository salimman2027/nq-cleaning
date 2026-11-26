import type sql from 'mssql';
import { applock, dt, query } from '../db';
import { config } from '../config';
import { HttpError } from '../errors';

export interface ConflictInfo {
  technicianId: number;
  reason: 'booking' | 'leave' | 'unknown_technician';
  bookingNo?: string;
  from?: Date;
  to?: Date;
}

/**
 * Locks every technician (sorted, to avoid deadlocks) for the duration of the transaction,
 * then verifies no overlapping assignment or leave exists. Because the lock is held until
 * commit, two concurrent requests for the same technician are serialized and the second one
 * sees the first one's row. A DB trigger (migration 002) is the last line of defence.
 */
export async function assertTechniciansFree(
  tx: sql.Transaction,
  companyId: number,
  technicianIds: number[],
  startAt: Date,
  endAt: Date,
  excludeBookingId: number | null = null,
): Promise<void> {
  const ids = [...new Set(technicianIds)].sort((a, b) => a - b);
  if (ids.length === 0) return;
  for (const id of ids) await applock(tx, `tech:${companyId}:${id}`);

  const params: Record<string, unknown> = { c: companyId };
  const names = ids.map((id, i) => {
    params[`t${i}`] = id;
    return `@t${i}`;
  });
  const inList = names.join(',');

  const known = await query<{ Id: number }>(
    `SELECT Id FROM Technicians WHERE CompanyId = @c AND IsDeleted = 0 AND Id IN (${inList})`,
    params,
    tx,
  );
  const knownIds = new Set(known.map((k) => Number(k.Id)));
  const conflicts: ConflictInfo[] = ids.filter((i) => !knownIds.has(i)).map((i) => ({ technicianId: i, reason: 'unknown_technician' }));

  const buffer = config.travelBufferMinutes * 60 * 1000;
  const bookingConflicts = await query<{ TechnicianId: number; BookingNo: string; StartAt: Date; EndAt: Date }>(
    `SELECT a.TechnicianId, b.BookingNo, a.StartAt, a.EndAt
       FROM BookingAssignments a
       JOIN Bookings b ON b.Id = a.BookingId
      WHERE a.IsActive = 1 AND b.IsDeleted = 0 AND b.CompanyId = @c
        AND b.Status NOT IN ('cancelled','postponed')
        AND a.TechnicianId IN (${inList})
        AND a.StartAt < @endB AND a.EndAt > @startB
        AND (@excl IS NULL OR a.BookingId <> @excl)`,
    {
      ...params,
      startB: dt(new Date(startAt.getTime() - buffer)),
      endB: dt(new Date(endAt.getTime() + buffer)),
      excl: excludeBookingId,
    },
    tx,
  );
  for (const r of bookingConflicts) {
    conflicts.push({ technicianId: Number(r.TechnicianId), reason: 'booking', bookingNo: r.BookingNo, from: r.StartAt, to: r.EndAt });
  }

  const leaves = await query<{ TechnicianId: number; FromAt: Date; ToAt: Date }>(
    `SELECT TechnicianId, FromAt, ToAt FROM TechnicianLeaves
      WHERE TechnicianId IN (${inList}) AND FromAt < @e AND ToAt > @s`,
    { ...params, s: dt(startAt), e: dt(endAt) },
    tx,
  );
  for (const l of leaves) conflicts.push({ technicianId: Number(l.TechnicianId), reason: 'leave', from: l.FromAt, to: l.ToAt });

  if (conflicts.length) {
    throw new HttpError(409, 'TECHNICIAN_CONFLICT', 'One or more technicians are not available in this time range', conflicts);
  }
}
