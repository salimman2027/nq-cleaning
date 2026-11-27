import { Router } from 'express';
import { z } from 'zod';
import { dt, money, query, withTx } from '../db';
import { HttpError, h, parse } from '../errors';
import { requirePerm } from '../auth/middleware';

export const servicesRouter = Router();

const PRICING = ['fixed', 'hourly', 'per_technician', 'per_sqm', 'per_item', 'per_visit', 'per_room', 'per_property_type'] as const;

const serviceSchema = z.object({
  name: z.string().min(2).max(200),
  pricingMethod: z.enum(PRICING),
  defaultMinutes: z.number().int().min(15).max(24 * 60),
  defaultTechnicians: z.number().int().min(1).max(50).default(1),
  price: z.number().min(0).max(1_000_000),
  unit: z.string().max(20).default('unit'),
  imageUrl: z.string().url().max(500).refine((u) => u.startsWith('https://'), 'https only').nullable().optional(),
  category: z.string().trim().max(80).nullable().optional(),
});

servicesRouter.get(
  '/',
  requirePerm('services.view'),
  h(async (req, res) => {
    const rows = await query(
      `SELECT s.Id, s.Name, s.PricingMethod, s.DefaultMinutes, s.DefaultTechnicians, s.IsActive, s.ImageUrl, s.Category,
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
        `INSERT INTO Services (CompanyId, Name, PricingMethod, DefaultMinutes, DefaultTechnicians, ImageUrl, Category) OUTPUT INSERTED.Id VALUES (@c,@n,@pm,@dm,@dt,@im,@cat)`,
        { c: req.user!.companyId, n: b.name, pm: b.pricingMethod, dm: b.defaultMinutes, dt: b.defaultTechnicians, im: b.imageUrl ?? null, cat: b.category || null },
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
    const b = parse(serviceSchema.pick({ name: true, pricingMethod: true, defaultMinutes: true, defaultTechnicians: true, imageUrl: true, category: true }).extend({ isActive: z.boolean().default(true) }), req.body);
    const r = await query(
      `UPDATE Services SET Name=@n, PricingMethod=@pm, DefaultMinutes=@dm, DefaultTechnicians=@dt, IsActive=@a,
              ImageUrl = CASE WHEN @hasIm = 1 THEN @im ELSE ImageUrl END, Category = CASE WHEN @hasCat = 1 THEN @cat ELSE Category END OUTPUT INSERTED.Id WHERE Id=@i AND CompanyId=@c AND IsDeleted=0`,
      { i: id, c: req.user!.companyId, n: b.name, pm: b.pricingMethod, dm: b.defaultMinutes, dt: b.defaultTechnicians, a: b.isActive, hasIm: b.imageUrl !== undefined ? 1 : 0, im: b.imageUrl ?? null, hasCat: b.category !== undefined ? 1 : 0, cat: b.category || null },
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
