import { Router } from 'express';
import { z } from 'zod';
import { dt, money, query, withTx } from '../db';
import { HttpError, h, parse } from '../errors';
import { requirePerm } from '../auth/middleware';
import { imageRef } from '../lib/company';

export const servicesRouter = Router();

const PRICING = ['fixed', 'hourly', 'per_technician', 'per_sqm', 'per_item', 'per_visit', 'per_room', 'per_property_type'] as const;

const serviceSchema = z.object({
  name: z.string().min(2).max(200),
  pricingMethod: z.enum(PRICING),
  defaultMinutes: z.number().int().min(15).max(24 * 60),
  defaultTechnicians: z.number().int().min(1).max(50).default(1),
  price: z.number().min(0).max(1_000_000),
  unit: z.string().max(20).default('unit'),
  imageUrl: imageRef,
  description: z.string().trim().max(1000).nullable().optional(),
  includes: z.array(z.string().trim().min(1).max(120)).max(10).optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  category: z.string().trim().max(80).nullable().optional(),
});

/** Categories = distinct Services.Category text plus any category that only has a picture so far. */
servicesRouter.get(
  '/categories',
  requirePerm('services.view'),
  h(async (req, res) => {
    const items = await query(
      `SELECT n.Name, c.ImageUrl, (SELECT COUNT(*) FROM Services s WHERE s.CompanyId=@c AND s.IsDeleted=0 AND s.Category=n.Name) AS Services
         FROM (SELECT Category AS Name FROM Services WHERE CompanyId=@c AND IsDeleted=0 AND Category IS NOT NULL
               UNION SELECT Name FROM ServiceCategories WHERE CompanyId=@c) n
         LEFT JOIN ServiceCategories c ON c.CompanyId=@c AND c.Name=n.Name
        ORDER BY n.Name`,
      { c: req.user!.companyId },
    );
    res.json({ items });
  }),
);

servicesRouter.put(
  '/categories',
  requirePerm('services.manage'),
  h(async (req, res) => {
    const b = parse(z.object({ name: z.string().trim().min(2).max(80), imageUrl: imageRef }), req.body);
    await query(
      `MERGE ServiceCategories AS t USING (SELECT @c AS CompanyId, @n AS Name) AS s ON t.CompanyId=s.CompanyId AND t.Name=s.Name
       WHEN MATCHED THEN UPDATE SET ImageUrl=@im WHEN NOT MATCHED THEN INSERT (CompanyId, Name, ImageUrl) VALUES (@c,@n,@im);`,
      { c: req.user!.companyId, n: b.name, im: b.imageUrl ?? null },
    );
    res.json({ name: b.name, imageUrl: b.imageUrl ?? null });
  }),
);

servicesRouter.patch(
  '/categories',
  requirePerm('services.manage'),
  h(async (req, res) => {
    const b = parse(z.object({ from: z.string().trim().min(1).max(80), to: z.string().trim().min(2).max(80) }), req.body);
    const c = req.user!.companyId;
    if (b.from === b.to) { res.json({ ok: true }); return; }
    const clash = await query(`SELECT 1 AS x FROM ServiceCategories WHERE CompanyId=@c AND Name=@t UNION SELECT 1 FROM Services WHERE CompanyId=@c AND IsDeleted=0 AND Category=@t`, { c, t: b.to });
    if (clash.length) throw new HttpError(409, 'CATEGORY_EXISTS', 'A section with this name already exists');
    await withTx(async (tx) => {
      await query(`UPDATE Services SET Category=@t WHERE CompanyId=@c AND Category=@f`, { c, f: b.from, t: b.to }, tx);
      const had = await query(`SELECT 1 AS x FROM ServiceCategories WHERE CompanyId=@c AND Name=@f`, { c, f: b.from }, tx);
      if (had.length) await query(`UPDATE ServiceCategories SET Name=@t WHERE CompanyId=@c AND Name=@f`, { c, f: b.from, t: b.to }, tx);
    });
    res.json({ ok: true });
  }),
);

servicesRouter.delete(
  '/categories',
  requirePerm('services.manage'),
  h(async (req, res) => {
    const b = parse(z.object({ name: z.string().trim().min(1).max(80) }), req.query);
    const used = await query<{ N: number }>(
      `SELECT COUNT(*) AS N FROM Services WHERE CompanyId=@c AND IsDeleted=0 AND Category=@n`,
      { c: req.user!.companyId, n: b.name },
    );
    if (used[0].N > 0) throw new HttpError(409, 'CATEGORY_IN_USE', `Section has ${used[0].N} services`);
    await query(`DELETE FROM ServiceCategories WHERE CompanyId=@c AND Name=@n`, { c: req.user!.companyId, n: b.name });
    res.json({ ok: true });
  }),
);

