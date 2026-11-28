"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PAYMENT_METHODS = exports.marketRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const config_1 = require("../config");
const db_1 = require("../db");
const errors_1 = require("../errors");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const shop_1 = require("./shop");
const areas_1 = require("../services/areas");
const documents_1 = require("../lib/documents");
const slots_1 = require("../services/slots");
const company_1 = require("./company");
const areas_2 = require("../lib/areas");
const otp_1 = require("../lib/otp");
/** Public, read-only marketplace endpoints. Only approved companies are ever visible. */
exports.marketRouter = (0, express_1.Router)();
exports.marketRouter.get('/sectors', (0, errors_1.h)(async (_req, res) => {
    const items = await (0, db_1.query)(`SELECT s.Code, s.NameAr, s.NameEn,
            (SELECT COUNT(*) FROM CompanySectors cs JOIN Companies c ON c.Id=cs.CompanyId
              WHERE cs.SectorId=s.Id AND c.Status='approved' AND c.IsDeleted=0 AND c.IsPlatform=0) AS Companies
       FROM Sectors s WHERE s.IsActive=1 ORDER BY s.SortOrder, s.Id`);
    res.json({ items });
}));
exports.marketRouter.get('/companies', (0, errors_1.h)(async (req, res) => {
    const q = (0, errors_1.parse)(zod_1.z.object({ sector: zod_1.z.string().max(40).optional(), q: zod_1.z.string().max(100).optional() }), req.query);
    const search = q.q ? q.q.replace(/[\\%_\[]/g, '') : '';
    const items = await (0, db_1.query)(`SELECT c.Slug, c.Name, c.Description, c.LogoUrl, c.CoverUrl, c.PrimaryColor, c.ReviewedAt,
            (SELECT ROUND(AVG(CAST(Stars AS FLOAT)),1) FROM Ratings r WHERE r.CompanyId=c.Id AND r.Stars IS NOT NULL) AS AvgRating, (SELECT COUNT(*) FROM Ratings r WHERE r.CompanyId=c.Id AND r.Stars IS NOT NULL) AS RatingsCount,
            (SELECT STRING_AGG(s.Code, ',') FROM CompanySectors cs JOIN Sectors s ON s.Id=cs.SectorId WHERE cs.CompanyId=c.Id) AS Sectors
       FROM Companies c
      WHERE c.Status='approved' AND c.IsDeleted=0 AND c.IsPlatform=0 AND c.Slug IS NOT NULL
        AND (@sector IS NULL OR EXISTS (SELECT 1 FROM CompanySectors cs JOIN Sectors s ON s.Id=cs.SectorId WHERE cs.CompanyId=c.Id AND s.Code=@sector))
        AND (@q = '' OR c.Name LIKE '%' + @q + '%')
      ORDER BY c.ReviewedAt DESC, c.Id DESC`, { sector: q.sector ?? null, q: search });
    res.json({ items: items.map((r) => ({ ...r, Sectors: r.Sectors ? String(r.Sectors).split(',') : [] })) });
}));
exports.marketRouter.get('/companies/:slug', (0, errors_1.h)(async (req, res) => {
    const slug = (0, errors_1.parse)(zod_1.z.string().regex(/^[a-z0-9-]{3,60}$/), req.params.slug);
    const c = (await (0, db_1.query)(`SELECT Id, Slug, Name, Description, LogoUrl, CoverUrl, WhatsApp, PrimaryColor FROM Companies WHERE Slug=@s AND Status='approved' AND IsDeleted=0 AND IsPlatform=0`, { s: slug }))[0];
    if (!c)
        throw new errors_1.HttpError(404, 'NOT_FOUND', 'Company not found');
    const services = await (0, db_1.query)(`SELECT s.Id, s.Name, s.PricingMethod, s.DefaultMinutes, s.ImageUrl, s.Category, s.Description, s.Includes, s.Notes, p.Price AS FromPrice, p.Unit
       FROM Services s
       OUTER APPLY (SELECT TOP 1 Price, Unit FROM ServicePrices sp
                     WHERE sp.ServiceId=s.Id AND sp.Region IS NULL AND sp.CustomerType IS NULL
                       AND sp.ValidFrom <= CAST(SYSUTCDATETIME() AS DATE) AND (sp.ValidTo IS NULL OR sp.ValidTo >= CAST(SYSUTCDATETIME() AS DATE))
                     ORDER BY sp.ValidFrom DESC, sp.Id DESC) p
      WHERE s.CompanyId=@c AND s.IsActive=1 AND s.IsDeleted=0 ORDER BY s.Name`, { c: c.Id });
    const sectors = await (0, db_1.query)(`SELECT s.Code, s.NameAr, s.NameEn FROM CompanySectors cs JOIN Sectors s ON s.Id=cs.SectorId WHERE cs.CompanyId=@c`, { c: c.Id });
    const categories = await (0, db_1.query)(`SELECT c.Name, c.ImageUrl, s.Name AS Sector FROM ServiceCategories c LEFT JOIN ServiceSectors s ON s.Id=c.SectorId WHERE c.CompanyId=@c ORDER BY ISNULL(s.SortOrder,9999), s.Id, c.SortOrder, c.Id`, { c: c.Id });
    const areas = await (0, company_1.loadAreas)(c.Id);
    const rate = (await (0, db_1.query)(`SELECT ROUND(AVG(CAST(Stars AS FLOAT)),1) AS AvgRating, COUNT(*) AS RatingsCount FROM Ratings WHERE CompanyId=@c AND Stars IS NOT NULL`, { c: c.Id }))[0];
    res.json({ rating: { average: rate.AvgRating, count: Number(rate.RatingsCount) }, areas, categories, slug: c.Slug, name: c.Name, description: c.Description, logoUrl: c.LogoUrl, coverUrl: c.CoverUrl, whatsapp: c.WhatsApp ? '966' + String(c.WhatsApp).slice(1) : null, primaryColor: c.PrimaryColor, sectors, services });
}));
/** Only cash works today. Card, Tabby and Tamara are shown as coming soon until a payment gateway is connected. */
exports.PAYMENT_METHODS = [{ code: 'cash', enabled: true }, { code: 'card', enabled: false }, { code: 'tabby', enabled: false }, { code: 'tamara', enabled: false }];
const requestLimiter = (0, express_rate_limit_1.default)({ windowMs: 10 * 60_000, limit: 8, standardHeaders: true, legacyHeaders: false, skip: () => config_1.config.env === 'test' });
const riyadhToday = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
/** Time slots a company offers on a day, with which ones are still free. */
exports.marketRouter.get('/companies/:slug/slots', (0, errors_1.h)(async (req, res) => {
    const slug = (0, errors_1.parse)(zod_1.z.string().regex(/^[a-z0-9-]{3,60}$/), req.params.slug);
    const date = (0, errors_1.parse)(zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/), req.query.date);
    const c = (await (0, db_1.query)(`SELECT Id FROM Companies WHERE Slug=@s AND Status='approved' AND IsDeleted=0 AND IsPlatform=0`, { s: slug }))[0];
    if (!c)
        throw new errors_1.HttpError(404, 'NOT_FOUND', 'Company not found');
    const ids = String(req.query.services ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
    res.json(await (0, slots_1.slotsWithAvailability)(c.Id, date, ids));
}));
/** A visitor attaches a photo of the place to a request. Images only, 2 MB, rate-limited; stored under the company being asked. */
exports.marketRouter.post('/companies/:slug/photo', requestLimiter, (0, errors_1.h)(async (req, res) => {
    const slug = (0, errors_1.parse)(zod_1.z.string().regex(/^[a-z0-9-]{3,60}$/), req.params.slug);
    const { dataBase64 } = (0, errors_1.parse)(zod_1.z.object({ dataBase64: zod_1.z.string().min(4) }), req.body);
    const c = (await (0, db_1.query)(`SELECT Id FROM Companies WHERE Slug=@s AND Status='approved' AND IsDeleted=0 AND IsPlatform=0`, { s: slug }))[0];
    if (!c)
        throw new errors_1.HttpError(404, 'NOT_FOUND', 'Company not found');
    const data = Buffer.from(dataBase64.replace(/^data:[^,]*,/, ''), 'base64');
    if (data.length > 2 * 1024 * 1024)
        throw new errors_1.HttpError(413, 'FILE_TOO_LARGE', 'Image must be 2 MB or smaller');
    const mime = (0, documents_1.sniffMime)(data);
    if (!mime || mime === 'application/pdf')
        throw new errors_1.HttpError(415, 'UNSUPPORTED_FILE', 'Only PNG, JPG or WEBP images are accepted');
    const r = await (0, db_1.query)(`INSERT INTO MediaFiles (CompanyId, MimeType, SizeBytes, Data) OUTPUT inserted.Id VALUES (@c,@m,@s,@d)`, { c: c.Id, m: mime, s: data.length, d: data });
    res.status(201).json({ url: `/api/media/${r[0].Id}` });
}));
/** A visitor asks a company for a service. Nothing is reserved or charged; the company calls to confirm. */
exports.marketRouter.post('/companies/:slug/requests', requestLimiter, (0, errors_1.h)(async (req, res) => {
    const slug = (0, errors_1.parse)(zod_1.z.string().regex(/^[a-z0-9-]{3,60}$/), req.params.slug);
    const b = (0, errors_1.parse)(zod_1.z.object({
        serviceId: zod_1.z.number().int().positive(),
        customerName: zod_1.z.string().trim().min(2).max(120),
        phone: zod_1.z.string().trim().refine(otp_1.isSaudiMobile, 'Saudi mobile (05XXXXXXXX)'),
        city: zod_1.z.string().trim().max(60).optional(),
        district: zod_1.z.string().trim().max(80).optional(),
        address: zod_1.z.string().trim().max(300).optional(),
        date: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        period: zod_1.z.enum(['morning', 'afternoon', 'evening']).optional(),
        time: zod_1.z.string().regex(/^\d{2}:\d{2}$/).optional(),
        notes: zod_1.z.string().trim().max(500).optional(),
        lat: zod_1.z.number().min(-90).max(90).optional(),
        lng: zod_1.z.number().min(-180).max(180).optional(),
        photoUrl: zod_1.z.string().regex(/^\/api\/media\/\d+$/).optional(),
    }), req.body);
    const today = riyadhToday();
    const max = new Date(Date.parse(today) + 90 * 86400_000).toISOString().slice(0, 10);
    if (b.date < today || b.date > max || Number.isNaN(Date.parse(b.date)))
        throw new errors_1.HttpError(400, 'BAD_DATE', 'Choose a date within the next 90 days');
    const c = (await (0, db_1.query)(`SELECT Id FROM Companies WHERE Slug=@s AND Status='approved' AND IsDeleted=0 AND IsPlatform=0`, { s: slug }))[0];
    if (!c)
        throw new errors_1.HttpError(404, 'NOT_FOUND', 'Company not found');
    const svc = await (0, db_1.query)(`SELECT 1 AS x FROM Services WHERE Id=@i AND CompanyId=@c AND IsActive=1 AND IsDeleted=0`, { i: b.serviceId, c: c.Id });
    if (!svc.length)
        throw new errors_1.HttpError(400, 'BAD_SERVICE', 'Unknown service');
    const area = await (0, areas_1.checkArea)(c.Id, b.city, b.district);
    if (!b.time && !b.period)
        throw new errors_1.HttpError(400, 'VALIDATION_ERROR', 'Choose a time');
    if (b.time)
        await (0, slots_1.assertSlot)(c.Id, b.date, b.time, [b.serviceId]);
    const r = await (0, db_1.query)(`INSERT INTO BookingRequests (CompanyId, ServiceId, CustomerName, Phone, Address, PreferredDate, PreferredPeriod, Notes, CustomerId, City, District, Latitude, Longitude, PhotoUrl, PreferredTime)
     OUTPUT inserted.Id VALUES (@c,@s,@n,@p,@a,@d,@pe,@no,@cu,@ci,@di,@la,@ln,@ph,@tm)`, { tm: b.time ?? null, la: b.lat ?? null, ln: b.lng ?? null, ph: b.photoUrl ?? null, ci: area.city, di: area.district, c: c.Id, s: b.serviceId, n: b.customerName, p: b.phone, a: b.address ?? null, d: b.date, pe: b.time ? (0, slots_1.periodOf)(b.time) : b.period, no: b.notes ?? null, cu: (0, shop_1.optionalCustomerId)(req) });
    res.status(201).json({ id: r[0].Id, status: 'new' });
}));
const complaintLimiter = (0, express_rate_limit_1.default)({ windowMs: 60 * 60_000, limit: 5, standardHeaders: true, legacyHeaders: false, skip: () => config_1.config.env === 'test' });
/** A visitor reports a problem with a company; the platform team reviews it. */
exports.marketRouter.post('/companies/:slug/complaints', complaintLimiter, (0, errors_1.h)(async (req, res) => {
    const slug = (0, errors_1.parse)(zod_1.z.string().regex(/^[a-z0-9-]{3,60}$/), req.params.slug);
    const b = (0, errors_1.parse)(zod_1.z.object({
        customerName: zod_1.z.string().trim().min(2).max(120),
        phone: zod_1.z.string().trim().refine(otp_1.isSaudiMobile, 'Saudi mobile (05XXXXXXXX)'),
        message: zod_1.z.string().trim().min(10).max(1000),
    }), req.body);
    const c = (await (0, db_1.query)(`SELECT Id FROM Companies WHERE Slug=@s AND Status IN ('approved','suspended') AND IsDeleted=0 AND IsPlatform=0`, { s: slug }))[0];
    if (!c)
        throw new errors_1.HttpError(404, 'NOT_FOUND', 'Company not found');
    const r = await (0, db_1.query)(`INSERT INTO Complaints (CompanyId, CustomerName, Phone, Message) OUTPUT inserted.Id VALUES (@c,@n,@p,@m)`, { c: c.Id, n: b.customerName, p: b.phone, m: b.message });
    res.status(201).json({ id: r[0].Id });
}));
const rateLimiter = (0, express_rate_limit_1.default)({ windowMs: 10 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false, skip: () => config_1.config.env === 'test' });
const tokenSchema = zod_1.z.string().regex(/^[a-f0-9]{32}$/);
/** The private rating page: what is being rated, and whether it was already rated. */
exports.marketRouter.get('/ratings/:token', rateLimiter, (0, errors_1.h)(async (req, res) => {
    const token = (0, errors_1.parse)(tokenSchema, req.params.token);
    const r = (await (0, db_1.query)(`SELECT r.Stars, r.Comment, r.SubmittedAt, co.Name AS Company, co.Slug, b.BookingNo,
            STUFF((SELECT ', ' + s.Name FROM BookingDetails d JOIN Services s ON s.Id=d.ServiceId WHERE d.BookingId=b.Id FOR XML PATH('')), 1, 2, '') AS Services
       FROM Ratings r JOIN Bookings b ON b.Id=r.BookingId JOIN Companies co ON co.Id=r.CompanyId WHERE r.Token=@t`, { t: token }))[0];
    if (!r)
        throw new errors_1.HttpError(404, 'NOT_FOUND', 'Rating link not found');
    res.json({ company: r.Company, slug: r.Slug, bookingNo: r.BookingNo, services: r.Services, rated: !!r.SubmittedAt, stars: r.Stars, comment: r.Comment });
}));
exports.marketRouter.post('/ratings/:token', rateLimiter, (0, errors_1.h)(async (req, res) => {
    const token = (0, errors_1.parse)(tokenSchema, req.params.token);
    const b = (0, errors_1.parse)(zod_1.z.object({ stars: zod_1.z.number().int().min(1).max(5), comment: zod_1.z.string().trim().max(500).optional() }), req.body);
    const r = await (0, db_1.query)(`UPDATE Ratings SET Stars=@s, Comment=@c, SubmittedAt=SYSUTCDATETIME() OUTPUT INSERTED.Id WHERE Token=@t AND SubmittedAt IS NULL`, { s: b.stars, c: b.comment || null, t: token });
    if (!r[0]) {
        const ex = await (0, db_1.query)(`SELECT 1 AS x FROM Ratings WHERE Token=@t`, { t: token });
        throw new errors_1.HttpError(ex[0] ? 409 : 404, ex[0] ? 'ALREADY_RATED' : 'NOT_FOUND', ex[0] ? 'This service was already rated' : 'Rating link not found');
    }
    res.status(201).json({ ok: true });
}));
/** Cities and suggested districts for the area pickers. */
exports.marketRouter.get('/areas-catalog', (_req, res) => { res.json({ cities: areas_2.CITIES, districts: areas_2.DISTRICT_SUGGESTIONS }); });
exports.marketRouter.get('/brand', (0, errors_1.h)(async (_req, res) => {
    const r = await (0, db_1.query)(`SELECT s.Value FROM SystemSettings s JOIN Companies c ON c.Id=s.CompanyId WHERE c.IsPlatform=1 AND s.[Key]='brand.logoUrl'`);
    res.json({ logoUrl: r[0]?.Value ?? null });
}));
/** What the sign-up and sign-in screens should offer. */
exports.marketRouter.get('/config', (_req, res) => {
    res.json({ phoneVerification: config_1.config.otp.required, paymentMethods: exports.PAYMENT_METHODS });
});
