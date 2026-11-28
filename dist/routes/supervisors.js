"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.supervisorsRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../db");
const errors_1 = require("../errors");
const middleware_1 = require("../auth/middleware");
const phone_1 = require("../lib/phone");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const tenancy_1 = require("../services/tenancy");
const slots_1 = require("../services/slots");
/** Supervisors and the technicians who report to them. A booking may use any supervisor, not only the technicians' usual one. */
exports.supervisorsRouter = (0, express_1.Router)();
const idParam = zod_1.z.coerce.number().int().positive();
const body = zod_1.z.object({
    fullName: zod_1.z.string().trim().min(2).max(200),
    mobile: zod_1.z.string().trim().max(20).optional(),
    branchId: zod_1.z.number().int().positive(),
    maxBookingsPerDay: zod_1.z.number().int().min(1).max(100).default(10),
});
exports.supervisorsRouter.get('/', (0, middleware_1.requirePerm)('technicians.view'), (0, errors_1.h)(async (req, res) => {
    const c = req.user.companyId;
    const scope = (0, middleware_1.branchScope)(req.user);
    const sups = await (0, db_1.query)(`SELECT Id, FullName, Mobile, BranchId, MaxBookingsPerDay, CAST(CASE WHEN UserId IS NULL THEN 0 ELSE 1 END AS BIT) AS HasLogin FROM Supervisors WHERE CompanyId=@c AND IsDeleted=0 AND (@b IS NULL OR BranchId=@b) ORDER BY FullName`, { c, b: scope });
    const techs = await (0, db_1.query)(`SELECT Id, Code, FullName, Status, SupervisorId FROM Technicians WHERE CompanyId=@c AND IsDeleted=0 AND (@b IS NULL OR BranchId=@b) ORDER BY FullName`, { c, b: scope });
    res.json({
        items: sups.map((s) => ({ ...s, technicians: techs.filter((t) => t.SupervisorId === s.Id) })),
        unassigned: techs.filter((t) => t.SupervisorId == null),
    });
}));
exports.supervisorsRouter.post('/', (0, middleware_1.requirePerm)('technicians.manage'), (0, errors_1.h)(async (req, res) => {
    const b = (0, errors_1.parse)(body, req.body);
    const br = await (0, db_1.query)(`SELECT Id FROM Branches WHERE Id=@b AND CompanyId=@c AND IsDeleted=0`, { b: b.branchId, c: req.user.companyId });
    if (!br[0])
        throw new errors_1.HttpError(400, 'VALIDATION_ERROR', 'Unknown branch');
    const r = await (0, db_1.query)(`INSERT INTO Supervisors (CompanyId, BranchId, FullName, Mobile, MaxBookingsPerDay) OUTPUT INSERTED.Id VALUES (@c,@b,@n,@m,@x)`, { c: req.user.companyId, b: b.branchId, n: b.fullName, m: b.mobile ? (0, phone_1.normalizeMobile)(b.mobile) : null, x: b.maxBookingsPerDay });
    res.status(201).json({ id: Number(r[0].Id) });
}));
/** One click: 5 supervisors with 5 technicians each, named for testing. Rename them afterwards. */
exports.supervisorsRouter.post('/test-team', (0, middleware_1.requirePerm)('technicians.manage'), (0, errors_1.h)(async (req, res) => {
    const c = req.user.companyId;
    const br = (await (0, db_1.query)(`SELECT TOP 1 Id FROM Branches WHERE CompanyId=@c AND IsDeleted=0 AND (@b IS NULL OR Id=@b) ORDER BY Id`, { c, b: (0, middleware_1.branchScope)(req.user) }))[0];
    if (!br)
        throw new errors_1.HttpError(400, 'VALIDATION_ERROR', 'Unknown branch');
    const dup = await (0, db_1.query)(`SELECT 1 AS x FROM Supervisors WHERE CompanyId=@c AND IsDeleted=0 AND FullName LIKE N'مشرف [1-5]'`, { c });
    if (dup[0])
        throw new errors_1.HttpError(409, 'ALREADY_EXISTS', 'Test supervisors already exist');
    await (0, db_1.withTx)(async (tx) => {
        for (let s = 1; s <= 5; s++) {
            const sid = (await (0, db_1.query)(`INSERT INTO Supervisors (CompanyId, BranchId, FullName, MaxBookingsPerDay) OUTPUT INSERTED.Id VALUES (@c,@b,@n,10)`, { c, b: br.Id, n: `مشرف ${s}` }, tx))[0].Id;
            for (let k = 1; k <= 5; k++) {
                await (0, db_1.query)(`INSERT INTO Technicians (CompanyId, BranchId, Code, FullName, SupervisorId) VALUES (@c,@b,'T-' + RIGHT('000000' + CAST(NEXT VALUE FOR TechnicianCodeSeq AS VARCHAR(12)), 6),@n,@s)`, { c, b: br.Id, n: `فني ${s}-${k}`, s: sid }, tx);
            }
        }
    });
    res.status(201).json({ supervisors: 5, technicians: 25 });
}));
exports.supervisorsRouter.put('/:id', (0, middleware_1.requirePerm)('technicians.manage'), (0, errors_1.h)(async (req, res) => {
    const id = (0, errors_1.parse)(idParam, req.params.id);
    const b = (0, errors_1.parse)(body.omit({ branchId: true }), req.body);
    const r = await (0, db_1.query)(`UPDATE Supervisors SET FullName=@n, Mobile=@m, MaxBookingsPerDay=@x OUTPUT INSERTED.Id WHERE Id=@i AND CompanyId=@c AND IsDeleted=0`, { n: b.fullName, m: b.mobile ? (0, phone_1.normalizeMobile)(b.mobile) : null, x: b.maxBookingsPerDay, i: id, c: req.user.companyId });
    if (!r[0])
        throw new errors_1.HttpError(404, 'NOT_FOUND', 'Supervisor not found');
    res.json({ id });
}));
/** Each team's working hours: its own or the company's. */
exports.supervisorsRouter.get('/schedules', (0, errors_1.h)(async (req, res) => res.json({ items: await (0, slots_1.loadTeams)(req.user.companyId) })));
exports.supervisorsRouter.put('/:id/schedule', (0, middleware_1.requirePerm)('technicians.manage'), (0, errors_1.h)(async (req, res) => {
    const id = (0, errors_1.parse)(idParam, req.params.id);
    const hhmm = zod_1.z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
    const b = (0, errors_1.parse)(zod_1.z.object({ open: hhmm, close: hhmm, days: zod_1.z.string().regex(/^[0-6]{1,7}$/), maxPerSlot: zod_1.z.number().int().min(1).max(50) }), req.body);
    if (b.close <= b.open)
        throw new errors_1.HttpError(400, 'BAD_SCHEDULE', 'Closing time must be after opening time');
    const own = await (0, db_1.query)(`SELECT 1 AS x FROM Supervisors WHERE Id=@i AND CompanyId=@c AND IsDeleted=0`, { i: id, c: req.user.companyId });
    if (!own.length)
        throw new errors_1.HttpError(404, 'NOT_FOUND', 'Supervisor not found');
    await (0, db_1.query)(`MERGE SupervisorSchedule AS t USING (SELECT @i AS SupervisorId) AS s ON t.SupervisorId=s.SupervisorId
     WHEN MATCHED THEN UPDATE SET OpenTime=@o, CloseTime=@x, Days=@d, MaxPerSlot=@m
     WHEN NOT MATCHED THEN INSERT (SupervisorId, CompanyId, OpenTime, CloseTime, Days, MaxPerSlot) VALUES (@i,@c,@o,@x,@d,@m);`, { i: id, c: req.user.companyId, o: b.open, x: b.close, d: [...new Set(b.days.split(''))].sort().join(''), m: b.maxPerSlot });
    res.json({ ok: true });
}));
/** Back to following the company schedule. */
exports.supervisorsRouter.delete('/:id/schedule', (0, middleware_1.requirePerm)('technicians.manage'), (0, errors_1.h)(async (req, res) => {
    await (0, db_1.query)(`DELETE FROM SupervisorSchedule WHERE SupervisorId=@i AND CompanyId=@c`, { i: (0, errors_1.parse)(idParam, req.params.id), c: req.user.companyId });
    res.json({ ok: true });
}));
/** Gives a supervisor a phone login (mobile number + password), or resets the password of the existing one. The account can only use the field app. */
exports.supervisorsRouter.post('/:id/login', (0, middleware_1.requirePerm)('users.manage'), (0, errors_1.h)(async (req, res) => {
    const id = (0, errors_1.parse)(idParam, req.params.id);
    const { password } = (0, errors_1.parse)(zod_1.z.object({ password: zod_1.z.string().min(8).max(200) }), req.body);
    const c = req.user.companyId;
    const sv = (await (0, db_1.query)(`SELECT Id, FullName, Mobile, BranchId, UserId FROM Supervisors WHERE Id=@i AND CompanyId=@c AND IsDeleted=0`, { i: id, c }))[0];
    if (!sv)
        throw new errors_1.HttpError(404, 'NOT_FOUND', 'Supervisor not found');
    if (!sv.Mobile || !/^05\d{8}$/.test(sv.Mobile))
        throw new errors_1.HttpError(400, 'MOBILE_REQUIRED', 'Add the supervisor mobile number (05XXXXXXXX) first');
    const hash = await bcryptjs_1.default.hash(password, 12);
    await (0, db_1.withTx)(async (tx) => {
        if (sv.UserId) {
            await (0, db_1.query)(`UPDATE Users SET PasswordHash=@p, IsActive=1, UpdatedAt=SYSUTCDATETIME(), UpdatedBy=@u WHERE Id=@i AND CompanyId=@c`, { p: hash, u: req.user.id, i: sv.UserId, c }, tx);
            return;
        }
        const email = `${sv.Mobile}@field.local`;
        if ((await (0, db_1.query)(`SELECT 1 AS x FROM Users WHERE Email=@e AND IsDeleted=0`, { e: email }, tx)).length)
            throw new errors_1.HttpError(409, 'DUPLICATE', 'This mobile number already has a login');
        await (0, tenancy_1.ensureRoles)(tx, c);
        const u = (await (0, db_1.query)(`INSERT INTO Users (CompanyId, BranchId, FullName, Email, PasswordHash, CreatedBy) OUTPUT INSERTED.Id VALUES (@c,@b,@n,@e,@p,@u)`, { c, b: sv.BranchId, n: sv.FullName, e: email, p: hash, u: req.user.id }, tx))[0];
        const role = (await (0, db_1.query)(`SELECT Id FROM Roles WHERE CompanyId=@c AND Name='Field Supervisor'`, { c }, tx))[0];
        await (0, db_1.query)(`INSERT INTO UserRoles (UserId, RoleId) VALUES (@u,@r)`, { u: u.Id, r: role.Id }, tx);
        await (0, db_1.query)(`UPDATE Supervisors SET UserId=@u WHERE Id=@i`, { u: u.Id, i: id }, tx);
        await (0, db_1.query)(`INSERT INTO AuditLogs (CompanyId, UserId, Action, Entity, EntityId) VALUES (@c,@u,'create','FieldLogin',@e)`, { c, u: req.user.id, e: String(id) }, tx);
    });
    res.json({ username: sv.Mobile });
}));
/** Removing a supervisor frees their technicians; past bookings keep the name for the reports. */
exports.supervisorsRouter.delete('/:id', (0, middleware_1.requirePerm)('technicians.manage'), (0, errors_1.h)(async (req, res) => {
    const id = (0, errors_1.parse)(idParam, req.params.id);
    await (0, db_1.withTx)(async (tx) => {
        const r = await (0, db_1.query)(`UPDATE Supervisors SET IsDeleted=1 OUTPUT INSERTED.Id WHERE Id=@i AND CompanyId=@c AND IsDeleted=0`, { i: id, c: req.user.companyId }, tx);
        if (!r[0])
            throw new errors_1.HttpError(404, 'NOT_FOUND', 'Supervisor not found');
        await (0, db_1.query)(`UPDATE Technicians SET SupervisorId=NULL WHERE SupervisorId=@i AND CompanyId=@c`, { i: id, c: req.user.companyId }, tx);
        await (0, db_1.query)(`UPDATE Users SET IsActive=0 WHERE Id=(SELECT UserId FROM Supervisors WHERE Id=@i) AND CompanyId=@c`, { i: id, c: req.user.companyId }, tx);
    });
    res.status(204).end();
}));
/** Move a technician under another supervisor (or none). */
exports.supervisorsRouter.put('/technician/:techId', (0, middleware_1.requirePerm)('technicians.manage'), (0, errors_1.h)(async (req, res) => {
    const techId = (0, errors_1.parse)(idParam, req.params.techId);
    const { supervisorId } = (0, errors_1.parse)(zod_1.z.object({ supervisorId: zod_1.z.number().int().positive().nullable() }), req.body);
    const c = req.user.companyId;
    if (supervisorId !== null) {
        const s = await (0, db_1.query)(`SELECT Id FROM Supervisors WHERE Id=@i AND CompanyId=@c AND IsDeleted=0`, { i: supervisorId, c });
        if (!s[0])
            throw new errors_1.HttpError(400, 'VALIDATION_ERROR', 'Unknown supervisor');
    }
    const r = await (0, db_1.query)(`UPDATE Technicians SET SupervisorId=@s OUTPUT INSERTED.Id WHERE Id=@t AND CompanyId=@c AND IsDeleted=0`, { s: supervisorId, t: techId, c });
    if (!r[0])
        throw new errors_1.HttpError(404, 'NOT_FOUND', 'Technician not found');
    res.json({ id: techId, supervisorId });
}));
