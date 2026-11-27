import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { query } from '../db';
import { HttpError, h, parse } from '../errors';
import rateLimit from 'express-rate-limit';
import { isSaudiMobile } from '../lib/otp';

/** Public, read-only marketplace endpoints. Only approved companies are ever visible. */
export const marketRouter = Router();

marketRouter.get('/sectors', h(async (_req, res) => {
  const items = await query(
    `SELECT s.Code, s.NameAr, s.NameEn,
            (SELECT COUNT(*) FROM CompanySectors cs JOIN Companies c ON c.Id=cs.CompanyId
              WHERE cs.SectorId=s.Id AND c.Status='approved' AND c.IsDeleted=0 AND c.IsPlatform=0) AS Companies
       FROM Sectors s WHERE s.IsActive=1 ORDER BY s.SortOrder, s.Id`,
  );
  res.json({ items });
}));

marketRouter.get('/companies', h(async (req, res) => {
  const q = parse(z.object({ sector: z.string().max(40).optional(), q: z.string().max(100).optional() }), req.query);
  const search = q.q ? q.q.replace(/[\\%_\[]/g, '') : '';
  const items = await query(
    `SELECT c.Slug, c.Name, c.Description, c.LogoUrl, c.CoverUrl, c.PrimaryColor, c.ReviewedAt,
            (SELECT STRING_AGG(s.Code, ',') FROM CompanySectors cs JOIN Sectors s ON s.Id=cs.SectorId WHERE cs.CompanyId=c.Id) AS Sectors
       FROM Companies c
      WHERE c.Status='approved' AND c.IsDeleted=0 AND c.IsPlatform=0 AND c.Slug IS NOT NULL
        AND (@sector IS NULL OR EXISTS (SELECT 1 FROM CompanySectors cs JOIN Sectors s ON s.Id=cs.SectorId WHERE cs.CompanyId=c.Id AND s.Code=@sector))
        AND (@q = '' OR c.Name LIKE '%' + @q + '%')
      ORDER BY c.ReviewedAt DESC, c.Id DESC`,
    { sector: q.sector ?? null, q: search },
  );
  res.json({ items: items.map((r) => ({ ...r, Sectors: r.Sectors ? String(r.Sectors).split(',') : [] })) });
}));

marketRouter.get('/companies/:slug', h(async (req, res) => {
  const slug = parse(z.string().regex(/^[a-z0-9-]{3,60}$/), req.params.slug);
  const c = (await query<Record<string, any>>(
    `SELECT Id, Slug, Name, Description, LogoUrl, CoverUrl, WhatsApp, PrimaryColor FROM Companies WHERE Slug=@s AND Status='approved' AND IsDeleted=0 AND IsPlatform=0`,
    { s: slug },
  ))[0];
  if (!c) throw new HttpError(404, 'NOT_FOUND', 'Company not found');
  const services = await query(
    `SELECT s.Id, s.Name, s.PricingMethod, s.DefaultMinutes, s.ImageUrl, s.Category, s.Description, s.Includes, s.Notes, p.Price AS FromPrice, p.Unit
       FROM Services s
       OUTER APPLY (SELECT TOP 1 Price, Unit FROM ServicePrices sp
                     WHERE sp.ServiceId=s.Id AND sp.Region IS NULL AND sp.CustomerType IS NULL
                       AND sp.ValidFrom <= CAST(SYSUTCDATETIME() AS DATE) AND (sp.ValidTo IS NULL OR sp.ValidTo >= CAST(SYSUTCDATETIME() AS DATE))
                     ORDER BY sp.ValidFrom DESC, sp.Id DESC) p
      WHERE s.CompanyId=@c AND s.IsActive=1 AND s.IsDeleted=0 ORDER BY s.Name`,
    { c: c.Id },
  );
  const sectors = await query(`SELECT s.Code, s.NameAr, s.NameEn FROM CompanySectors cs JOIN Sectors s ON s.Id=cs.SectorId WHERE cs.CompanyId=@c`, { c: c.Id });
  const categories = await query(`SELECT Name, ImageUrl FROM ServiceCategories WHERE CompanyId=@c AND ImageUrl IS NOT NULL ORDER BY SortOrder, Id`, { c: c.Id });
  res.json({ categories, slug: c.Slug, name: c.Name, description: c.Description, logoUrl: c.LogoUrl, coverUrl: c.CoverUrl, whatsapp: c.WhatsApp ? '966' + String(c.WhatsApp).slice(1) : null, primaryColor: c.PrimaryColor, sectors, services });
}));

const requestLimiter = rateLimit({ windowMs: 10 * 60_000, limit: 8, standardHeaders: true, legacyHeaders: false, skip: () => config.env === 'test' });
const riyadhToday = (): string => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);

