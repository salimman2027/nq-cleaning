import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db';
import { HttpError, h, parse } from '../errors';
import { requirePerm } from '../auth/middleware';
import { backfillConfirmed, bookFromRequest } from '../services/requestSync';

/** Booking requests received from the public storefront, for the company's own staff. */
export const requestsRouter = Router();

requestsRouter.get(
  '/',
  requirePerm('bookings.view'),
  h(async (req, res) => {
    await backfillConfirmed(req.user!.companyId, req.user!.id);
    const items = await query(
      `SELECT r.Id, r.PaymentMethod, r.PaymentStatus, r.Total, r.CustomerName, r.Phone, r.Address, r.PreferredDate, r.PreferredPeriod, r.Notes, r.Status, r.CreatedAt, s.Name AS ServiceName
         FROM BookingRequests r JOIN Services s ON s.Id=r.ServiceId
        WHERE r.CompanyId=@c ORDER BY CASE r.Status WHEN 'new' THEN 0 ELSE 1 END, r.CreatedAt DESC`,
      { c: req.user!.companyId },
    );
    const ids = items.map((r) => r.Id);
    const lines = ids.length ? await query(`SELECT RequestId, Name, UnitPrice, Qty FROM BookingRequestItems WHERE RequestId IN (SELECT Id FROM BookingRequests WHERE CompanyId=@c)`, { c: req.user!.companyId }) : [];
    res.json({ items: items.map((r) => ({ ...r, Items: lines.filter((l) => l.RequestId === r.Id) })) });
  }),
);

requestsRouter.patch(
  '/:id/payment',
  requirePerm('bookings.update'),
  h(async (req, res) => {
    const id = parse(z.coerce.number().int().positive(), req.params.id);
    const { paymentStatus } = parse(z.object({ paymentStatus: z.enum(['paid', 'unpaid']) }), req.body);
    const r = await query(`UPDATE BookingRequests SET PaymentStatus=@s, UpdatedAt=SYSUTCDATETIME() OUTPUT inserted.Id WHERE Id=@i AND CompanyId=@c`, { s: paymentStatus, i: id, c: req.user!.companyId });
    if (!r.length) throw new HttpError(404, 'NOT_FOUND', 'Request not found');
    res.json({ id, paymentStatus });
  }),
);

requestsRouter.patch(
  '/:id',
  requirePerm('bookings.update'),
  h(async (req, res) => {
    const id = parse(z.coerce.number().int().positive(), req.params.id);
    const { status } = parse(z.object({ status: z.enum(['contacted', 'confirmed', 'cancelled']) }), req.body);
    const r = await query(`UPDATE BookingRequests SET Status=@s, UpdatedAt=SYSUTCDATETIME() OUTPUT inserted.Id WHERE Id=@i AND CompanyId=@c`, { s: status, i: id, c: req.user!.companyId });
    if (!r.length) throw new HttpError(404, 'NOT_FOUND', 'Request not found');
    const bookingId = status === 'confirmed' ? await bookFromRequest(req.user!.companyId, id, req.user!.id) : null;
    res.json({ id, status, bookingId });
  }),
);
