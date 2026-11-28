import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db';
import { HttpError, h, parse } from '../errors';
import { requirePerm } from '../auth/middleware';
import { backfillConfirmed, bookFromRequest } from '../services/requestSync';
import { notifyEvent } from '../services/messaging';

/** Booking requests received from the public storefront, for the company's own staff. */
export const requestsRouter = Router();

requestsRouter.get(
  '/',
  requirePerm('bookings.view'),
  h(async (req, res) => {
    await backfillConfirmed(req.user!.companyId, req.user!.id);
    const items = await query(
      `SELECT r.Id, r.PaymentMethod, r.PaymentStatus, r.Total, r.CustomerName, r.Phone, r.Address, r.City, r.District, r.PreferredDate, r.PreferredPeriod, r.PreferredTime, r.Notes, r.Status, r.CreatedAt, r.Latitude, r.Longitude, r.PhotoUrl, s.Name AS ServiceName
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
  '/:id/total',
  requirePerm('bookings.update'),
  h(async (req, res) => {
    const id = parse(z.coerce.number().int().positive(), req.params.id);
    const { total } = parse(z.object({ total: z.number().min(0).max(1_000_000) }), req.body);
    const cur = (await query<{ Status: string; PaymentStatus: string | null }>(`SELECT Status, PaymentStatus FROM BookingRequests WHERE Id=@i AND CompanyId=@c`, { i: id, c: req.user!.companyId }))[0];
    if (!cur) throw new HttpError(404, 'NOT_FOUND', 'Request not found');
    if (cur.Status === 'cancelled' || cur.PaymentStatus === 'paid') throw new HttpError(409, 'PRICE_LOCKED', 'Price cannot change after payment or cancellation');
    await query(`UPDATE BookingRequests SET Total=@t, UpdatedAt=SYSUTCDATETIME() WHERE Id=@i AND CompanyId=@c`, { t: Math.round(total * 100) / 100, i: id, c: req.user!.companyId });
    res.json({ id, total });
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
    let notified = false;
    if (status === 'confirmed') {
      // Best effort: a failed message must never undo the confirmation. The customer also sees an in-app notice.
      const info = (await query<{ Phone: string; CustomerName: string; PreferredDate: Date; Company: string }>(
        `SELECT r.Phone, r.CustomerName, r.PreferredDate, c.Name AS Company FROM BookingRequests r JOIN Companies c ON c.Id=r.CompanyId WHERE r.Id=@i`, { i: id }))[0];
      if (info) notified = (await notifyEvent('order_confirmed', info.Phone, { name: info.CustomerName, company: info.Company, date: new Date(info.PreferredDate).toISOString().slice(0, 10) }, req.user!.companyId)).length > 0;
    }
    res.json({ id, status, bookingId, notified });
  }),
);
