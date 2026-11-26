import { Router } from 'express';
import sql from 'mssql';
import { z } from 'zod';
import { dt, money, query, withTx } from '../db';
import { HttpError, h, parse } from '../errors';
import { branchScope, requirePerm } from '../auth/middleware';
import { calcTotals, lineTotal } from '../lib/pricing';
import { REASON_REQUIRED, RELEASES_ASSIGNMENTS, STATUSES, canTransition, type BookingStatus } from '../lib/transitions';
import { assertTechniciansFree } from '../services/scheduling';
import type { AuthUser } from '../types';

export const bookingsRouter = Router();

const idParam = z.coerce.number().int().positive();
const SOURCES = ['phone', 'whatsapp', 'website', 'customer_app', 'branch_visit', 'returning_customer', 'campaign'] as const;

const createSchema = z
  .object({
    customerId: z.number().int().positive(),
    addressId: z.number().int().positive(),
    branchId: z.number().int().positive().optional(),
    startAt: z.coerce.date(),
    endAt: z.coerce.date().optional(),
    durationMinutes: z.number().int().min(15).max(24 * 60).optional(),
    lines: z.array(z.object({ serviceId: z.number().int().positive(), quantity: z.number().positive().max(10000), unitPrice: z.number().min(0).max(1_000_000).optional() })).min(1).max(20),
    technicianIds: z.array(z.number().int().positive()).max(30).default([]),
    discount: z.number().min(0).default(0),
    source: z.enum(SOURCES).optional(),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
    notes: z.string().max(2000).optional(),
    confirmed: z.boolean().default(false),
    idempotencyKey: z.string().min(8).max(64).optional(),
  })
  .refine((b) => !b.endAt || b.endAt > b.startAt, { message: 'endAt must be after startAt', path: ['endAt'] });

interface BookingRow {
  Id: number; CompanyId: number; BranchId: number; BookingNo: string; Status: BookingStatus; StartAt: Date; EndAt: Date;
}

async function lockBooking(tx: sql.Transaction, user: AuthUser, id: number): Promise<BookingRow> {
  const rows = await query<BookingRow>(
    `SELECT Id, CompanyId, BranchId, BookingNo, Status, StartAt, EndAt FROM Bookings WITH (UPDLOCK, ROWLOCK)
      WHERE Id = @i AND CompanyId = @c AND IsDeleted = 0`,
    { i: id, c: user.companyId },
    tx,
  );
  const scope = branchScope(user);
  if (!rows[0] || (scope !== null && rows[0].BranchId !== scope)) throw new HttpError(404, 'NOT_FOUND', 'Booking not found');
  return rows[0];
}

async function addHistory(tx: sql.Transaction, bookingId: number, from: string | null, to: string, reason: string | null, userId: number) {
  await query(
    `INSERT INTO BookingStatusHistory (BookingId, FromStatus, ToStatus, Reason, ChangedBy) VALUES (@b, @f, @t, @r, @u)`,
    { b: bookingId, f: from, t: to, r: reason, u: userId },
    tx,
  );
}

