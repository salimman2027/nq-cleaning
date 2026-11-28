"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.servicesRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../db");
const errors_1 = require("../errors");
const middleware_1 = require("../auth/middleware");
const company_1 = require("../lib/company");
const starter_1 = require("../services/starter");
exports.servicesRouter = (0, express_1.Router)();
const PRICING = ['fixed', 'hourly', 'per_technician', 'per_sqm', 'per_item', 'per_visit', 'per_room', 'per_property_type'];
const serviceSchema = zod_1.z.object({
    name: zod_1.z.string().min(2).max(200),
    pricingMethod: zod_1.z.enum(PRICING),
    defaultMinutes: zod_1.z.number().int().min(15).max(24 * 60),
    defaultTechnicians: zod_1.z.number().int().min(1).max(50).default(1),
    price: zod_1.z.number().min(0).max(1_000_000),
    unit: zod_1.z.string().max(20).default('unit'),
    imageUrl: company_1.imageRef,
    description: zod_1.z.string().trim().max(1000).nullable().optional(),
    includes: zod_1.z.array(zod_1.z.string().trim().min(1).max(120)).max(10).optional(),
    notes: zod_1.z.string().trim().max(500).nullable().optional(),
    category: zod_1.z.string().trim().max(80).nullable().optional(),
});
/** Categories = distinct Services.Category text plus any category that only has a picture so far. */
exports.servicesRouter.get('/categories', (0, middleware_1.requirePerm)('services.view'), (0, errors_1.h)(async (req, res) => {
    const items = await (0, db_1.query)(`SELECT n.Name, c.ImageUrl, c.SectorId, (SELECT COUNT(*) FROM Services s WHERE s.CompanyId=@c AND s.IsDeleted=0 AND s.Category=n.Name) AS Services
         FROM (SELECT Category AS Name FROM Services WHERE CompanyId=@c AND IsDeleted=0 AND Category IS NOT NULL
               UNION SELECT Name FROM ServiceCategories WHERE CompanyId=@c) n
         LEFT JOIN ServiceCategories c ON c.CompanyId=@c AND c.Name=n.Name
        ORDER BY n.Name`, { c: req.user.companyId });
    res.json({ items });
}));
/** ---- Sectors: groups of sections ---- */
exports.servicesRouter.get('/sectors', (0, middleware_1.requirePerm)('services.view'), (0, errors_1.h)(async (req, res) => {
    const items = await (0, db_1.query)(`SELECT Id, Name, SortOrder FROM ServiceSectors WHERE CompanyId=@c ORDER BY SortOrder, Id`, { c: req.user.companyId });
    res.json({ items, starter: starter_1.STARTER });
}));
exports.servicesRouter.post('/sectors', (0, middleware_1.requirePerm)('services.manage'), (0, errors_1.h)(async (req, res) => {
    const b = (0, errors_1.parse)(zod_1.z.object({ name: zod_1.z.string().trim().min(2).max(80) }), req.body);
    const c = req.user.companyId;
    if ((await (0, db_1.query)(`SELECT 1 AS x FROM ServiceSectors WHERE CompanyId=@c AND Name=@n`, { c, n: b.name })).length)
        throw new errors_1.HttpError(409, 'SECTOR_EXISTS', 'A sector with this name already exists');
    const r = await (0, db_1.query)(`INSERT INTO ServiceSectors (CompanyId, Name, SortOrder) OUTPUT INSERTED.Id SELECT @c, @n, ISNULL(MAX(SortOrder),0)+1 FROM ServiceSectors WHERE CompanyId=@c`, { c, n: b.name });
    res.status(201).json({ id: Number(r[0].Id) });
}));
exports.servicesRouter.patch('/sectors/:id', (0, middleware_1.requirePerm)('services.manage'), (0, errors_1.h)(async (req, res) => {
    const id = (0, errors_1.parse)(zod_1.z.coerce.number().int().positive(), req.params.id);
    const b = (0, errors_1.parse)(zod_1.z.object({ name: zod_1.z.string().trim().min(2).max(80) }), req.body);
    const c = req.user.companyId;
    if ((await (0, db_1.query)(`SELECT 1 AS x FROM ServiceSectors WHERE CompanyId=@c AND Name=@n AND Id<>@i`, { c, n: b.name, i: id })).length)
        throw new errors_1.HttpError(409, 'SECTOR_EXISTS', 'A sector with this name already exists');
    const r = await (0, db_1.query)(`UPDATE ServiceSectors SET Name=@n OUTPUT INSERTED.Id WHERE Id=@i AND CompanyId=@c`, { c, n: b.name, i: id });
    if (!r.length)
        throw new errors_1.HttpError(404, 'NOT_FOUND', 'Sector not found');
    res.json({ ok: true });
}));
/** Deleting a sector keeps its sections and services; the sections just become ungrouped. */
exports.servicesRouter.delete('/sectors/:id', (0, middleware_1.requirePerm)('services.manage'), (0, errors_1.h)(async (req, res) => {
    const id = (0, errors_1.parse)(zod_1.z.coerce.number().int().positive(), req.params.id);
    const c = req.user.companyId;
    await (0, db_1.withTx)(async (tx) => {
        await (0, db_1.query)(`UPDATE ServiceCategories SET SectorId=NULL WHERE CompanyId=@c AND SectorId=@i`, { c, i: id }, tx);
        await (0, db_1.query)(`DELETE FROM ServiceSectors WHERE CompanyId=@c AND Id=@i`, { c, i: id }, tx);
    });
    res.json({ ok: true });
}));
/** Put a section into a sector (or out of it with sectorId = null). */
exports.servicesRouter.put('/categories/sector', (0, middleware_1.requirePerm)('services.manage'), (0, errors_1.h)(async (req, res) => {
    const b = (0, errors_1.parse)(zod_1.z.object({ name: zod_1.z.string().trim().min(1).max(80), sectorId: zod_1.z.number().int().positive().nullable() }), req.body);
    const c = req.user.companyId;
    if (b.sectorId != null && !(await (0, db_1.query)(`SELECT 1 AS x FROM ServiceSectors WHERE Id=@i AND CompanyId=@c`, { i: b.sectorId, c })).length)
        throw new errors_1.HttpError(404, 'NOT_FOUND', 'Sector not found');
    await (0, db_1.query)(`MERGE ServiceCategories AS t USING (SELECT @c AS CompanyId, @n AS Name) AS s ON t.CompanyId=s.CompanyId AND t.Name=s.Name
     WHEN MATCHED THEN UPDATE SET SectorId=@s WHEN NOT MATCHED THEN INSERT (CompanyId, Name, SectorId) VALUES (@c,@n,@s);`, { c, n: b.name, s: b.sectorId });
    res.json({ ok: true });
}));
/** Creates the suggested sectors and sections (names only, no services or prices). Existing names are kept and only grouped. */
exports.servicesRouter.post('/sectors/starter', (0, middleware_1.requirePerm)('services.manage'), (0, errors_1.h)(async (req, res) => {
    const c = req.user.companyId;
    await (0, db_1.withTx)(async (tx) => {
        let order = 0;
        for (const sec of starter_1.STARTER) {
            order++;
            let row = (await (0, db_1.query)(`SELECT Id FROM ServiceSectors WHERE CompanyId=@c AND Name=@n`, { c, n: sec.ar }, tx))[0];
            if (!row)
                row = (await (0, db_1.query)(`INSERT INTO ServiceSectors (CompanyId, Name, SortOrder) OUTPUT INSERTED.Id VALUES (@c,@n,@o)`, { c, n: sec.ar, o: order }, tx))[0];
            for (const cat of sec.sections) {
                await (0, db_1.query)(`MERGE ServiceCategories AS t USING (SELECT @c AS CompanyId, @n AS Name) AS s ON t.CompanyId=s.CompanyId AND t.Name=s.Name
           WHEN MATCHED AND t.SectorId IS NULL THEN UPDATE SET SectorId=@s WHEN NOT MATCHED THEN INSERT (CompanyId, Name, SectorId) VALUES (@c,@n,@s);`, { c, n: cat.ar, s: Number(row.Id) }, tx);
            }
        }
    });
    res.json({ ok: true });
}));
exports.servicesRouter.put('/categories', (0, middleware_1.requirePerm)('services.manage'), (0, errors_1.h)(async (req, res) => {
    const b = (0, errors_1.parse)(zod_1.z.object({ name: zod_1.z.string().trim().min(2).max(80), imageUrl: company_1.imageRef }), req.body);
    await (0, db_1.query)(`MERGE ServiceCategories AS t USING (SELECT @c AS CompanyId, @n AS Name) AS s ON t.CompanyId=s.CompanyId AND t.Name=s.Name
       WHEN MATCHED THEN UPDATE SET ImageUrl=@im WHEN NOT MATCHED THEN INSERT (CompanyId, Name, ImageUrl) VALUES (@c,@n,@im);`, { c: req.user.companyId, n: b.name, im: b.imageUrl ?? null });
    res.json({ name: b.name, imageUrl: b.imageUrl ?? null });
}));
exports.servicesRouter.patch('/categories', (0, middleware_1.requirePerm)('services.manage'), (0, errors_1.h)(async (req, res) => {
    const b = (0, errors_1.parse)(zod_1.z.object({ from: zod_1.z.string().trim().min(1).max(80), to: zod_1.z.string().trim().min(2).max(80) }), req.body);
    const c = req.user.companyId;
    if (b.from === b.to) {
        res.json({ ok: true });
        return;
    }
    const clash = await (0, db_1.query)(`SELECT 1 AS x FROM ServiceCategories WHERE CompanyId=@c AND Name=@t UNION SELECT 1 FROM Services WHERE CompanyId=@c AND IsDeleted=0 AND Category=@t`, { c, t: b.to });
    if (clash.length)
        throw new errors_1.HttpError(409, 'CATEGORY_EXISTS', 'A section with this name already exists');
    await (0, db_1.withTx)(async (tx) => {
        await (0, db_1.query)(`UPDATE Services SET Category=@t WHERE CompanyId=@c AND Category=@f`, { c, f: b.from, t: b.to }, tx);
        const had = await (0, db_1.query)(`SELECT 1 AS x FROM ServiceCategories WHERE CompanyId=@c AND Name=@f`, { c, f: b.from }, tx);
        if (had.length)
            await (0, db_1.query)(`UPDATE ServiceCategories SET Name=@t WHERE CompanyId=@c AND Name=@f`, { c, f: b.from, t: b.to }, tx);
    });
    res.json({ ok: true });
}));
exports.servicesRouter.delete('/categories', (0, middleware_1.requirePerm)('services.manage'), (0, errors_1.h)(async (req, res) => {
    const b = (0, errors_1.parse)(zod_1.z.object({ name: zod_1.z.string().trim().min(1).max(80) }), req.query);
    const used = await (0, db_1.query)(`SELECT COUNT(*) AS N FROM Services WHERE CompanyId=@c AND IsDeleted=0 AND Category=@n`, { c: req.user.companyId, n: b.name });
    if (used[0].N > 0)
        throw new errors_1.HttpError(409, 'CATEGORY_IN_USE', `Section has ${used[0].N} services`);
    await (0, db_1.query)(`DELETE FROM ServiceCategories WHERE CompanyId=@c AND Name=@n`, { c: req.user.companyId, n: b.name });
    res.json({ ok: true });
}));
exports.servicesRouter.get('/', (0, middleware_1.requirePerm)('services.view'), (0, errors_1.h)(async (req, res) => {
    const rows = await (0, db_1.query)(`SELECT s.Id, s.Name, s.PricingMethod, s.DefaultMinutes, s.DefaultTechnicians, s.IsActive, s.ImageUrl, s.Category, s.Description, s.Includes, s.Notes,
              p.Price AS CurrentPrice, p.Unit
         FROM Services s
         OUTER APPLY (SELECT TOP 1 Price, Unit FROM ServicePrices sp
                       WHERE sp.ServiceId = s.Id AND sp.Region IS NULL AND sp.CustomerType IS NULL
                         AND sp.ValidFrom <= CAST(SYSUTCDATETIME() AS DATE) AND (sp.ValidTo IS NULL OR sp.ValidTo >= CAST(SYSUTCDATETIME() AS DATE))
                       ORDER BY sp.ValidFrom DESC, sp.Id DESC) p
        WHERE s.CompanyId = @c AND s.IsDeleted = 0 ORDER BY s.Name`, { c: req.user.companyId });
    res.json({ items: rows });
}));
exports.servicesRouter.post('/', (0, middleware_1.requirePerm)('services.manage'), (0, errors_1.h)(async (req, res) => {
    const b = (0, errors_1.parse)(serviceSchema, req.body);
    const id = await (0, db_1.withTx)(async (tx) => {
        const r = await (0, db_1.query)(`INSERT INTO Services (CompanyId, Name, PricingMethod, DefaultMinutes, DefaultTechnicians, ImageUrl, Category, Description, Includes, Notes) OUTPUT INSERTED.Id VALUES (@c,@n,@pm,@dm,@dt,@im,@cat,@de,@inc,@no)`, { c: req.user.companyId, n: b.name, pm: b.pricingMethod, dm: b.defaultMinutes, dt: b.defaultTechnicians, im: b.imageUrl ?? null, cat: b.category || null, de: b.description || null, inc: b.includes?.length ? b.includes.join('\n') : null, no: b.notes || null }, tx);
        const sid = Number(r[0].Id);
        await (0, db_1.query)(`INSERT INTO ServicePrices (ServiceId, Price, Unit, ValidFrom) VALUES (@s, @p, @u, CAST(SYSUTCDATETIME() AS DATE))`, { s: sid, p: (0, db_1.money)(b.price), u: b.unit }, tx);
        return sid;
    });
    res.status(201).json({ id });
}));
exports.servicesRouter.put('/:id', (0, middleware_1.requirePerm)('services.manage'), (0, errors_1.h)(async (req, res) => {
    const id = (0, errors_1.parse)(zod_1.z.coerce.number().int().positive(), req.params.id);
    const b = (0, errors_1.parse)(serviceSchema.pick({ name: true, pricingMethod: true, defaultMinutes: true, defaultTechnicians: true, imageUrl: true, category: true, description: true, includes: true, notes: true }).extend({ isActive: zod_1.z.boolean().default(true) }), req.body);
    const r = await (0, db_1.query)(`UPDATE Services SET Name=@n, PricingMethod=@pm, DefaultMinutes=@dm, DefaultTechnicians=@dt, IsActive=@a,
              ImageUrl = CASE WHEN @hasIm = 1 THEN @im ELSE ImageUrl END, Category = CASE WHEN @hasCat = 1 THEN @cat ELSE Category END,
              Description = CASE WHEN @hasDe = 1 THEN @de ELSE Description END, Includes = CASE WHEN @hasInc = 1 THEN @inc ELSE Includes END, Notes = CASE WHEN @hasNo = 1 THEN @no ELSE Notes END OUTPUT INSERTED.Id WHERE Id=@i AND CompanyId=@c AND IsDeleted=0`, { i: id, c: req.user.companyId, n: b.name, pm: b.pricingMethod, dm: b.defaultMinutes, dt: b.defaultTechnicians, a: b.isActive, hasIm: b.imageUrl !== undefined ? 1 : 0, im: b.imageUrl ?? null, hasCat: b.category !== undefined ? 1 : 0, cat: b.category || null,
        hasDe: b.description !== undefined ? 1 : 0, de: b.description || null, hasInc: b.includes !== undefined ? 1 : 0, inc: b.includes?.length ? b.includes.join('\n') : null, hasNo: b.notes !== undefined ? 1 : 0, no: b.notes || null });
    if (!r[0])
        throw new errors_1.HttpError(404, 'NOT_FOUND', 'Service not found');
    res.json({ id });
}));
/** Adds a new price version; the previous default price is closed the day before. */
exports.servicesRouter.post('/:id/prices', (0, middleware_1.requirePerm)('services.manage'), (0, errors_1.h)(async (req, res) => {
    const id = (0, errors_1.parse)(zod_1.z.coerce.number().int().positive(), req.params.id);
    const b = (0, errors_1.parse)(zod_1.z.object({ price: zod_1.z.number().min(0).max(1_000_000), unit: zod_1.z.string().max(20).default('unit'), region: zod_1.z.string().max(100).optional(), customerType: zod_1.z.enum(['individual', 'company']).optional(), validFrom: zod_1.z.coerce.date().optional() }), req.body);
    const own = await (0, db_1.query)(`SELECT Id FROM Services WHERE Id=@i AND CompanyId=@c AND IsDeleted=0`, { i: id, c: req.user.companyId });
    if (!own[0])
        throw new errors_1.HttpError(404, 'NOT_FOUND', 'Service not found');
    await (0, db_1.query)(`INSERT INTO ServicePrices (ServiceId, Price, Unit, Region, CustomerType, ValidFrom) VALUES (@s, @p, @u, @r, @ct, CAST(@vf AS DATE))`, { s: id, p: (0, db_1.money)(b.price), u: b.unit, r: b.region ?? null, ct: b.customerType ?? null, vf: (0, db_1.dt)(b.validFrom ?? new Date()) });
    res.status(201).json({ ok: true });
}));
