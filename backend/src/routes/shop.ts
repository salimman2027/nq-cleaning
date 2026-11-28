import { Router, type Request, type NextFunction, type Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config';
import { query, withTx, money } from '../db';
import { HttpError, h, parse } from '../errors';
import { isSaudiMobile } from '../lib/otp';
import { normalizeMobile } from '../lib/phone';
import { assertSlot, periodOf } from '../services/slots';
import { checkArea } from '../services/areas';

/**
 * Marketplace customer accounts and orders. A customer token is signed with a different secret than staff tokens, so it can
 * never open a staff or platform API (and the reverse). Phone numbers are NOT verified by a code yet.
 */
export const shopRouter = Router();

const limiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false, skip: () => config.env === 'test' });
const secret = (): string => `${config.jwt.accessSecret}:customer`;
const sign = (id: number): string => jwt.sign({ cus: id }, secret(), { algorithm: 'HS256', expiresIn: '30d' });
const phoneSchema = z.string().min(9).max(20).transform(normalizeMobile).refine(isSaudiMobile, 'Invalid mobile number');
const passSchema = z.string().min(8).max(100);

function customerAuth(req: Request, _res: Response, next: NextFunction): void {
  const t = (req.headers.authorization ?? '').replace(/^Bearer /, '');
  if (!t) return next(new HttpError(401, 'UNAUTHENTICATED', 'Sign in first'));
  try {
    req.customerId = (jwt.verify(t, secret(), { algorithms: ['HS256'] }) as unknown as { cus: number }).cus;
    next();
  } catch {
    next(new HttpError(401, 'INVALID_TOKEN', 'Invalid or expired session'));
  }
}

/** Customer id from a valid customer token, or null for a visitor. Never fails the request. */
export function optionalCustomerId(req: Request): number | null {
  const t = (req.headers.authorization ?? '').replace(/^Bearer /, '');
  if (!t) return null;
  try { return (jwt.verify(t, secret(), { algorithms: ['HS256'] }) as unknown as { cus: number }).cus ?? null; } catch { return null; }
}

shopRouter.post('/register', limiter, h(async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(2).max(100), phone: phoneSchema, password: passSchema }), req.body);
  const exists = await query(`SELECT TOP 1 1 AS x FROM MarketplaceCustomers WHERE Phone=@p AND IsDeleted=0`, { p: b.phone });
  if (exists.length) throw new HttpError(409, 'PHONE_TAKEN', 'This mobile number already has an account');
  const r = await query<{ Id: number }>(`INSERT INTO MarketplaceCustomers (Phone, Name, PasswordHash) OUTPUT inserted.Id VALUES (@p,@n,@h)`, { p: b.phone, n: b.name, h: await bcrypt.hash(b.password, 12) });
  res.status(201).json({ token: sign(Number(r[0].Id)), customer: { id: Number(r[0].Id), name: b.name, phone: b.phone } });
}));