bookingsRouter.get(
  '/',
  requirePerm('bookings.view'),
  h(async (req, res) => {
    const q = parse(
      z.object({
        from: z.coerce.date().optional(), to: z.coerce.date().optional(),
        status: z.enum(STATUSES).optional(), customerId: z.coerce.number().int().optional(), branchId: z.coerce.number().int().optional(),
        page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25),
      }),
      req.query,
    );
    const scope = branchScope(req.user!);
    const p = {
      c: req.user!.companyId, f: q.from ? dt(q.from) : dt(null), t: q.to ? dt(q.to) : dt(null), s: q.status ?? null, cu: q.customerId ?? null,
      b: scope ?? q.branchId ?? null, off: (q.page - 1) * q.pageSize, ps: q.pageSize,
    };
    const where = `b.CompanyId=@c AND b.IsDeleted=0 AND (@f IS NULL OR b.StartAt >= @f) AND (@t IS NULL OR b.StartAt < @t)
                   AND (@s IS NULL OR b.Status=@s) AND (@cu IS NULL OR b.CustomerId=@cu) AND (@b IS NULL OR b.BranchId=@b)`;
    const items = await query(
      `SELECT b.Id, b.BookingNo, b.Status, b.StartAt, b.EndAt, b.Total, b.Paid, b.BranchId, c.Name AS CustomerName, c.Mobile AS CustomerMobile,
              (SELECT COUNT(*) FROM BookingAssignments a WHERE a.BookingId=b.Id AND a.IsActive=1) AS TechnicianCount
         FROM Bookings b JOIN Customers c ON c.Id=b.CustomerId WHERE ${where}
        ORDER BY b.StartAt DESC, b.Id DESC OFFSET @off ROWS FETCH NEXT @ps ROWS ONLY`,
      p,
    );
    const total = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM Bookings b WHERE ${where}`, p);
    res.json({ items, total: total[0].n, page: q.page, pageSize: q.pageSize });
  }),
);

bookingsRouter.get(
  '/:id',
  requirePerm('bookings.view'),
  h(async (req, res) => {
    const id = parse(idParam, req.params.id);
    const u = req.user!;
    const rows = await query<{ BranchId: number }>(
      `SELECT b.*, c.Name AS CustomerName, c.Mobile AS CustomerMobile, a.City, a.District, a.Street, a.MapUrl
         FROM Bookings b JOIN Customers c ON c.Id=b.CustomerId JOIN CustomerAddresses a ON a.Id=b.AddressId
        WHERE b.Id=@i AND b.CompanyId=@c AND b.IsDeleted=0`,
      { i: id, c: u.companyId },
    );
    const scope = branchScope(u);
    if (!rows[0] || (scope !== null && rows[0].BranchId !== scope)) throw new HttpError(404, 'NOT_FOUND', 'Booking not found');
    const [lines, assignments, history] = await Promise.all([
      query(`SELECT d.Id, d.ServiceId, s.Name AS ServiceName, d.Quantity, d.UnitPrice, d.LineTotal FROM BookingDetails d JOIN Services s ON s.Id=d.ServiceId WHERE d.BookingId=@i`, { i: id }),
      query(`SELECT a.Id, a.TechnicianId, t.FullName, a.StartAt, a.EndAt, a.IsActive FROM BookingAssignments a JOIN Technicians t ON t.Id=a.TechnicianId WHERE a.BookingId=@i ORDER BY a.Id`, { i: id }),
      query(`SELECT h.FromStatus, h.ToStatus, h.Reason, h.ChangedBy, u.FullName AS ChangedByName, h.ChangedAt FROM BookingStatusHistory h LEFT JOIN Users u ON u.Id=h.ChangedBy WHERE h.BookingId=@i ORDER BY h.Id`, { i: id }),
    ]);
    res.json({ ...rows[0], lines, assignments, history });
  }),
);

bookingsRouter.post(
  '/',
  requirePerm('bookings.create'),
  h(async (req, res) => {
    const b = parse(createSchema, req.body);
    const u = req.user!;
    try {
      const out = await withTx(async (tx) => {
        if (b.idempotencyKey) {
          const ex = await query<{ Id: number; BookingNo: string }>(`SELECT Id, BookingNo FROM Bookings WHERE CompanyId=@c AND IdempotencyKey=@k`, { c: u.companyId, k: b.idempotencyKey }, tx);
          if (ex[0]) return { id: Number(ex[0].Id), bookingNo: ex[0].BookingNo, replay: true };
        }
        const cust = await query<{ Type: string }>(`SELECT Type FROM Customers WHERE Id=@i AND CompanyId=@c AND IsDeleted=0`, { i: b.customerId, c: u.companyId }, tx);
        if (!cust[0]) throw new HttpError(400, 'VALIDATION_ERROR', 'Unknown customer');
        const addr = await query(`SELECT Id FROM CustomerAddresses WHERE Id=@a AND CustomerId=@cu AND IsDeleted=0`, { a: b.addressId, cu: b.customerId }, tx);
        if (!addr[0]) throw new HttpError(400, 'VALIDATION_ERROR', 'Address does not belong to this customer');

        const scope = branchScope(u);
        const branchId = scope ?? b.branchId ?? u.branchId;
        if (!branchId) throw new HttpError(400, 'VALIDATION_ERROR', 'branchId is required');
        const br = await query(`SELECT Id FROM Branches WHERE Id=@b AND CompanyId=@c AND IsDeleted=0`, { b: branchId, c: u.companyId }, tx);
        if (!br[0]) throw new HttpError(400, 'VALIDATION_ERROR', 'Unknown branch');

        const company = await query<{ VatRate: number }>(`SELECT VatRate FROM Companies WHERE Id=@c`, { c: u.companyId }, tx);
        let minutes = 0;
        const priced: { serviceId: number; quantity: number; unitPrice: number }[] = [];
        for (const l of b.lines) {
          const s = await query<{ DefaultMinutes: number; Price: number | null }>(
            `SELECT s.DefaultMinutes,
                    (SELECT TOP 1 sp.Price FROM ServicePrices sp
                      WHERE sp.ServiceId = s.Id AND sp.Region IS NULL AND (sp.CustomerType IS NULL OR sp.CustomerType = @ct)
                        AND sp.ValidFrom <= CAST(SYSUTCDATETIME() AS DATE) AND (sp.ValidTo IS NULL OR sp.ValidTo >= CAST(SYSUTCDATETIME() AS DATE))
                      ORDER BY CASE WHEN sp.CustomerType IS NULL THEN 1 ELSE 0 END, sp.ValidFrom DESC, sp.Id DESC) AS Price
               FROM Services s WHERE s.Id=@s AND s.CompanyId=@c AND s.IsActive=1 AND s.IsDeleted=0`,
            { s: l.serviceId, c: u.companyId, ct: cust[0].Type },
            tx,
          );
          if (!s[0]) throw new HttpError(400, 'VALIDATION_ERROR', `Unknown or inactive service ${l.serviceId}`);
          if (s[0].Price === null && l.unitPrice === undefined) throw new HttpError(400, 'VALIDATION_ERROR', `Service ${l.serviceId} has no active price`);
          const catalog = s[0].Price === null ? null : Number(s[0].Price);
          const unit = l.unitPrice ?? (catalog as number);
          if (l.unitPrice !== undefined && catalog !== l.unitPrice && !u.perms.includes('bookings.edit_price')) {
            throw new HttpError(403, 'FORBIDDEN', 'Changing prices requires bookings.edit_price');
          }
          minutes += s[0].DefaultMinutes;
          priced.push({ serviceId: l.serviceId, quantity: l.quantity, unitPrice: unit });
        }
        if (b.discount > 0 && !u.perms.includes('bookings.discount')) throw new HttpError(403, 'FORBIDDEN', 'Discounts require bookings.discount');
        let totals;
        try {
          totals = calcTotals(priced, b.discount, Number(company[0].VatRate));
        } catch {
          throw new HttpError(400, 'VALIDATION_ERROR', 'Discount cannot exceed the subtotal');
        }

        const endAt = b.endAt ?? new Date(b.startAt.getTime() + (b.durationMinutes ?? minutes) * 60000);
        await assertTechniciansFree(tx, u.companyId, b.technicianIds, b.startAt, endAt);

        const status: BookingStatus = b.technicianIds.length ? 'assigned' : b.confirmed ? 'confirmed' : 'new';
        const ins = await query<{ Id: number; BookingNo: string }>(
          `INSERT INTO Bookings (CompanyId, BranchId, BookingNo, CustomerId, AddressId, StartAt, EndAt, Status, Subtotal, Discount, Vat, Total, IdempotencyKey, Source, Priority, Notes, CreatedBy)
           OUTPUT INSERTED.Id, INSERTED.BookingNo
           VALUES (@c, @br, 'BK-' + RIGHT('000000' + CAST(NEXT VALUE FOR BookingNoSeq AS VARCHAR(12)), 6), @cu, @ad, @s, @e, @st, @sub, @di, @vat, @tot, @k, @src, @pr, @n, @u)`,
          { c: u.companyId, br: branchId, cu: b.customerId, ad: b.addressId, s: dt(b.startAt), e: dt(endAt), st: status, sub: money(totals.subtotal), di: money(totals.discount), vat: money(totals.vat), tot: money(totals.total), k: b.idempotencyKey ?? null, src: b.source ?? null, pr: b.priority, n: b.notes ?? null, u: u.id },
          tx,
        );
        const id = Number(ins[0].Id);
        for (const l of priced) {
          await query(
            `INSERT INTO BookingDetails (BookingId, ServiceId, Quantity, UnitPrice, LineTotal) VALUES (@b,@s,@q,@p,@t)`,
            { b: id, s: l.serviceId, q: [sql.Decimal(10, 2), l.quantity], p: money(l.unitPrice), t: money(lineTotal(l)) },
            tx,
          );
        }
        for (const t of b.technicianIds) {
          await query(`INSERT INTO BookingAssignments (BookingId, TechnicianId, StartAt, EndAt) VALUES (@b,@t,@s,@e)`, { b: id, t, s: dt(b.startAt), e: dt(endAt) }, tx);
        }
        await addHistory(tx, id, null, status, null, u.id);
        await query(`INSERT INTO AuditLogs (CompanyId, UserId, Action, Entity, EntityId) VALUES (@c,@u,'create','Booking',@e)`, { c: u.companyId, u: u.id, e: String(id) }, tx);
        return { id, bookingNo: ins[0].BookingNo, replay: false, status, ...totals };
      });
      res.status(out.replay ? 200 : 201).json(out);
    } catch (e) {
      // A concurrent request with the same idempotency key won the race: return its booking.
      const num = (e as { number?: number }).number;
      if (b.idempotencyKey && (num === 2601 || num === 2627)) {
        const ex = await query<{ Id: number; BookingNo: string }>(`SELECT Id, BookingNo FROM Bookings WHERE CompanyId=@c AND IdempotencyKey=@k`, { c: u.companyId, k: b.idempotencyKey });
        if (ex[0]) {
          res.status(200).json({ id: Number(ex[0].Id), bookingNo: ex[0].BookingNo, replay: true });
          return;
        }
      }
      throw e;
    }
  }),
);

const ASSIGNABLE: BookingStatus[] = ['new', 'confirmed', 'awaiting_assignment', 'assigned', 'redo'];

bookingsRouter.post(
  '/:id/assign',
  requirePerm('bookings.assign'),
  h(async (req, res) => {
    const id = parse(idParam, req.params.id);
    const { technicianIds } = parse(z.object({ technicianIds: z.array(z.number().int().positive()).min(1).max(30) }), req.body);
    const u = req.user!;
    const out = await withTx(async (tx) => {
      const bk = await lockBooking(tx, u, id);
      if (!ASSIGNABLE.includes(bk.Status)) throw new HttpError(409, 'INVALID_STATE', `Cannot assign technicians while booking is ${bk.Status}`);
      await query(`UPDATE BookingAssignments SET IsActive = 0 WHERE BookingId = @b AND IsActive = 1`, { b: id }, tx);
      await assertTechniciansFree(tx, u.companyId, technicianIds, bk.StartAt, bk.EndAt, id);
      for (const t of [...new Set(technicianIds)]) {
        await query(`INSERT INTO BookingAssignments (BookingId, TechnicianId, StartAt, EndAt) VALUES (@b,@t,@s,@e)`, { b: id, t, s: dt(bk.StartAt), e: dt(bk.EndAt) }, tx);
      }
      if (bk.Status !== 'assigned') {
        await query(`UPDATE Bookings SET Status='assigned', UpdatedAt=SYSUTCDATETIME(), UpdatedBy=@u WHERE Id=@b`, { u: u.id, b: id }, tx);
        await addHistory(tx, id, bk.Status, 'assigned', null, u.id);
      }
      return { id, status: 'assigned' };
    });
    res.json(out);
  }),
);

bookingsRouter.post(
  '/:id/status',
  requirePerm('bookings.status'),
  h(async (req, res) => {
    const id = parse(idParam, req.params.id);
    const b = parse(z.object({ status: z.enum(STATUSES), reason: z.string().trim().max(500).optional() }), req.body);
    const u = req.user!;
    if (b.status === 'cancelled' && !u.perms.includes('bookings.cancel')) throw new HttpError(403, 'FORBIDDEN', 'Cancelling requires bookings.cancel');
    const out = await withTx(async (tx) => {
      const bk = await lockBooking(tx, u, id);
      if (!canTransition(bk.Status, b.status)) throw new HttpError(409, 'INVALID_TRANSITION', `Cannot change status from ${bk.Status} to ${b.status}`);
      if (REASON_REQUIRED.has(b.status) && !b.reason) throw new HttpError(400, 'REASON_REQUIRED', 'A reason is required for this status');
      if (b.status === 'assigned') {
        const n = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM BookingAssignments WHERE BookingId=@b AND IsActive=1`, { b: id }, tx);
        if (n[0].n === 0) throw new HttpError(409, 'NO_TECHNICIANS', 'Assign technicians first');
      }
      await query(`UPDATE Bookings SET Status=@s, UpdatedAt=SYSUTCDATETIME(), UpdatedBy=@u WHERE Id=@b`, { s: b.status, u: u.id, b: id }, tx);
      if (RELEASES_ASSIGNMENTS.has(b.status)) {
        await query(`UPDATE BookingAssignments SET IsActive=0 WHERE BookingId=@b AND IsActive=1`, { b: id }, tx);
      }
      await addHistory(tx, id, bk.Status, b.status, b.reason ?? null, u.id);
      return { id, status: b.status };
    });
    res.json(out);
  }),
);