servicesRouter.get(
  '/',
  requirePerm('services.view'),
  h(async (req, res) => {
    const rows = await query(
      `SELECT s.Id, s.Name, s.PricingMethod, s.DefaultMinutes, s.DefaultTechnicians, s.IsActive, s.ImageUrl, s.Category, s.Description, s.Includes, s.Notes,
              p.Price AS CurrentPrice, p.Unit
         FROM Services s
         OUTER APPLY (SELECT TOP 1 Price, Unit FROM ServicePrices sp
                       WHERE sp.ServiceId = s.Id AND sp.Region IS NULL AND sp.CustomerType IS NULL
                         AND sp.ValidFrom <= CAST(SYSUTCDATETIME() AS DATE) AND (sp.ValidTo IS NULL OR sp.ValidTo >= CAST(SYSUTCDATETIME() AS DATE))
                       ORDER BY sp.ValidFrom DESC, sp.Id DESC) p
        WHERE s.CompanyId = @c AND s.IsDeleted = 0 ORDER BY s.Name`,
      { c: req.user!.companyId },
    );
    res.json({ items: rows });
  }),
);

servicesRouter.post(
  '/',
  requirePerm('services.manage'),
  h(async (req, res) => {
    const b = parse(serviceSchema, req.body);
    const id = await withTx(async (tx) => {
      const r = await query<{ Id: number }>(
        `INSERT INTO Services (CompanyId, Name, PricingMethod, DefaultMinutes, DefaultTechnicians, ImageUrl, Category, Description, Includes, Notes) OUTPUT INSERTED.Id VALUES (@c,@n,@pm,@dm,@dt,@im,@cat,@de,@inc,@no)`,
        { c: req.user!.companyId, n: b.name, pm: b.pricingMethod, dm: b.defaultMinutes, dt: b.defaultTechnicians, im: b.imageUrl ?? null, cat: b.category || null, de: b.description || null, inc: b.includes?.length ? b.includes.join('\n') : null, no: b.notes || null },
        tx,
      );
      const sid = Number(r[0].Id);
      await query(
        `INSERT INTO ServicePrices (ServiceId, Price, Unit, ValidFrom) VALUES (@s, @p, @u, CAST(SYSUTCDATETIME() AS DATE))`,
        { s: sid, p: money(b.price), u: b.unit },
        tx,
      );
      return sid;
    });
    res.status(201).json({ id });
  }),
);

servicesRouter.put(
  '/:id',
  requirePerm('services.manage'),
  h(async (req, res) => {
    const id = parse(z.coerce.number().int().positive(), req.params.id);
    const b = parse(serviceSchema.pick({ name: true, pricingMethod: true, defaultMinutes: true, defaultTechnicians: true, imageUrl: true, category: true, description: true, includes: true, notes: true }).extend({ isActive: z.boolean().default(true) }), req.body);
    const r = await query(
      `UPDATE Services SET Name=@n, PricingMethod=@pm, DefaultMinutes=@dm, DefaultTechnicians=@dt, IsActive=@a,
              ImageUrl = CASE WHEN @hasIm = 1 THEN @im ELSE ImageUrl END, Category = CASE WHEN @hasCat = 1 THEN @cat ELSE Category END,
              Description = CASE WHEN @hasDe = 1 THEN @de ELSE Description END, Includes = CASE WHEN @hasInc = 1 THEN @inc ELSE Includes END, Notes = CASE WHEN @hasNo = 1 THEN @no ELSE Notes END OUTPUT INSERTED.Id WHERE Id=@i AND CompanyId=@c AND IsDeleted=0`,
      { i: id, c: req.user!.companyId, n: b.name, pm: b.pricingMethod, dm: b.defaultMinutes, dt: b.defaultTechnicians, a: b.isActive, hasIm: b.imageUrl !== undefined ? 1 : 0, im: b.imageUrl ?? null, hasCat: b.category !== undefined ? 1 : 0, cat: b.category || null,
        hasDe: b.description !== undefined ? 1 : 0, de: b.description || null, hasInc: b.includes !== undefined ? 1 : 0, inc: b.includes?.length ? b.includes.join('\n') : null, hasNo: b.notes !== undefined ? 1 : 0, no: b.notes || null },
    );
    if (!r[0]) throw new HttpError(404, 'NOT_FOUND', 'Service not found');
    res.json({ id });
  }),
);

/** Adds a new price version; the previous default price is closed the day before. */
servicesRouter.post(
  '/:id/prices',
  requirePerm('services.manage'),
  h(async (req, res) => {
    const id = parse(z.coerce.number().int().positive(), req.params.id);
    const b = parse(
      z.object({ price: z.number().min(0).max(1_000_000), unit: z.string().max(20).default('unit'), region: z.string().max(100).optional(), customerType: z.enum(['individual', 'company']).optional(), validFrom: z.coerce.date().optional() }),
      req.body,
    );
    const own = await query(`SELECT Id FROM Services WHERE Id=@i AND CompanyId=@c AND IsDeleted=0`, { i: id, c: req.user!.companyId });
    if (!own[0]) throw new HttpError(404, 'NOT_FOUND', 'Service not found');
    await query(
      `INSERT INTO ServicePrices (ServiceId, Price, Unit, Region, CustomerType, ValidFrom) VALUES (@s, @p, @u, @r, @ct, CAST(@vf AS DATE))`,
      { s: id, p: money(b.price), u: b.unit, r: b.region ?? null, ct: b.customerType ?? null, vf: dt(b.validFrom ?? new Date()) },
    );
    res.status(201).json({ ok: true });
  }),
);
