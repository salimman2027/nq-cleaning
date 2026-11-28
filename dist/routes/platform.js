"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.platformRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const config_1 = require("../config");
const db_1 = require("../db");
const errors_1 = require("../errors");
const middleware_1 = require("../auth/middleware");
const notify_1 = require("../services/notify");
const company_1 = require("./company");
const documents_1 = require("../lib/documents");
const monitor_1 = require("./monitor");
const platformSettings_1 = require("./platformSettings");
exports.platformRouter = (0, express_1.Router)();
exports.platformRouter.use(monitor_1.monitorRouter);
exports.platformRouter.use(platformSettings_1.platformSettingsRouter);
const STATUSES = ['draft', 'pending_review', 'approved', 'rejected', 'suspended'];
exports.platformRouter.get('/companies', (0, middleware_1.requirePerm)('platform.companies.view'), (0, errors_1.h)(async (req, res) => {
    const q = (0, errors_1.parse)(zod_1.z.object({ status: zod_1.z.enum(STATUSES).optional(), search: zod_1.z.string().max(100).optional() }), req.query);
    const rows = await (0, db_1.query)(`SELECT c.Id, c.Name, c.Slug, c.Phone, c.Status, c.CrNumber, c.VatNumber, c.SubmittedAt, c.ReviewedAt, c.CreatedAt
         FROM Companies c
        WHERE c.IsDeleted=0 AND c.IsPlatform=0 AND (@st IS NULL OR c.Status=@st)
          AND (@q IS NULL OR c.Name LIKE '%' + @q + '%' OR c.Phone LIKE '%' + @q + '%')
        ORDER BY CASE c.Status WHEN 'pending_review' THEN 0 ELSE 1 END, c.SubmittedAt DESC, c.Id DESC`, { st: q.status ?? null, q: q.search ? q.search.replace(/[\\%_\[]/g, '') || null : null });
    res.json({ items: rows });
}));
async function getCompany(id) {
    const c = (await (0, db_1.query)(`SELECT Id, Name, Slug, Phone, Status, Description, CrNumber, VatNumber, NationalAddress, SubmittedAt, ReviewedAt, ReviewNote, CreatedAt
       FROM Companies WHERE Id=@i AND IsDeleted=0 AND IsPlatform=0`, { i: id }))[0];
    if (!c)
        throw new errors_1.HttpError(404, 'NOT_FOUND', 'Company not found');
    return c;
}
exports.platformRouter.get('/companies/:id', (0, middleware_1.requirePerm)('platform.companies.view'), (0, errors_1.h)(async (req, res) => {
    const id = (0, errors_1.parse)(zod_1.z.coerce.number().int().positive(), req.params.id);
    const c = await getCompany(id);
    const owner = (await (0, db_1.query)(`SELECT TOP 1 u.FullName, u.Email, u.Phone FROM Users u JOIN UserRoles ur ON ur.UserId=u.Id JOIN Roles r ON r.Id=ur.RoleId WHERE u.CompanyId=@c AND r.Name='Company Owner' ORDER BY u.Id`, { c: id }))[0] ?? null;
    const sectors = await (0, db_1.query)(`SELECT s.Code, s.NameAr, s.NameEn FROM CompanySectors cs JOIN Sectors s ON s.Id=cs.SectorId WHERE cs.CompanyId=@c`, { c: id });
    const address = c.NationalAddress ? JSON.parse(c.NationalAddress) : null;
    const documents = await (0, company_1.listDocuments)(id, { crNumber: c.CrNumber, vatNumber: c.VatNumber, nationalAddress: address });
    res.json({ ...c, NationalAddress: address, owner, sectors, documents });
}));
exports.platformRouter.get('/companies/:id/documents/:kind/file', (0, middleware_1.requirePerm)('platform.companies.view'), (0, errors_1.h)(async (req, res) => {
    const id = (0, errors_1.parse)(zod_1.z.coerce.number().int().positive(), req.params.id);
    const kind = (0, errors_1.parse)(zod_1.z.enum(documents_1.DOC_KINDS), req.params.kind);
    await getCompany(id);
    const d = (await (0, db_1.query)(`SELECT TOP 1 FileName, MimeType, Data FROM CompanyDocuments WHERE CompanyId=@c AND Kind=@k AND IsCurrent=1`, { c: id, k: kind }))[0];
    if (!d)
        throw new errors_1.HttpError(404, 'NOT_FOUND', 'Document not found');
    await (0, db_1.query)(`INSERT INTO AuditLogs (CompanyId, UserId, Action, Entity, EntityId) VALUES (@c,@u,'company.document.view','Company',@e)`, { c: req.user.companyId, u: req.user.id, e: `${id}:${kind}` });
    (0, company_1.sendFile)(res, d);
}));
async function transition(req, to, from, reason, action) {
    const id = (0, errors_1.parse)(zod_1.z.coerce.number().int().positive(), req.params.id);
    const c = await getCompany(id);
    if (!from.includes(c.Status))
        throw new errors_1.HttpError(409, 'BAD_STATE', `Cannot change a company that is ${c.Status}`);
    await (0, db_1.query)(`UPDATE Companies SET Status=@s, ReviewedAt=SYSUTCDATETIME(), ReviewedBy=@u, ReviewNote=@n WHERE Id=@i AND Status=@old`, { s: to, u: req.user.id, n: reason, i: id, old: c.Status });
    await (0, db_1.query)(`INSERT INTO AuditLogs (CompanyId, UserId, Action, Entity, EntityId, Details) VALUES (@c,@u,@a,'Company',@e,@d)`, {
        c: req.user.companyId, u: req.user.id, a: action, e: String(id), d: reason,
    });
    (0, middleware_1.invalidateCompanyStatus)(id);
    return c;
}
/** Notification failures must not undo a review decision; they are logged and reported to the caller. */
async function tell(phone, template, params, companyId) {
    if (!phone)
        return false;
    try {
        await (0, notify_1.send)(phone, template, params, companyId);
        return true;
    }
    catch {
        return false;
    }
}
exports.platformRouter.post('/companies/:id/approve', (0, middleware_1.requirePerm)('platform.companies.review'), (0, errors_1.h)(async (req, res) => {
    const c = await transition(req, 'approved', ['pending_review'], null, 'company.approve');
    const link = `${config_1.config.appUrl}/login`;
    const notified = await tell(c.Phone, 'company_approved', [c.Name, link], c.Id);
    res.json({ status: 'approved', notified, dashboardUrl: link });
}));
exports.platformRouter.post('/companies/:id/reject', (0, middleware_1.requirePerm)('platform.companies.review'), (0, errors_1.h)(async (req, res) => {
    const { reason } = (0, errors_1.parse)(zod_1.z.object({ reason: zod_1.z.string().trim().min(5).max(500) }), req.body);
    const c = await transition(req, 'rejected', ['pending_review'], reason, 'company.reject');
    const notified = await tell(c.Phone, 'company_rejected', [c.Name, reason], c.Id);
    res.json({ status: 'rejected', notified });
}));
exports.platformRouter.post('/companies/:id/suspend', (0, middleware_1.requirePerm)('platform.companies.review'), (0, errors_1.h)(async (req, res) => {
    const { reason } = (0, errors_1.parse)(zod_1.z.object({ reason: zod_1.z.string().trim().min(5).max(500) }), req.body);
    await transition(req, 'suspended', ['approved'], reason, 'company.suspend');
    res.json({ status: 'suspended' });
}));
exports.platformRouter.post('/companies/:id/reactivate', (0, middleware_1.requirePerm)('platform.companies.review'), (0, errors_1.h)(async (req, res) => {
    await transition(req, 'approved', ['suspended'], null, 'company.reactivate');
    res.json({ status: 'approved' });
}));
const sectorSchema = zod_1.z.object({
    code: zod_1.z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
    nameAr: zod_1.z.string().trim().min(2).max(100),
    nameEn: zod_1.z.string().trim().min(2).max(100),
    sortOrder: zod_1.z.number().int().min(0).max(1000).default(0),
    isActive: zod_1.z.boolean().default(true),
});
exports.platformRouter.get('/sectors', (0, middleware_1.requirePerm)('platform.companies.view'), (0, errors_1.h)(async (_req, res) => {
    res.json({ items: await (0, db_1.query)(`SELECT Id, Code, NameAr, NameEn, SortOrder, IsActive FROM Sectors ORDER BY SortOrder, Id`) });
}));
exports.platformRouter.post('/sectors', (0, middleware_1.requirePerm)('platform.sectors.manage'), (0, errors_1.h)(async (req, res) => {
    const b = (0, errors_1.parse)(sectorSchema, req.body);
    const r = await (0, db_1.query)(`INSERT INTO Sectors (Code, NameAr, NameEn, SortOrder, IsActive) OUTPUT INSERTED.Id VALUES (@c,@a,@e,@s,@i)`, {
        c: b.code, a: b.nameAr, e: b.nameEn, s: b.sortOrder, i: b.isActive ? 1 : 0,
    });
    res.status(201).json({ id: Number(r[0].Id) });
}));
exports.platformRouter.put('/sectors/:id', (0, middleware_1.requirePerm)('platform.sectors.manage'), (0, errors_1.h)(async (req, res) => {
    const id = (0, errors_1.parse)(zod_1.z.coerce.number().int().positive(), req.params.id);
    const b = (0, errors_1.parse)(sectorSchema.omit({ code: true }), req.body);
    const r = await (0, db_1.query)(`UPDATE Sectors SET NameAr=@a, NameEn=@e, SortOrder=@s, IsActive=@i OUTPUT INSERTED.Id WHERE Id=@id`, {
        a: b.nameAr, e: b.nameEn, s: b.sortOrder, i: b.isActive ? 1 : 0, id,
    });
    if (!r.length)
        throw new errors_1.HttpError(404, 'NOT_FOUND', 'Sector not found');
    res.json({ id });
}));
/** Platform branding (logo shown on the public site). Stored as a setting of the platform company. */
exports.platformRouter.get('/brand', (0, middleware_1.requirePerm)('platform.companies.view'), (0, errors_1.h)(async (_req, res) => {
    const r = await (0, db_1.query)(`SELECT s.Value FROM SystemSettings s JOIN Companies c ON c.Id=s.CompanyId WHERE c.IsPlatform=1 AND s.[Key]='brand.logoUrl'`);
    res.json({ logoUrl: r[0]?.Value ?? null });
}));
exports.platformRouter.put('/brand', (0, middleware_1.requirePerm)('platform.brand.manage'), (0, errors_1.h)(async (req, res) => {
    const b = (0, errors_1.parse)(zod_1.z.object({ logoUrl: zod_1.z.string().url().max(500).refine((u) => u.startsWith('https://'), 'https only').nullable() }), req.body);
    const co = (await (0, db_1.query)(`SELECT TOP 1 Id FROM Companies WHERE IsPlatform=1`))[0];
    if (!co)
        throw new errors_1.HttpError(404, 'NOT_FOUND', 'Platform company not found');
    if (b.logoUrl) {
        await (0, db_1.query)(`MERGE SystemSettings AS t USING (SELECT @c AS CompanyId, 'brand.logoUrl' AS [Key]) AS s ON t.CompanyId=s.CompanyId AND t.[Key]=s.[Key]
       WHEN MATCHED THEN UPDATE SET Value=@v WHEN NOT MATCHED THEN INSERT (CompanyId,[Key],Value) VALUES (@c,'brand.logoUrl',@v);`, { c: co.Id, v: b.logoUrl });
    }
    else {
        await (0, db_1.query)(`DELETE FROM SystemSettings WHERE CompanyId=@c AND [Key]='brand.logoUrl'`, { c: co.Id });
    }
    res.json({ logoUrl: b.logoUrl });
}));