shopRouter.post('/login', limiter, h(async (req, res) => {
  const b = parse(z.object({ phone: phoneSchema, password: z.string().min(1).max(100) }), req.body);
  const c = (await query<{ Id: number; Name: string; PasswordHash: string | null }>(`SELECT TOP 1 Id, Name, PasswordHash FROM MarketplaceCustomers WHERE Phone=@p AND IsDeleted=0`, { p: b.phone }))[0];
  // Same work and same answer whether the number exists or not.
  const ok = await bcrypt.compare(b.password, c?.PasswordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv');
  if (!c || !c.PasswordHash || !ok) throw new HttpError(401, 'BAD_CREDENTIALS', 'Incorrect mobile number or password');
  res.json({ token: sign(Number(c.Id)), customer: { id: Number(c.Id), name: c.Name, phone: b.phone } });
}));

shopRouter.get('/me', customerAuth, h(async (req, res) => {
  const c = (await query<{ Id: number; Name: string; Phone: string }>(`SELECT Id, Name, Phone FROM MarketplaceCustomers WHERE Id=@i AND IsDeleted=0`, { i: req.customerId }))[0];
  if (!c) throw new HttpError(401, 'INVALID_TOKEN', 'Account not found');
  const u = await query<{ N: number }>(`SELECT COUNT(*) AS N FROM BookingRequests WHERE CustomerId=@i AND Status IN ('contacted','confirmed','cancelled') AND ISNULL(CustomerSeenStatus,'new')<>Status`, { i: req.customerId });
  res.json({ id: Number(c.Id), name: c.Name, phone: c.Phone, unseen: Number(u[0].N) });
}));

const orderSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{3,60}$/),
  items: z.array(z.object({ serviceId: z.number().int().positive(), qty: z.number().int().min(1).max(1000) })).min(1).max(30),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period: z.enum(['morning', 'afternoon', 'evening']).optional(),
  time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  city: z.string().trim().max(60).optional(),
  district: z.string().trim().max(80).optional(),
  address: z.string().trim().min(3).max(300),
  notes: z.string().trim().max(500).optional(),
  paymentMethod: z.enum(['cash', 'card', 'tabby', 'tamara']),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  photoUrl: z.string().regex(/^\/api\/media\/\d+$/).optional(),
});

shopRouter.post('/orders', customerAuth, h(async (req, res) => {
  const b = parse(orderSchema, req.body);
  if (b.paymentMethod !== 'cash') throw new HttpError(400, 'METHOD_NOT_AVAILABLE', 'This payment method is not available yet');
  const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
  const max = new Date(Date.parse(today) + 90 * 86400_000).toISOString().slice(0, 10);
  if (b.date < today || b.date > max) throw new HttpError(400, 'BAD_DATE', 'Choose a date within the next 90 days');
  const co = (await query<{ Id: number }>(`SELECT Id FROM Companies WHERE Slug=@s AND Status='approved' AND IsDeleted=0 AND IsPlatform=0`, { s: b.slug }))[0];
  if (!co) throw new HttpError(404, 'NOT_FOUND', 'Company not found');
  const area = await checkArea(co.Id, b.city, b.district);
  if (!b.time && !b.period) throw new HttpError(400, 'VALIDATION_ERROR', 'Choose a time');
  if (b.time) await assertSlot(co.Id, b.date, b.time);
  const cu = (await query<{ Name: string; Phone: string }>(`SELECT Name, Phone FROM MarketplaceCustomers WHERE Id=@i AND IsDeleted=0`, { i: req.customerId }))[0];
  if (!cu) throw new HttpError(401, 'INVALID_TOKEN', 'Account not found');
  const lines: { serviceId: number; name: string; price: number; qty: number }[] = [];
  for (const it of b.items) {
    // Prices always come from the server, never from the browser.
    const s = (await query<{ Name: string; Price: number | null }>(
      `SELECT s.Name, p.Price FROM Services s
         OUTER APPLY (SELECT TOP 1 Price FROM ServicePrices sp WHERE sp.ServiceId=s.Id AND sp.Region IS NULL AND sp.CustomerType IS NULL
                        AND sp.ValidFrom <= CAST(SYSUTCDATETIME() AS DATE) AND (sp.ValidTo IS NULL OR sp.ValidTo >= CAST(SYSUTCDATETIME() AS DATE))
                      ORDER BY sp.ValidFrom DESC, sp.Id DESC) p
        WHERE s.Id=@i AND s.CompanyId=@c AND s.IsActive=1 AND s.IsDeleted=0`, { i: it.serviceId, c: co.Id }))[0];
    if (!s || s.Price == null) throw new HttpError(400, 'BAD_SERVICE', 'A service in the cart is no longer available');
    lines.push({ serviceId: it.serviceId, name: s.Name, price: Number(s.Price), qty: it.qty });
  }
  const total = Math.round(lines.reduce((a, l) => a + l.price * l.qty, 0) * 100) / 100;
  const id = await withTx(async (tx) => {
    const r = await query<{ Id: number }>(
      `INSERT INTO BookingRequests (CompanyId, ServiceId, CustomerName, Phone, Address, PreferredDate, PreferredPeriod, Notes, CustomerId, PaymentMethod, Total, City, District, Latitude, Longitude, PhotoUrl, PreferredTime)
       OUTPUT inserted.Id VALUES (@c,@s,@n,@p,@a,@d,@pe,@no,@cu,'cash',@t,@ci,@di,@la,@ln,@ph,@tm)`,
      { tm: b.time ?? null, la: b.lat ?? null, ln: b.lng ?? null, ph: b.photoUrl ?? null, ci: area.city, di: area.district, c: co.Id, s: lines[0].serviceId, n: cu.Name, p: cu.Phone, a: b.address, d: b.date, pe: b.time ? periodOf(b.time) : b.period!, no: b.notes ?? null, cu: req.customerId, t: money(total) }, tx);
    for (const l of lines) await query(`INSERT INTO BookingRequestItems (RequestId, ServiceId, Name, UnitPrice, Qty) VALUES (@r,@s,@n,@u,@q)`, { r: r[0].Id, s: l.serviceId, n: l.name, u: money(l.price), q: l.qty }, tx);
    return Number(r[0].Id);
  });
  res.status(201).json({ id, total, status: 'new', paymentMethod: 'cash' });
}));

