"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.techniciansRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../db");
const errors_1 = require("../errors");
const middleware_1 = require("../auth/middleware");
const config_1 = require("../config");
const phone_1 = require("../lib/phone");
const documents_1 = require("../lib/documents");
exports.techniciansRouter = (0, express_1.Router)();
/** Residence IDs are personal data: only staff who manage technicians or assign them to jobs. */
const canSeeIqama = (req) => !!req.user && (req.user.perms.includes('technicians.manage') || req.user.perms.includes('bookings.assign'));
const needIqama = (req) => { if (!canSeeIqama(req))
    throw new errors_1.HttpError(403, 'FORBIDDEN', 'Insufficient permissions'); };
const TECH_STATUS = ['available', 'booked', 'on_the_way', 'working', 'break', 'absent', 'leave', 'off_duty'];
exports.techniciansRouter.get('/', (0, middleware_1.requirePerm)('technicians.view'), (0, errors_1.h)(async (req, res) => {
    const scope = (0, middleware_1.branchScope)(req.user);
    const rows = await (0, db_1.query)(`SELECT Id, Code, FullName, Mobile, BranchId, HourlyCost, Status, SupervisorId, IqamaNumber, CAST(CASE WHEN EXISTS (SELECT 1 FROM TechnicianIqama q WHERE q.TechnicianId=Technicians.Id) THEN 1 ELSE 0 END AS BIT) AS HasIqamaPhoto, (SELECT FullName FROM Supervisors sv WHERE sv.Id=Technicians.SupervisorId) AS SupervisorName FROM Technicians
        WHERE CompanyId=@c AND IsDeleted=0 AND (@b IS NULL OR BranchId=@b) ORDER BY FullName`, { c: req.user.companyId, b: scope });
    // Cost is sensitive; only returned to users who may view costs.
    const canCost = req.user.perms.includes('finance.view_cost');
    const canId = canSeeIqama(req);
    res.json({ items: rows.map((r) => ({ ...r, HourlyCost: canCost ? r.HourlyCost : undefined, IqamaNumber: canId ? r.IqamaNumber : undefined, HasIqamaPhoto: canId ? r.HasIqamaPhoto : undefined })) });
}));
/** Technicians with no overlapping assignment (travel buffer included) and no leave in the range. */
exports.techniciansRouter.get('/available', (0, middleware_1.requirePerm)('technicians.view'), (0, errors_1.h)(async (req, res) => {
    const q = (0, errors_1.parse)(zod_1.z.object({ start: zod_1.z.coerce.date(), end: zod_1.z.coerce.date() }), req.query);
    if (q.end <= q.start)
        throw new errors_1.HttpError(400, 'VALIDATION_ERROR', 'end must be after start');
    const buffer = config_1.config.travelBufferMinutes * 60 * 1000;
    const scope = (0, middleware_1.branchScope)(req.user);
    const rows = await (0, db_1.query)(`SELECT t.Id, t.Code, t.FullName, t.BranchId, t.SupervisorId, t.IqamaNumber, CAST(CASE WHEN EXISTS (SELECT 1 FROM TechnicianIqama q WHERE q.TechnicianId=t.Id) THEN 1 ELSE 0 END AS BIT) AS HasIqamaPhoto FROM Technicians t
        WHERE t.CompanyId=@c AND t.IsDeleted=0 AND t.Status NOT IN ('absent','leave','off_duty') AND (@b IS NULL OR t.BranchId=@b)
          AND NOT EXISTS (SELECT 1 FROM BookingAssignments a JOIN Bookings bk ON bk.Id=a.BookingId
                           WHERE a.TechnicianId=t.Id AND a.IsActive=1 AND bk.IsDeleted=0 AND bk.Status NOT IN ('cancelled','postponed')
                             AND a.StartAt < @eb AND a.EndAt > @sb)
          AND NOT EXISTS (SELECT 1 FROM TechnicianLeaves l WHERE l.TechnicianId=t.Id AND l.FromAt < @e AND l.ToAt > @s)
        ORDER BY t.FullName`, { c: req.user.companyId, b: scope, s: (0, db_1.dt)(q.start), e: (0, db_1.dt)(q.end), sb: (0, db_1.dt)(new Date(q.start.getTime() - buffer)), eb: (0, db_1.dt)(new Date(q.end.getTime() + buffer)) });
    const canId = canSeeIqama(req);
    res.json({ items: rows.map((r) => ({ ...r, IqamaNumber: canId ? r.IqamaNumber : undefined, HasIqamaPhoto: canId ? r.HasIqamaPhoto : undefined })) });
}));
const techSchema = zod_1.z.object({
    fullName: zod_1.z.string().min(2).max(200),
    mobile: zod_1.z.string().max(20).optional(),
    branchId: zod_1.z.number().int().positive(),
    hourlyCost: zod_1.z.number().min(0).max(10000).default(0),
});
exports.techniciansRouter.post('/', (0, middleware_1.requirePerm)('technicians.manage'), (0, errors_1.h)(async (req, res) => {
    const b = (0, errors_1.parse)(techSchema, req.body);
    const branch = await (0, db_1.query)(`SELECT Id FROM Branches WHERE Id=@b AND CompanyId=@c AND IsDeleted=0`, { b: b.branchId, c: req.user.companyId });
    if (!branch[0])
        throw new errors_1.HttpError(400, 'VALIDATION_ERROR', 'Unknown branch');
    const r = await (0, db_1.query)(`INSERT INTO Technicians (CompanyId, BranchId, Code, FullName, Mobile, HourlyCost)
       OUTPUT INSERTED.Id, INSERTED.Code
       VALUES (@c,@b,'T-' + RIGHT('000000' + CAST(NEXT VALUE FOR TechnicianCodeSeq AS VARCHAR(12)), 6),@n,@m,@hc)`, { c: req.user.companyId, b: b.branchId, n: b.fullName, m: b.mobile ? (0, phone_1.normalizeMobile)(b.mobile) : null, hc: (0, db_1.money)(b.hourlyCost) });
    res.status(201).json({ id: Number(r[0].Id), code: r[0].Code });
}));
exports.techniciansRouter.patch('/:id/status', (0, middleware_1.requirePerm)('technicians.manage'), (0, errors_1.h)(async (req, res) => {
    const id = (0, errors_1.parse)(zod_1.z.coerce.number().int().positive(), req.params.id);
    const { status } = (0, errors_1.parse)(zod_1.z.object({ status: zod_1.z.enum(TECH_STATUS) }), req.body);
    const r = await (0, db_1.query)(`UPDATE Technicians SET Status=@s OUTPUT INSERTED.Id WHERE Id=@i AND CompanyId=@c AND IsDeleted=0`, { s: status, i: id, c: req.user.companyId });
    if (!r[0])
        throw new errors_1.HttpError(404, 'NOT_FOUND', 'Technician not found');
    res.json({ id, status });
}));
exports.techniciansRouter.post('/:id/leaves', (0, middleware_1.requirePerm)('technicians.manage'), (0, errors_1.h)(async (req, res) => {
    const id = (0, errors_1.parse)(zod_1.z.coerce.number().int().positive(), req.params.id);
    const b = (0, errors_1.parse)(zod_1.z.object({ fromAt: zod_1.z.coerce.date(), toAt: zod_1.z.coerce.date(), reason: zod_1.z.string().max(300).optional() }), req.body);
    if (b.toAt <= b.fromAt)
        throw new errors_1.HttpError(400, 'VALIDATION_ERROR', 'toAt must be after fromAt');
    const own = await (0, db_1.query)(`SELECT Id FROM Technicians WHERE Id=@i AND CompanyId=@c AND IsDeleted=0`, { i: id, c: req.user.companyId });
    if (!own[0])
        throw new errors_1.HttpError(404, 'NOT_FOUND', 'Technician not found');
    await (0, db_1.query)(`INSERT INTO TechnicianLeaves (TechnicianId, FromAt, ToAt, Reason) VALUES (@t,@f,@to,@r)`, { t: id, f: (0, db_1.dt)(b.fromAt), to: (0, db_1.dt)(b.toAt), r: b.reason ?? null });
    res.status(201).json({ ok: true });
}));
const techId = zod_1.z.coerce.number().int().positive();
exports.techniciansRouter.put('/:id/iqama', (0, middleware_1.requirePerm)('technicians.manage'), (0, errors_1.h)(async (req, res) => {
    const id = (0, errors_1.parse)(techId, req.params.id);
    const { number } = (0, errors_1.parse)(zod_1.z.object({ number: zod_1.z.string().trim().regex(/^[12]\d{9}$/, 'Iqama / ID number is 10 digits starting with 1 or 2').or(zod_1.z.literal('')) }), req.body);
    const r = await (0, db_1.query)(`UPDATE Technicians SET IqamaNumber=@n WHERE Id=@i AND CompanyId=@c AND IsDeleted=0`, { n: number || null, i: id, c: req.user.companyId });
    void r;
    res.json({ id, number: number || null });
}));
exports.techniciansRouter.post('/:id/iqama-photo', (0, middleware_1.requirePerm)('technicians.manage'), (0, errors_1.h)(async (req, res) => {
    const id = (0, errors_1.parse)(techId, req.params.id);
    const { dataBase64 } = (0, errors_1.parse)(zod_1.z.object({ dataBase64: zod_1.z.string().min(4) }), req.body);
    const t = await (0, db_1.query)(`SELECT 1 AS x FROM Technicians WHERE Id=@i AND CompanyId=@c AND IsDeleted=0`, { i: id, c: req.user.companyId });
    if (!t.length)
        throw new errors_1.HttpError(404, 'NOT_FOUND', 'Technician not found');
    const data = Buffer.from(dataBase64.replace(/^data:[^,]*,/, ''), 'base64');
    if (data.length > 2 * 1024 * 1024)
        throw new errors_1.HttpError(413, 'FILE_TOO_LARGE', 'File must be 2 MB or smaller');
    const mime = (0, documents_1.sniffMime)(data);
    if (!mime)
        throw new errors_1.HttpError(415, 'UNSUPPORTED_FILE', 'Only PNG, JPG, WEBP or PDF');
    await (0, db_1.query)(`MERGE TechnicianIqama AS t USING (SELECT @i AS TechnicianId) AS s ON t.TechnicianId=s.TechnicianId
       WHEN MATCHED THEN UPDATE SET MimeType=@m, SizeBytes=@s, Data=@d, UploadedAt=SYSUTCDATETIME()
       WHEN NOT MATCHED THEN INSERT (TechnicianId, CompanyId, MimeType, SizeBytes, Data) VALUES (@i,@c,@m,@s,@d);`, { i: id, c: req.user.companyId, m: mime, s: data.length, d: data });
    res.status(201).json({ id });
}));
exports.techniciansRouter.get('/:id/iqama-photo', (0, errors_1.h)(async (req, res) => {
    needIqama(req);
    const id = (0, errors_1.parse)(techId, req.params.id);
    const f = (await (0, db_1.query)(`SELECT MimeType, Data FROM TechnicianIqama WHERE TechnicianId=@i AND CompanyId=@c`, { i: id, c: req.user.companyId }))[0];
    if (!f)
        throw new errors_1.HttpError(404, 'NOT_FOUND', 'No file');
    res.setHeader('Content-Type', f.MimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(f.Data);
}));
exports.techniciansRouter.delete('/:id/iqama-photo', (0, middleware_1.requirePerm)('technicians.manage'), (0, errors_1.h)(async (req, res) => {
    await (0, db_1.query)(`DELETE FROM TechnicianIqama WHERE TechnicianId=@i AND CompanyId=@c`, { i: (0, errors_1.parse)(techId, req.params.id), c: req.user.companyId });
    res.json({ ok: true });
}));
