"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.companyRouter = void 0;
exports.sendFile = sendFile;
exports.listDocuments = listDocuments;
exports.loadAreas = loadAreas;
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../db");
const errors_1 = require("../errors");
const middleware_1 = require("../auth/middleware");
const company_1 = require("../lib/company");
const areas_1 = require("../lib/areas");
const slots_1 = require("../services/slots");
const field_1 = require("./field");
const documents_1 = require("../lib/documents");
const extract_1 = require("../services/extract");
function sendFile(res, d) {
    res.setHeader('Content-Type', d.MimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(d.FileName)}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(d.Data);
}
exports.companyRouter = (0, express_1.Router)();
exports.companyRouter.use((0, middleware_1.requirePerm)('company.profile.manage'));
async function listDocuments(companyId, entered) {
    const rows = await (0, db_1.query)(`SELECT Id, Kind, FileName, MimeType, SizeBytes, Extracted, ExtractStatus, UploadedAt FROM CompanyDocuments WHERE CompanyId=@c AND IsCurrent=1`, { c: companyId });
    return rows.map((d) => {
        const extracted = d.Extracted ? JSON.parse(d.Extracted) : null;
        return { id: d.Id, kind: d.Kind, fileName: d.FileName, mimeType: d.MimeType, sizeBytes: d.SizeBytes, uploadedAt: d.UploadedAt, extractStatus: d.ExtractStatus, extracted, mismatch: (0, documents_1.mismatches)(extracted, entered) };
    });
}
async function loadProfile(companyId) {
    const c = (await (0, db_1.query)(`SELECT Id, Name, Slug, Phone, Status, Description, LogoUrl, CoverUrl, WhatsApp, PrimaryColor, CrNumber, VatNumber, NationalAddress, SubmittedAt, ReviewedAt, ReviewNote
       FROM Companies WHERE Id=@c AND IsDeleted=0`, { c: companyId }))[0];
    if (!c)
        throw new errors_1.HttpError(404, 'NOT_FOUND', 'Company not found');
    const sectors = await (0, db_1.query)(`SELECT s.Code FROM CompanySectors cs JOIN Sectors s ON s.Id=cs.SectorId WHERE cs.CompanyId=@c`, { c: companyId });
    const address = c.NationalAddress ? JSON.parse(c.NationalAddress) : null;
    const documents = await listDocuments(companyId, { crNumber: c.CrNumber, vatNumber: c.VatNumber, nationalAddress: address });
    const areaCount = (await (0, db_1.query)(`SELECT COUNT(DISTINCT City) AS N FROM CompanyAreas WHERE CompanyId=@c`, { c: companyId }))[0].N;
    const missingDocs = documents_1.DOC_KINDS.filter((k) => !documents.some((d) => d.kind === k));
    return {
        documents, extractionEnabled: (0, extract_1.extractionEnabled)(),
        id: c.Id, name: c.Name, slug: c.Slug, phone: c.Phone, status: c.Status, description: c.Description, logoUrl: c.LogoUrl, coverUrl: c.CoverUrl, whatsapp: c.WhatsApp,
        primaryColor: c.PrimaryColor, crNumber: c.CrNumber, vatNumber: c.VatNumber, nationalAddress: address,
        submittedAt: c.SubmittedAt, reviewedAt: c.ReviewedAt, reviewNote: c.Status === 'rejected' || c.Status === 'suspended' ? c.ReviewNote : null,
        sectorCodes: sectors.map((s) => s.Code),
        missing: [...(0, company_1.missingForReview)({ name: c.Name, crNumber: c.CrNumber, vatNumber: c.VatNumber, nationalAddress: address, sectorCount: sectors.length }), ...(areaCount ? [] : ['areas']), ...missingDocs.map((k) => `doc:${k}`)],
    };
}
exports.companyRouter.get('/', (0, errors_1.h)(async (req, res) => res.json(await loadProfile(req.user.companyId))));
const updateSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(2).max(200).optional(),
    slug: zod_1.z.string().regex(company_1.SLUG_RE).optional(),
    description: zod_1.z.string().max(1000).nullable().optional(),
    logoUrl: company_1.imageRef,
    coverUrl: company_1.imageRef,
    whatsapp: zod_1.z.string().regex(/^05\d{8}$/).nullable().optional(),
    primaryColor: zod_1.z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
    crNumber: zod_1.z.string().regex(company_1.CR_RE).optional(),
    vatNumber: zod_1.z.string().regex(company_1.VAT_RE).optional(),
    nationalAddress: company_1.nationalAddressSchema.optional(),
    sectorCodes: zod_1.z.array(zod_1.z.string().max(40)).min(1).max(3).optional(),
});
exports.companyRouter.put('/', (0, errors_1.h)(async (req, res) => {
    const b = (0, errors_1.parse)(updateSchema, req.body);
    const cid = req.user.companyId;
    const cur = await loadProfile(cid);
    if (cur.status === 'suspended' || cur.status === 'pending_review')
        throw new errors_1.HttpError(409, 'COMPANY_LOCKED', `Profile cannot be edited while ${cur.status}`);
    if (cur.status === 'approved') {
        const legalChanged = (b.crNumber !== undefined && b.crNumber !== cur.crNumber) ||
            (b.vatNumber !== undefined && b.vatNumber !== cur.vatNumber) ||
            (b.nationalAddress !== undefined && JSON.stringify(b.nationalAddress) !== JSON.stringify(cur.nationalAddress));
        if (legalChanged)
            throw new errors_1.HttpError(409, 'LEGAL_FIELDS_LOCKED', 'Legal details cannot be changed after approval; contact the platform');
    }
    if (b.crNumber) {
        const dup = await (0, db_1.query)(`SELECT TOP 1 1 AS x FROM Companies WHERE CrNumber=@v AND Id<>@c AND IsDeleted=0`, { v: b.crNumber, c: cid });
        if (dup.length)
            throw new errors_1.HttpError(409, 'CR_TAKEN', 'This commercial registration is already used');
    }
    let sectorIds = null;
    if (b.sectorCodes) {
        const rows = await (0, db_1.query)(`SELECT Id FROM Sectors WHERE IsActive=1 AND Code IN (SELECT value FROM STRING_SPLIT(@codes, ','))`, { codes: b.sectorCodes.join(',') });
        if (rows.length !== new Set(b.sectorCodes).size)
            throw new errors_1.HttpError(400, 'UNKNOWN_SECTOR', 'Unknown sector');
        sectorIds = rows.map((r) => Number(r.Id));
    }
    await (0, db_1.withTx)(async (tx) => {
        await (0, db_1.query)(`UPDATE Companies SET
           Name = COALESCE(@name, Name), Slug = COALESCE(@slug, Slug),
           Description = CASE WHEN @hasDesc = 1 THEN @desc ELSE Description END,
           LogoUrl = CASE WHEN @hasLogo = 1 THEN @logo ELSE LogoUrl END,
           WhatsApp = CASE WHEN @hasWa = 1 THEN @wa ELSE WhatsApp END,
           CoverUrl = CASE WHEN @hasCover = 1 THEN @cover ELSE CoverUrl END,
           PrimaryColor = CASE WHEN @hasColor = 1 THEN @color ELSE PrimaryColor END,
           CrNumber = COALESCE(@cr, CrNumber), VatNumber = COALESCE(@vat, VatNumber),
           NationalAddress = COALESCE(@addr, NationalAddress)
         WHERE Id=@c`, {
            c: cid, name: b.name ?? null, slug: b.slug ?? null,
            hasDesc: b.description !== undefined ? 1 : 0, desc: b.description ?? null,
            hasLogo: b.logoUrl !== undefined ? 1 : 0, logo: b.logoUrl ?? null,
            hasWa: b.whatsapp !== undefined ? 1 : 0, wa: b.whatsapp ?? null,
            hasCover: b.coverUrl !== undefined ? 1 : 0, cover: b.coverUrl ?? null,
            hasColor: b.primaryColor !== undefined ? 1 : 0, color: b.primaryColor ?? null,
            cr: b.crNumber ?? null, vat: b.vatNumber ?? null, addr: b.nationalAddress ? JSON.stringify(b.nationalAddress) : null,
        }, tx);
        if (sectorIds) {
            await (0, db_1.query)(`DELETE FROM CompanySectors WHERE CompanyId=@c`, { c: cid }, tx);
            for (const s of sectorIds)
                await (0, db_1.query)(`INSERT INTO CompanySectors (CompanyId, SectorId) VALUES (@c,@s)`, { c: cid, s }, tx);
        }
    });
    res.json(await loadProfile(cid));
}));
const uploadSchema = zod_1.z.object({ fileName: zod_1.z.string().min(1).max(200), dataBase64: zod_1.z.string().min(4) });
/** Upload (or replace) one official document. Values read from the file are returned as suggestions only. */
exports.companyRouter.put('/documents/:kind', (0, errors_1.h)(async (req, res) => {
    const kind = (0, errors_1.parse)(zod_1.z.enum(documents_1.DOC_KINDS), req.params.kind);
    const b = (0, errors_1.parse)(uploadSchema, req.body);
    const cid = req.user.companyId;
    const cur = await loadProfile(cid);
    if (cur.status !== 'draft' && cur.status !== 'rejected')
        throw new errors_1.HttpError(409, 'COMPANY_LOCKED', `Documents cannot be changed while ${cur.status}`);
    const data = Buffer.from(b.dataBase64.replace(/^data:[^,]*,/, ''), 'base64');
    if (data.length === 0)
        throw new errors_1.HttpError(400, 'EMPTY_FILE', 'File is empty');
    if (data.length > documents_1.MAX_DOC_BYTES)
        throw new errors_1.HttpError(413, 'FILE_TOO_LARGE', 'File must be 5 MB or smaller');
    const mime = (0, documents_1.sniffMime)(data);
    if (!mime)
        throw new errors_1.HttpError(415, 'UNSUPPORTED_FILE', 'Only PDF, PNG, JPG or WEBP files are accepted');
    const ex = await (0, extract_1.extractFromFile)(kind, mime, data);
    await (0, db_1.withTx)(async (tx) => {
        await (0, db_1.query)(`UPDATE CompanyDocuments SET IsCurrent=0 WHERE CompanyId=@c AND Kind=@k AND IsCurrent=1`, { c: cid, k: kind }, tx);
        await (0, db_1.query)(`INSERT INTO CompanyDocuments (CompanyId, Kind, FileName, MimeType, SizeBytes, Data, Extracted, ExtractStatus, UploadedBy)
         VALUES (@c,@k,@n,@m,@s,@d,@x,@st,@u)`, { c: cid, k: kind, n: (0, documents_1.safeFileName)(b.fileName), m: mime, s: data.length, d: data, x: Object.keys(ex.values).length ? JSON.stringify(ex.values) : null, st: ex.status, u: req.user.id }, tx);
    });
    // Fill empty legal fields from what the file says; anything the owner already typed is never overwritten.
    const v = ex.values;
    const dupCr = v.crNumber ? (await (0, db_1.query)(`SELECT TOP 1 1 AS x FROM Companies WHERE CrNumber=@v AND Id<>@c AND IsDeleted=0`, { v: v.crNumber, c: cid })).length > 0 : true;
    await (0, db_1.query)(`UPDATE Companies SET CrNumber = CASE WHEN CrNumber IS NULL AND @cr IS NOT NULL THEN @cr ELSE CrNumber END,
                            VatNumber = CASE WHEN VatNumber IS NULL AND @vat IS NOT NULL THEN @vat ELSE VatNumber END,
                            NationalAddress = CASE WHEN NationalAddress IS NULL AND @addr IS NOT NULL THEN @addr ELSE NationalAddress END
        WHERE Id=@c`, { c: cid, cr: dupCr ? null : v.crNumber ?? null, vat: v.vatNumber ?? null, addr: (0, documents_1.isCompleteAddress)(v.nationalAddress) ? JSON.stringify(v.nationalAddress) : null });
    res.json(await loadProfile(cid));
}));
exports.companyRouter.get('/documents/:kind/file', (0, errors_1.h)(async (req, res) => {
    const kind = (0, errors_1.parse)(zod_1.z.enum(documents_1.DOC_KINDS), req.params.kind);
    const d = (await (0, db_1.query)(`SELECT TOP 1 FileName, MimeType, Data FROM CompanyDocuments WHERE CompanyId=@c AND Kind=@k AND IsCurrent=1`, { c: req.user.companyId, k: kind }))[0];
    if (!d)
        throw new errors_1.HttpError(404, 'NOT_FOUND', 'Document not found');
    sendFile(res, d);
}));
exports.companyRouter.post('/submit', (0, errors_1.h)(async (req, res) => {
    const cid = req.user.companyId;
    const p = await loadProfile(cid);
    if (p.status !== 'draft' && p.status !== 'rejected')
        throw new errors_1.HttpError(409, 'BAD_STATE', `Cannot submit a company that is ${p.status}`);
    if (p.missing.length)
        throw new errors_1.HttpError(409, 'INCOMPLETE', 'Profile is incomplete', { missing: p.missing });
    await (0, db_1.query)(`UPDATE Companies SET Status='pending_review', SubmittedAt=SYSUTCDATETIME(), ReviewNote=NULL WHERE Id=@c AND Status IN ('draft','rejected')`, { c: cid });
    await (0, db_1.query)(`INSERT INTO AuditLogs (CompanyId, UserId, Action, Entity, EntityId) VALUES (@c,@u,'company.submit','Company',@e)`, { c: cid, u: req.user.id, e: String(cid) });
    (0, middleware_1.invalidateCompanyStatus)(cid);
    res.json(await loadProfile(cid));
}));
/** Service areas: cities (and optionally districts inside them) this company works in. */
async function loadAreas(companyId) {
    const rows = await (0, db_1.query)(`SELECT City, District FROM CompanyAreas WHERE CompanyId=@c ORDER BY City, District`, { c: companyId });
    const map = new Map();
    for (const r of rows) {
        if (!map.has(r.City))
            map.set(r.City, []);
        if (r.District)
            map.get(r.City).push(r.District);
    }
    return [...map.entries()].map(([city, districts]) => ({ city, districts }));
}
/** Working hours: from/to, slot length, working days, and how many jobs one slot can take. */
exports.companyRouter.get('/schedule', (0, errors_1.h)(async (req, res) => res.json(await (0, slots_1.loadSchedule)(req.user.companyId))));
exports.companyRouter.put('/schedule', (0, middleware_1.requirePerm)('company.profile.manage'), (0, errors_1.h)(async (req, res) => {
    const hhmm = zod_1.z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
    const b = (0, errors_1.parse)(zod_1.z.object({ open: hhmm, close: hhmm, slotMinutes: zod_1.z.number().int().min(30).max(480), days: zod_1.z.string().regex(/^[0-6]{1,7}$/), maxPerSlot: zod_1.z.number().int().min(1).max(100) }), req.body);
    const m = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
    if (m(b.close) - m(b.open) < b.slotMinutes)
        throw new errors_1.HttpError(400, 'BAD_SCHEDULE', 'Working hours must fit at least one slot');
    const days = [...new Set(b.days.split(''))].sort().join('');
    await (0, db_1.query)(`MERGE CompanySchedule AS t USING (SELECT @c AS CompanyId) AS s ON t.CompanyId=s.CompanyId
     WHEN MATCHED THEN UPDATE SET OpenTime=@o, CloseTime=@x, SlotMinutes=@m, Days=@d, MaxPerSlot=@p
     WHEN NOT MATCHED THEN INSERT (CompanyId, OpenTime, CloseTime, SlotMinutes, Days, MaxPerSlot) VALUES (@c,@o,@x,@m,@d,@p);`, { c: req.user.companyId, o: b.open, x: b.close, m: b.slotMinutes, d: days, p: b.maxPerSlot });
    res.json({ ...b, days });
}));
/** For each field stage, which of note / photo / video the supervisor must provide. */
exports.companyRouter.get('/field-stages', (0, middleware_1.requirePerm)('technicians.manage'), (0, errors_1.h)(async (req, res) => res.json({ items: await (0, field_1.loadStageRules)(req.user.companyId) })));
exports.companyRouter.put('/field-stages', (0, middleware_1.requirePerm)('technicians.manage'), (0, errors_1.h)(async (req, res) => {
    const { items } = (0, errors_1.parse)(zod_1.z.object({ items: zod_1.z.array(zod_1.z.object({ stage: zod_1.z.enum(field_1.STAGES), noteReq: zod_1.z.boolean(), photoReq: zod_1.z.boolean(), videoReq: zod_1.z.boolean(), label: zod_1.z.string().trim().max(60).nullable().optional(), enabled: zod_1.z.boolean().optional() })).max(20) }), req.body);
    for (const i of items) {
        await (0, db_1.query)(`MERGE FieldStageSettings AS t USING (SELECT @c AS CompanyId, @s AS Stage) AS s ON t.CompanyId=s.CompanyId AND t.Stage=s.Stage
       WHEN MATCHED THEN UPDATE SET NoteReq=@n, PhotoReq=@p, VideoReq=@v, Label=@l, Enabled=@e
       WHEN NOT MATCHED THEN INSERT (CompanyId, Stage, NoteReq, PhotoReq, VideoReq, Label, Enabled) VALUES (@c,@s,@n,@p,@v,@l,@e);`, { c: req.user.companyId, s: i.stage, n: i.noteReq ? 1 : 0, p: i.photoReq ? 1 : 0, v: i.videoReq ? 1 : 0, l: i.label || null, e: field_1.OPTIONAL_STAGES.includes(i.stage) && i.enabled === false ? 0 : 1 });
    }
    res.json({ items: await (0, field_1.loadStageRules)(req.user.companyId) });
}));
exports.companyRouter.get('/areas', (0, errors_1.h)(async (req, res) => res.json({ areas: await loadAreas(req.user.companyId) })));
exports.companyRouter.put('/areas', (0, middleware_1.requirePerm)('company.profile.manage'), (0, errors_1.h)(async (req, res) => {
    const { areas } = (0, errors_1.parse)(zod_1.z.object({ areas: zod_1.z.array(zod_1.z.object({ city: zod_1.z.string().trim().max(60), districts: zod_1.z.array(zod_1.z.string().trim().min(2).max(80)).max(200) })).max(40) }), req.body);
    for (const a of areas)
        if (!(0, areas_1.isCity)(a.city))
            throw new errors_1.HttpError(400, 'UNKNOWN_CITY', `Unknown city: ${a.city}`);
    const cur = (await (0, db_1.query)(`SELECT Status FROM Companies WHERE Id=@c`, { c: req.user.companyId }))[0];
    if (cur?.Status === 'suspended')
        throw new errors_1.HttpError(409, 'COMPANY_LOCKED', 'Company is suspended');
    await (0, db_1.withTx)(async (tx) => {
        await (0, db_1.query)(`DELETE FROM CompanyAreas WHERE CompanyId=@c`, { c: req.user.companyId }, tx);
        for (const a of areas) {
            const ds = [...new Set(a.districts)];
            if (ds.length === 0)
                await (0, db_1.query)(`INSERT INTO CompanyAreas (CompanyId, City, District) VALUES (@c,@y,NULL)`, { c: req.user.companyId, y: a.city }, tx);
            for (const d of ds)
                await (0, db_1.query)(`INSERT INTO CompanyAreas (CompanyId, City, District) VALUES (@c,@y,@d)`, { c: req.user.companyId, y: a.city, d }, tx);
        }
    });
    res.json({ areas: await loadAreas(req.user.companyId) });
}));