shopRouter.get('/orders', customerAuth, h(async (req, res) => {
  const rows = await query<Record<string, any>>(
    `SELECT r.Id, r.Status, r.PaymentMethod, r.PaymentStatus, r.Total, r.PreferredDate, r.PreferredPeriod, r.PreferredTime, r.Address, r.City, r.District, r.CreatedAt, c.Name AS CompanyName, c.Slug,
            CASE WHEN r.Status IN ('contacted','confirmed','cancelled') AND ISNULL(r.CustomerSeenStatus,'new')<>r.Status THEN 1 ELSE 0 END AS Unseen
       FROM BookingRequests r JOIN Companies c ON c.Id=r.CompanyId WHERE r.CustomerId=@i ORDER BY r.CreatedAt DESC`, { i: req.customerId });
  const items = rows.length ? await query<Record<string, any>>(`SELECT RequestId, Name, UnitPrice, Qty FROM BookingRequestItems WHERE RequestId IN (SELECT Id FROM BookingRequests WHERE CustomerId=@i)`, { i: req.customerId }) : [];
  res.json({ items: rows.map((r) => ({ ...r, Items: items.filter((x) => x.RequestId === r.Id) })) });
}));

const STAGE_AR: Record<string, string> = { depart: 'التحرك للعميل', arrive: 'الوصول للعميل', start: 'بدء العمل', progress: 'متابعة العمل', finish: 'إنهاء العمل', cash: 'استلام الكاش' };

/** A signed-in customer complains about one of their own orders (optionally about one stage of the job). */
shopRouter.post('/orders/:id/complaints', customerAuth, h(async (req, res) => {
  const id = parse(z.coerce.number().int().positive(), req.params.id);
  const b = parse(z.object({ message: z.string().trim().min(10).max(950), stage: z.enum(['depart', 'arrive', 'start', 'progress', 'finish', 'cash']).optional() }), req.body);
  const o = (await query<{ CompanyId: number; CustomerName: string; Phone: string }>(`SELECT CompanyId, CustomerName, Phone FROM BookingRequests WHERE Id=@i AND CustomerId=@c`, { i: id, c: req.customerId }))[0];
  if (!o) throw new HttpError(404, 'NOT_FOUND', 'Order not found');
  const r = await query<{ Id: number }>(`INSERT INTO Complaints (CompanyId, RequestId, CustomerId, CustomerName, Phone, Message, Stage) OUTPUT inserted.Id VALUES (@co,@r,@cu,@n,@p,@m,@st)`, { co: o.CompanyId, r: id, cu: req.customerId, n: o.CustomerName, p: o.Phone, m: b.stage ? `[${STAGE_AR[b.stage]}] ${b.message}` : b.message, st: b.stage ?? null });
  res.status(201).json({ id: r[0].Id });
}));