/** A visitor asks a company for a service. Nothing is reserved or charged; the company calls to confirm. */
marketRouter.post('/companies/:slug/requests', requestLimiter, h(async (req, res) => {
  const slug = parse(z.string().regex(/^[a-z0-9-]{3,60}$/), req.params.slug);
  const b = parse(z.object({
    serviceId: z.number().int().positive(),
    customerName: z.string().trim().min(2).max(120),
    phone: z.string().trim().refine(isSaudiMobile, 'Saudi mobile (05XXXXXXXX)'),
    address: z.string().trim().max(300).optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    period: z.enum(['morning', 'afternoon', 'evening']),
    notes: z.string().trim().max(500).optional(),
  }), req.body);
  const today = riyadhToday();
  const max = new Date(Date.parse(today) + 90 * 86400_000).toISOString().slice(0, 10);
  if (b.date < today || b.date > max || Number.isNaN(Date.parse(b.date))) throw new HttpError(400, 'BAD_DATE', 'Choose a date within the next 90 days');
  const c = (await query<{ Id: number }>(`SELECT Id FROM Companies WHERE Slug=@s AND Status='approved' AND IsDeleted=0 AND IsPlatform=0`, { s: slug }))[0];
  if (!c) throw new HttpError(404, 'NOT_FOUND', 'Company not found');
  const svc = await query(`SELECT 1 AS x FROM Services WHERE Id=@i AND CompanyId=@c AND IsActive=1 AND IsDeleted=0`, { i: b.serviceId, c: c.Id });
  if (!svc.length) throw new HttpError(400, 'BAD_SERVICE', 'Unknown service');
  const r = await query<{ Id: number }>(
    `INSERT INTO BookingRequests (CompanyId, ServiceId, CustomerName, Phone, Address, PreferredDate, PreferredPeriod, Notes)
     OUTPUT inserted.Id VALUES (@c,@s,@n,@p,@a,@d,@pe,@no)`,
    { c: c.Id, s: b.serviceId, n: b.customerName, p: b.phone, a: b.address ?? null, d: b.date, pe: b.period, no: b.notes ?? null },
  );
  res.status(201).json({ id: r[0].Id, status: 'new' });
}));

const complaintLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 5, standardHeaders: true, legacyHeaders: false, skip: () => config.env === 'test' });
/** A visitor reports a problem with a company; the platform team reviews it. */
marketRouter.post('/companies/:slug/complaints', complaintLimiter, h(async (req, res) => {
  const slug = parse(z.string().regex(/^[a-z0-9-]{3,60}$/), req.params.slug);
  const b = parse(z.object({
    customerName: z.string().trim().min(2).max(120),
    phone: z.string().trim().refine(isSaudiMobile, 'Saudi mobile (05XXXXXXXX)'),
    message: z.string().trim().min(10).max(1000),
  }), req.body);
  const c = (await query<{ Id: number }>(`SELECT Id FROM Companies WHERE Slug=@s AND Status IN ('approved','suspended') AND IsDeleted=0 AND IsPlatform=0`, { s: slug }))[0];
  if (!c) throw new HttpError(404, 'NOT_FOUND', 'Company not found');
  const r = await query<{ Id: number }>(`INSERT INTO Complaints (CompanyId, CustomerName, Phone, Message) OUTPUT inserted.Id VALUES (@c,@n,@p,@m)`, { c: c.Id, n: b.customerName, p: b.phone, m: b.message });
  res.status(201).json({ id: r[0].Id });
}));

marketRouter.get('/brand', h(async (_req, res) => {
  const r = await query<{ Value: string }>(`SELECT s.Value FROM SystemSettings s JOIN Companies c ON c.Id=s.CompanyId WHERE c.IsPlatform=1 AND s.[Key]='brand.logoUrl'`);
  res.json({ logoUrl: r[0]?.Value ?? null });
}));

/** What the sign-up and sign-in screens should offer. */
marketRouter.get('/config', (_req, res) => {
  res.json({ phoneVerification: config.otp.required });
});
