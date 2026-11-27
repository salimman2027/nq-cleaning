import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db';
import { HttpError, h, parse } from '../errors';
import { requirePerm } from '../auth/middleware';

/** Booking requests received from the public storefront, for the company's own staff. */
export const requestsRouter = Router();

requestsRouter.get(
  '/',
  requirePerm('bookings.view'),
  h(async (req, res) => {
    const items = await query(
      `SELECT r.Id, r.CustomerName, r.Phone, r.Address, r.PreferredDate, r.PreferredPeriod, r.Notes, r.Status, r.CreatedAt, s.Name AS ServiceName
         FROM BookingRequests r JOIN Services s ON s.Id=r.ServiceId
        WHERE r.CompanyId=@c ORDER BY CASE r.Status WHEN 'new' THEN 0 ELSE 1 END, r.CreatedAt DESC`,
      { c: req.user!.companyId },
    );
    res.json({ items });
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
    res.json({ id, status });
  }),
);