const RESCHEDULABLE: BookingStatus[] = ['new', 'awaiting_confirmation', 'confirmed', 'awaiting_assignment', 'assigned', 'postponed'];

bookingsRouter.post(
  '/:id/reschedule',
  requirePerm('bookings.update'),
  h(async (req, res) => {
    const id = parse(idParam, req.params.id);
    const b = parse(z.object({ startAt: z.coerce.date(), endAt: z.coerce.date(), reason: z.string().trim().min(2).max(500) }), req.body);
    if (b.endAt <= b.startAt) throw new HttpError(400, 'VALIDATION_ERROR', 'endAt must be after startAt');
    const u = req.user!;
    const out = await withTx(async (tx) => {
      const bk = await lockBooking(tx, u, id);
      if (!RESCHEDULABLE.includes(bk.Status)) throw new HttpError(409, 'INVALID_STATE', `Cannot reschedule while booking is ${bk.Status}`);
      const techs = await query<{ TechnicianId: number }>(`SELECT TechnicianId FROM BookingAssignments WHERE BookingId=@b AND IsActive=1`, { b: id }, tx);
      await assertTechniciansFree(tx, u.companyId, techs.map((t) => Number(t.TechnicianId)), b.startAt, b.endAt, id);
      await query(`UPDATE Bookings SET StartAt=@s, EndAt=@e, UpdatedAt=SYSUTCDATETIME(), UpdatedBy=@u WHERE Id=@b`, { s: dt(b.startAt), e: dt(b.endAt), u: u.id, b: id }, tx);
      await query(`UPDATE BookingAssignments SET StartAt=@s, EndAt=@e WHERE BookingId=@b AND IsActive=1`, { s: dt(b.startAt), e: dt(b.endAt), b: id }, tx);
      await addHistory(tx, id, bk.Status, bk.Status, `reschedule: ${b.reason}`, u.id);
      return { id, startAt: b.startAt, endAt: b.endAt };
    });
    res.json(out);
  }),
);