/** Order tracking: request and confirmation dates plus what the supervisor recorded at each stage (notes, photos, videos). */
shopRouter.get('/orders/:id/track', customerAuth, h(async (req, res) => {
  const id = parse(z.coerce.number().int().positive(), req.params.id);
  const o = (await query<Record<string, any>>(
    `SELECT r.Id, r.Status, r.CreatedAt, r.BookingId, b.CreatedAt AS ConfirmedAt, b.Status AS JobStatus, c.Name AS CompanyName, c.Slug
       FROM BookingRequests r JOIN Companies c ON c.Id=r.CompanyId LEFT JOIN Bookings b ON b.Id=r.BookingId WHERE r.Id=@i AND r.CustomerId=@c`, { i: id, c: req.customerId }))[0];
  if (!o) throw new HttpError(404, 'NOT_FOUND', 'Order not found');
  const events = o.BookingId ? await query<Record<string, any>>(
    `SELECT e.Id, e.Stage, e.Note, e.Amount, e.CreatedAt, (SELECT f.Id, f.Kind FROM BookingStageFiles f WHERE f.EventId=e.Id FOR JSON PATH) AS FilesJson
       FROM BookingStageEvents e WHERE e.BookingId=@b AND e.Stage<>'next' ORDER BY e.Id`, { b: o.BookingId }) : [];
  res.json({
    requestId: o.Id, status: o.Status, company: o.CompanyName, slug: o.Slug, requestedAt: o.CreatedAt, confirmedAt: o.ConfirmedAt ?? null,
    events: events.map((e) => ({ id: e.Id, stage: e.Stage, note: e.Note, amount: e.Amount, at: e.CreatedAt, files: e.FilesJson ? JSON.parse(e.FilesJson) : [] })),
  });
}));

shopRouter.get('/orders/:id/track/files/:fid', customerAuth, h(async (req, res) => {
  const id = parse(z.coerce.number().int().positive(), req.params.id);
  const fid = parse(z.coerce.number().int().positive(), req.params.fid);
  const f = (await query<Record<string, any>>(
    `SELECT f.MimeType, f.Data FROM BookingStageFiles f JOIN BookingRequests r ON r.BookingId=f.BookingId JOIN BookingStageEvents e ON e.Id=f.EventId
      WHERE f.Id=@f AND r.Id=@i AND r.CustomerId=@c AND e.Stage<>'next'`, { f: fid, i: id, c: req.customerId }))[0];
  if (!f) throw new HttpError(404, 'NOT_FOUND', 'File not found');
  res.setHeader('Content-Type', f.MimeType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(f.Data);
}));

/** Attach earlier visitor requests made with this mobile number (before the account existed). The number is not verified, so the customer asks for it explicitly. */
shopRouter.post('/orders/claim', customerAuth, h(async (req, res) => {
  const me = (await query<{ Phone: string }>(`SELECT Phone FROM MarketplaceCustomers WHERE Id=@c AND IsDeleted=0`, { c: req.customerId }))[0];
  const r = me ? await query(`UPDATE BookingRequests SET CustomerId=@c OUTPUT INSERTED.Id WHERE CustomerId IS NULL AND Phone=@p`, { c: req.customerId, p: me.Phone }) : [];
  res.json({ linked: r.length });
}));

/** The customer has looked at the status changes. */
shopRouter.post('/orders/seen', customerAuth, h(async (req, res) => {
  await query(`UPDATE BookingRequests SET CustomerSeenStatus=Status WHERE CustomerId=@c AND (CustomerSeenStatus IS NULL OR CustomerSeenStatus<>Status)`, { c: req.customerId });
  res.json({ ok: true });
}));
