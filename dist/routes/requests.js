"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestsRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../db");
const errors_1 = require("../errors");
const middleware_1 = require("../auth/middleware");
const requestSync_1 = require("../services/requestSync");
const messaging_1 = require("../services/messaging");
/** Booking requests received from the public storefront, for the company's own staff. */
exports.requestsRouter = (0, express_1.Router)();
exports.requestsRouter.get('/', (0, middleware_1.requirePerm)('bookings.view'), (0, errors_1.h)(async (req, res) => {
    await (0, requestSync_1.backfillConfirmed)(req.user.companyId, req.user.id);
    const items = await (0, db_1.query)(`SELECT r.Id, r.PaymentMethod, r.PaymentStatus, r.Total, r.CustomerName, r.Phone, r.Address, r.City, r.District, r.PreferredDate, r.PreferredPeriod, r.PreferredTime, r.Notes, r.Status, r.CreatedAt, r.Latitude, r.Longitude, r.PhotoUrl, s.Name AS ServiceName
         FROM BookingRequests r JOIN Services s ON s.Id=r.ServiceId
        WHERE r.CompanyId=@c ORDER BY CASE r.Status WHEN 'new' THEN 0 ELSE 1 END, r.CreatedAt DESC`, { c: req.user.companyId });
    const ids = items.map((r) => r.Id);
    const lines = ids.length ? await (0, db_1.query)(`SELECT RequestId, Name, UnitPrice, Qty FROM BookingRequestItems WHERE RequestId IN (SELECT Id FROM BookingRequests WHERE CompanyId=@c)`, { c: req.user.companyId }) : [];
    res.json({ items: items.map((r) => ({ ...r, Items: lines.filter((l) => l.RequestId === r.Id) })) });
}));
exports.requestsRouter.patch('/:id/total', (0, middleware_1.requirePerm)('bookings.update'), (0, errors_1.h)(async (req, res) => {
    const id = (0, errors_1.parse)(zod_1.z.coerce.number().int().positive(), req.params.id);
    const { total } = (0, errors_1.parse)(zod_1.z.object({ total: zod_1.z.number().min(0).max(1_000_000) }), req.body);
    const cur = (await (0, db_1.query)(`SELECT Status, PaymentStatus FROM BookingRequests WHERE Id=@i AND CompanyId=@c`, { i: id, c: req.user.companyId }))[0];
    if (!cur)
        throw new errors_1.HttpError(404, 'NOT_FOUND', 'Request not found');
    if (cur.Status === 'cancelled' || cur.PaymentStatus === 'paid')
        throw new errors_1.HttpError(409, 'PRICE_LOCKED', 'Price cannot change after payment or cancellation');
    await (0, db_1.query)(`UPDATE BookingRequests SET Total=@t, UpdatedAt=SYSUTCDATETIME() WHERE Id=@i AND CompanyId=@c`, { t: Math.round(total * 100) / 100, i: id, c: req.user.companyId });
    res.json({ id, total });
}));
exports.requestsRouter.patch('/:id/payment', (0, middleware_1.requirePerm)('bookings.update'), (0, errors_1.h)(async (req, res) => {
    const id = (0, errors_1.parse)(zod_1.z.coerce.number().int().positive(), req.params.id);
    const { paymentStatus } = (0, errors_1.parse)(zod_1.z.object({ paymentStatus: zod_1.z.enum(['paid', 'unpaid']) }), req.body);
    const r = await (0, db_1.query)(`UPDATE BookingRequests SET PaymentStatus=@s, UpdatedAt=SYSUTCDATETIME() OUTPUT inserted.Id WHERE Id=@i AND CompanyId=@c`, { s: paymentStatus, i: id, c: req.user.companyId });
    if (!r.length)
        throw new errors_1.HttpError(404, 'NOT_FOUND', 'Request not found');
    res.json({ id, paymentStatus });
}));
exports.requestsRouter.patch('/:id', (0, middleware_1.requirePerm)('bookings.update'), (0, errors_1.h)(async (req, res) => {
    const id = (0, errors_1.parse)(zod_1.z.coerce.number().int().positive(), req.params.id);
    const { status } = (0, errors_1.parse)(zod_1.z.object({ status: zod_1.z.enum(['contacted', 'confirmed', 'cancelled']) }), req.body);
    const r = await (0, db_1.query)(`UPDATE BookingRequests SET Status=@s, UpdatedAt=SYSUTCDATETIME() OUTPUT inserted.Id WHERE Id=@i AND CompanyId=@c`, { s: status, i: id, c: req.user.companyId });
    if (!r.length)
        throw new errors_1.HttpError(404, 'NOT_FOUND', 'Request not found');
    const bookingId = status === 'confirmed' ? await (0, requestSync_1.bookFromRequest)(req.user.companyId, id, req.user.id) : null;
    let notified = false;
    if (status === 'confirmed') {
        // Best effort: a failed message must never undo the confirmation. The customer also sees an in-app notice.
        const info = (await (0, db_1.query)(`SELECT r.Phone, r.CustomerName, r.PreferredDate, c.Name AS Company FROM BookingRequests r JOIN Companies c ON c.Id=r.CompanyId WHERE r.Id=@i`, { i: id }))[0];
        if (info)
            notified = (await (0, messaging_1.notifyEvent)('order_confirmed', info.Phone, { name: info.CustomerName, company: info.Company, date: new Date(info.PreferredDate).toISOString().slice(0, 10) }, req.user.companyId)).length > 0;
    }
    res.json({ id, status, bookingId, notified });
}));
