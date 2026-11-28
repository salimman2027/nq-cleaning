"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bookingsRouter = void 0;
const express_1 = require("express");
const mssql_1 = __importDefault(require("mssql"));
const zod_1 = require("zod");
const db_1 = require("../db");
const errors_1 = require("../errors");
const middleware_1 = require("../auth/middleware");
const requestSync_1 = require("../services/requestSync");
const ratings_1 = require("../services/ratings");
const config_1 = require("../config");
const documents_1 = require("../lib/documents");
const field_1 = require("./field");
const pricing_1 = require("../lib/pricing");
const transitions_1 = require("../lib/transitions");
const scheduling_1 = require("../services/scheduling");
exports.bookingsRouter = (0, express_1.Router)();
const idParam = zod_1.z.coerce.number().int().positive();
const SOURCES = ['phone', 'whatsapp', 'website', 'customer_app', 'branch_visit', 'returning_customer', 'campaign'];
const createSchema = zod_1.z
    .object({
    customerId: zod_1.z.number().int().positive(),
    addressId: zod_1.z.number().int().positive(),
    branchId: zod_1.z.number().int().positive().optional(),
    startAt: zod_1.z.coerce.date(),
    endAt: zod_1.z.coerce.date().optional(),
    durationMinutes: zod_1.z.number().int().min(15).max(24 * 60).optional(),
    lines: zod_1.z.array(zod_1.z.object({ serviceId: zod_1.z.number().int().positive(), quantity: zod_1.z.number().positive().max(10000), unitPrice: zod_1.z.number().min(0).max(1_000_000).optional() })).min(1).max(20),
    technicianIds: zod_1.z.array(zod_1.z.number().int().positive()).max(30).default([]),
    discount: zod_1.z.number().min(0).default(0),
    source: zod_1.z.enum(SOURCES).optional(),
    priority: zod_1.z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
    notes: zod_1.z.string().max(2000).optional(),
    photoUrl: zod_1.z.string().regex(/^\/api\/media\/\d+$/).optional(),
    confirmed: zod_1.z.boolean().default(false),
    idempotencyKey: zod_1.z.string().min(8).max(64).optional(),
})
    .refine((b) => !b.endAt || b.endAt > b.startAt, { message: 'endAt must be after startAt', path: ['endAt'] });
async function lockBooking(tx, user, id) {
    const rows = await (0, db_1.query)(`SELECT Id, CompanyId, BranchId, BookingNo, Status, StartAt, EndAt FROM Bookings WITH (UPDLOCK, ROWLOCK)
      WHERE Id = @i AND CompanyId = @c AND IsDeleted = 0`, { i: id, c: user.companyId }, tx);
    const scope = (0, middleware_1.branchScope)(user);
    if (!rows[0] || (scope !== null && rows[0].BranchId !== scope))
        throw new errors_1.HttpError(404, 'NOT_FOUND', 'Booking not found');
    return rows[0];
}
async function addHistory(tx, bookingId, from, to, reason, userId) {
    await (0, db_1.query)(`INSERT INTO BookingStatusHistory (BookingId, FromStatus, ToStatus, Reason, ChangedBy) VALUES (@b, @f, @t, @r, @u)`, { b: bookingId, f: from, t: to, r: reason, u: userId }, tx);
}
exports.bookingsRouter.get('/', (0, middleware_1.requirePerm)('bookings.view'), (0, errors_1.h)(async (req, res) => {
    await (0, requestSync_1.backfillConfirmed)(req.user.companyId, req.user.id);
    const q = (0, errors_1.parse)(zod_1.z.object({
        from: zod_1.z.coerce.date().optional(), to: zod_1.z.coerce.date().optional(),
        status: zod_1.z.enum(transitions_1.STATUSES).optional(), customerId: zod_1.z.coerce.number().int().optional(), branchId: zod_1.z.coerce.number().int().optional(),
        page: zod_1.z.coerce.number().int().min(1).default(1), pageSize: zod_1.z.coerce.number().int().min(1).max(100).default(25),
    }), req.query);
    const scope = (0, middleware_1.branchScope)(req.user);
    const p = {
        c: req.user.companyId, f: q.from ? (0, db_1.dt)(q.from) : (0, db_1.dt)(null), t: q.to ? (0, db_1.dt)(q.to) : (0, db_1.dt)(null), s: q.status ?? null, cu: q.customerId ?? null,
        b: scope ?? q.branchId ?? null, off: (q.page - 1) * q.pageSize, ps: q.pageSize,
    };
    const where = `b.CompanyId=@c AND b.IsDeleted=0 AND (@f IS NULL OR b.StartAt >= @f) AND (@t IS NULL OR b.StartAt < @t)
                   AND (@s IS NULL OR b.Status=@s) AND (@cu IS NULL OR b.CustomerId=@cu) AND (@b IS NULL OR b.BranchId=@b)`;
    const items = await (0, db_1.query)(`SELECT b.Id, b.BookingNo, b.Status, b.StartAt, b.EndAt, b.Total, b.Paid, b.BranchId, b.SupervisorId, (SELECT FullName FROM Supervisors sv WHERE sv.Id=b.SupervisorId) AS SupervisorName, c.Name AS CustomerName, c.Mobile AS CustomerMobile,
              (SELECT COUNT(*) FROM BookingAssignments a WHERE a.BookingId=b.Id AND a.IsActive=1) AS TechnicianCount
         FROM Bookings b JOIN Customers c ON c.Id=b.CustomerId WHERE ${where}
        ORDER BY b.StartAt DESC, b.Id DESC OFFSET @off ROWS FETCH NEXT @ps ROWS ONLY`, p);
    const total = await (0, db_1.query)(`SELECT COUNT(*) AS n FROM Bookings b WHERE ${where}`, p);
    res.json({ items, total: total[0].n, page: q.page, pageSize: q.pageSize });
}));
exports.bookingsRouter.get('/:id', (0, middleware_1.requirePerm)('bookings.view'), (0, errors_1.h)(async (req, res) => {
    const id = (0, errors_1.parse)(idParam, req.params.id);
    const u = req.user;
    const rows = await (0, db_1.query)(`SELECT b.*, c.Name AS CustomerName, c.Mobile AS CustomerMobile, a.City, a.District, a.Street, a.MapUrl
         FROM Bookings b JOIN Customers c ON c.Id=b.CustomerId JOIN CustomerAddresses a ON a.Id=b.AddressId
        WHERE b.Id=@i AND b.CompanyId=@c AND b.IsDeleted=0`, { i: id, c: u.companyId });
    const scope = (0, middleware_1.branchScope)(u);
    if (!rows[0] || (scope !== null && rows[0].BranchId !== scope))
        throw new errors_1.HttpError(404, 'NOT_FOUND', 'Booking not found');
    const [stageEvents, teamFiles, lines, assignments, history] = await Promise.all([
        (0, db_1.query)(`SELECT e.Id, e.Stage, e.Note, e.Amount, e.Method, e.Latitude, e.Longitude, e.CreatedAt, u.FullName AS ByName, (SELECT f.Id, f.Kind, f.FileName FROM BookingStageFiles f WHERE f.EventId=e.Id FOR JSON PATH) AS FilesJson FROM BookingStageEvents e LEFT JOIN Users u ON u.Id=e.CreatedBy WHERE e.BookingId=@i ORDER BY e.Id`, { i: id }),
        (0, db_1.query)(`SELECT Id, FileName, MimeType, SizeBytes, UploadedAt FROM BookingTeamFiles WHERE BookingId=@i ORDER BY Id`, { i: id }),
        (0, db_1.query)(`SELECT d.Id, d.ServiceId, s.Name AS ServiceName, d.Quantity, d.UnitPrice, d.LineTotal FROM BookingDetails d JOIN Services s ON s.Id=d.ServiceId WHERE d.BookingId=@i`, { i: id }),
        (0, db_1.query)(`SELECT a.Id, a.TechnicianId, t.FullName, a.StartAt, a.EndAt, a.IsActive FROM BookingAssignments a JOIN Technicians t ON t.Id=a.TechnicianId WHERE a.BookingId=@i ORDER BY a.Id`, { i: id }),
        (0, db_1.query)(`SELECT h.FromStatus, h.ToStatus, h.Reason, h.ChangedBy, u.FullName AS ChangedByName, h.ChangedAt FROM BookingStatusHistory h LEFT JOIN Users u ON u.Id=h.ChangedBy WHERE h.BookingId=@i ORDER BY h.Id`, { i: id }),
    ]);
    res.json({ ...rows[0], lines, assignments, history, teamFiles, stageLabels: await (0, field_1.stageLabels)(req.user.companyId), stageEvents: stageEvents.map((e) => ({ ...e, FilesJson: undefined, Files: e.FilesJson ? JSON.parse(e.FilesJson) : [] })) });
}));
exports.bookingsRouter.post('/', (0, middleware_1.requirePerm)('bookings.create'), (0, errors_1.h)(async (req, res) => {
    const b = (0, errors_1.parse)(createSchema, req.body);
    const u = req.user;
    try {
        const out = await (0, db_1.withTx)(async (tx) => {
            if (b.idempotencyKey) {
                const ex = await (0, db_1.query)(`SELECT Id, BookingNo FROM Bookings WHERE CompanyId=@c AND IdempotencyKey=@k`, { c: u.companyId, k: b.idempotencyKey }, tx);
                if (ex[0])
                    return { id: Number(ex[0].Id), bookingNo: ex[0].BookingNo, replay: true };
            }
            const cust = await (0, db_1.query)(`SELECT Type FROM Customers WHERE Id=@i AND CompanyId=@c AND IsDeleted=0`, { i: b.customerId, c: u.companyId }, tx);
            if (!cust[0])
                throw new errors_1.HttpError(400, 'VALIDATION_ERROR', 'Unknown customer');
            const addr = await (0, db_1.query)(`SELECT Id FROM CustomerAddresses WHERE Id=@a AND CustomerId=@cu AND IsDeleted=0`, { a: b.addressId, cu: b.customerId }, tx);
            if (!addr[0])
                throw new errors_1.HttpError(400, 'VALIDATION_ERROR', 'Address does not belong to this customer');
            const scope = (0, middleware_1.branchScope)(u);
            const branchId = scope ?? b.branchId ?? u.branchId;
            if (!branchId)
                throw new errors_1.HttpError(400, 'VALIDATION_ERROR', 'branchId is required');
            const br = await (0, db_1.query)(`SELECT Id FROM Branches WHERE Id=@b AND CompanyId=@c AND IsDeleted=0`, { b: branchId, c: u.companyId }, tx);
            if (!br[0])
                throw new errors_1.HttpError(400, 'VALIDATION_ERROR', 'Unknown branch');
            const company = await (0, db_1.query)(`SELECT VatRate FROM Companies WHERE Id=@c`, { c: u.companyId }, tx);
            let minutes = 0;
            const priced = [];
            for (const l of b.lines) {
                const s = await (0, db_1.query)(`SELECT s.DefaultMinutes,
                    (SELECT TOP 1 sp.Price FROM ServicePrices sp
                      WHERE sp.ServiceId = s.Id AND sp.Region IS NULL AND (sp.CustomerType IS NULL OR sp.CustomerType = @ct)
                        AND sp.ValidFrom <= CAST(SYSUTCDATETIME() AS DATE) AND (sp.ValidTo IS NULL OR sp.ValidTo >= CAST(SYSUTCDATETIME() AS DATE))
                      ORDER BY CASE WHEN sp.CustomerType IS NULL THEN 1 ELSE 0 END, sp.ValidFrom DESC, sp.Id DESC) AS Price
               FROM Services s WHERE s.Id=@s AND s.CompanyId=@c AND s.IsActive=1 AND s.IsDeleted=0`, { s: l.serviceId, c: u.companyId, ct: cust[0].Type }, tx);
                if (!s[0])
                    throw new errors_1.HttpError(400, 'VALIDATION_ERROR', `Unknown or inactive service ${l.serviceId}`);
                if (s[0].Price === null && l.unitPrice === undefined)
                    throw new errors_1.HttpError(400, 'VALIDATION_ERROR', `Service ${l.serviceId} has no active price`);
                const catalog = s[0].Price === null ? null : Number(s[0].Price);
                const unit = l.unitPrice ?? catalog;
                if (l.unitPrice !== undefined && catalog !== l.unitPrice && !u.perms.includes('bookings.edit_price')) {
                    throw new errors_1.HttpError(403, 'FORBIDDEN', 'Changing prices requires bookings.edit_price');
                }
                minutes += s[0].DefaultMinutes;
                priced.push({ serviceId: l.serviceId, quantity: l.quantity, unitPrice: unit });
            }
            if (b.discount > 0 && !u.perms.includes('bookings.discount'))
                throw new errors_1.HttpError(403, 'FORBIDDEN', 'Discounts require bookings.discount');
            let totals;
            try {
                totals = (0, pricing_1.calcTotals)(priced, b.discount, Number(company[0].VatRate));
            }
            catch {
                throw new errors_1.HttpError(400, 'VALIDATION_ERROR', 'Discount cannot exceed the subtotal');
            }
            const endAt = b.endAt ?? new Date(b.startAt.getTime() + (b.durationMinutes ?? minutes) * 60000);
            await (0, scheduling_1.assertTechniciansFree)(tx, u.companyId, b.technicianIds, b.startAt, endAt);
            const status = b.technicianIds.length ? 'assigned' : b.confirmed ? 'confirmed' : 'new';
            const ins = await (0, db_1.query)(`INSERT INTO Bookings (CompanyId, BranchId, BookingNo, CustomerId, AddressId, StartAt, EndAt, Status, Subtotal, Discount, Vat, Total, IdempotencyKey, Source, Priority, Notes, CreatedBy, PhotoUrl)
           OUTPUT INSERTED.Id, INSERTED.BookingNo
           VALUES (@c, @br, 'BK-' + RIGHT('000000' + CAST(NEXT VALUE FOR BookingNoSeq AS VARCHAR(12)), 6), @cu, @ad, @s, @e, @st, @sub, @di, @vat, @tot, @k, @src, @pr, @n, @u, @ph)`, { c: u.companyId, br: branchId, cu: b.customerId, ad: b.addressId, s: (0, db_1.dt)(b.startAt), e: (0, db_1.dt)(endAt), st: status, sub: (0, db_1.money)(totals.subtotal), di: (0, db_1.money)(totals.discount), vat: (0, db_1.money)(totals.vat), tot: (0, db_1.money)(totals.total), k: b.idempotencyKey ?? null, ph: b.photoUrl ?? null, src: b.source ?? null, pr: b.priority, n: b.notes ?? null, u: u.id }, tx);
            const id = Number(ins[0].Id);
            for (const l of priced) {
                await (0, db_1.query)(`INSERT INTO BookingDetails (BookingId, ServiceId, Quantity, UnitPrice, LineTotal) VALUES (@b,@s,@q,@p,@t)`, { b: id, s: l.serviceId, q: [mssql_1.default.Decimal(10, 2), l.quantity], p: (0, db_1.money)(l.unitPrice), t: (0, db_1.money)((0, pricing_1.lineTotal)(l)) }, tx);
            }
            for (const t of b.technicianIds) {
                await (0, db_1.query)(`INSERT INTO BookingAssignments (BookingId, TechnicianId, StartAt, EndAt) VALUES (@b,@t,@s,@e)`, { b: id, t, s: (0, db_1.dt)(b.startAt), e: (0, db_1.dt)(endAt) }, tx);
            }
            await addHistory(tx, id, null, status, null, u.id);
            await (0, db_1.query)(`INSERT INTO AuditLogs (CompanyId, UserId, Action, Entity, EntityId) VALUES (@c,@u,'create','Booking',@e)`, { c: u.companyId, u: u.id, e: String(id) }, tx);
            return { id, bookingNo: ins[0].BookingNo, replay: false, status, ...totals };
        });
        res.status(out.replay ? 200 : 201).json(out);
    }
    catch (e) {
        // A concurrent request with the same idempotency key won the race: return its booking.
        const num = e.number;
        if (b.idempotencyKey && (num === 2601 || num === 2627)) {
            const ex = await (0, db_1.query)(`SELECT Id, BookingNo FROM Bookings WHERE CompanyId=@c AND IdempotencyKey=@k`, { c: u.companyId, k: b.idempotencyKey });
            if (ex[0]) {
                res.status(200).json({ id: Number(ex[0].Id), bookingNo: ex[0].BookingNo, replay: true });
                return;
            }
        }
        throw e;
    }
}));
async function setSupervisor(tx, companyId, bookingId, supervisorId) {
    if (supervisorId !== null) {
        const s = await (0, db_1.query)(`SELECT Id FROM Supervisors WHERE Id=@i AND CompanyId=@c AND IsDeleted=0`, { i: supervisorId, c: companyId }, tx);
        if (!s[0])
            throw new errors_1.HttpError(400, 'VALIDATION_ERROR', 'Unknown supervisor');
    }
    await (0, db_1.query)(`UPDATE Bookings SET SupervisorId=@s WHERE Id=@b AND CompanyId=@c`, { s: supervisorId, b: bookingId, c: companyId }, tx);
}
/** Change the supervisor in charge of a booking at any time before it is closed or cancelled. */
exports.bookingsRouter.post('/:id/supervisor', (0, middleware_1.requirePerm)('bookings.assign'), (0, errors_1.h)(async (req, res) => {
    const id = (0, errors_1.parse)(idParam, req.params.id);
    const { supervisorId } = (0, errors_1.parse)(zod_1.z.object({ supervisorId: zod_1.z.number().int().positive().nullable() }), req.body);
    const u = req.user;
    await (0, db_1.withTx)(async (tx) => {
        const bk = await lockBooking(tx, u, id);
        if (bk.Status === 'closed' || bk.Status === 'cancelled')
            throw new errors_1.HttpError(409, 'INVALID_STATE', `Cannot change the supervisor while booking is ${bk.Status}`);
        await setSupervisor(tx, u.companyId, id, supervisorId);
        await (0, db_1.query)(`INSERT INTO AuditLogs (CompanyId, UserId, Action, Entity, EntityId, Details) VALUES (@c,@u,'booking.supervisor','Booking',@e,@d)`, { c: u.companyId, u: u.id, e: String(id), d: supervisorId === null ? 'none' : String(supervisorId) }, tx);
    });
    res.json({ id, supervisorId });
}));
/** Names of the crew (free text) for the job. */
exports.bookingsRouter.put('/:id/team-notes', (0, middleware_1.requirePerm)('bookings.assign'), (0, errors_1.h)(async (req, res) => {
    const id = (0, errors_1.parse)(idParam, req.params.id);
    const { notes } = (0, errors_1.parse)(zod_1.z.object({ notes: zod_1.z.string().trim().max(1000) }), req.body);
    const r = await (0, db_1.query)(`UPDATE Bookings SET TeamNotes=@n, UpdatedAt=SYSUTCDATETIME() OUTPUT inserted.Id WHERE Id=@i AND CompanyId=@c AND IsDeleted=0`, { n: notes || null, i: id, c: req.user.companyId });
    if (!r.length)
        throw new errors_1.HttpError(404, 'NOT_FOUND', 'Booking not found');
    res.json({ id });
}));
/** Private copies of the crew's residence IDs. Never public: only signed-in staff of this company with the assign permission. */
exports.bookingsRouter.post('/:id/team-files', (0, middleware_1.requirePerm)('bookings.assign'), (0, errors_1.h)(async (req, res) => {
    const id = (0, errors_1.parse)(idParam, req.params.id);
    const b = (0, errors_1.parse)(zod_1.z.object({ fileName: zod_1.z.string().trim().min(1).max(200), dataBase64: zod_1.z.string().min(4) }), req.body);
    const bk = await (0, db_1.query)(`SELECT 1 AS x FROM Bookings WHERE Id=@i AND CompanyId=@c AND IsDeleted=0`, { i: id, c: req.user.companyId });
    if (!bk.length)
        throw new errors_1.HttpError(404, 'NOT_FOUND', 'Booking not found');
    const n = await (0, db_1.query)(`SELECT COUNT(*) AS N FROM BookingTeamFiles WHERE BookingId=@i`, { i: id });
    if (Number(n[0].N) >= 12)
        throw new errors_1.HttpError(409, 'TOO_MANY_FILES', 'At most 12 files per booking');
    const data = Buffer.from(b.dataBase64.replace(/^data:[^,]*,/, ''), 'base64');
    if (data.length > 2 * 1024 * 1024)
        throw new errors_1.HttpError(413, 'FILE_TOO_LARGE', 'File must be 2 MB or smaller');
    const mime = (0, documents_1.sniffMime)(data);
    if (!mime)
        throw new errors_1.HttpError(415, 'UNSUPPORTED_FILE', 'Only PNG, JPG, WEBP or PDF');
    const r = await (0, db_1.query)(`INSERT INTO BookingTeamFiles (CompanyId, BookingId, FileName, MimeType, SizeBytes, Data, UploadedBy) OUTPUT inserted.Id VALUES (@c,@b,@f,@m,@s,@d,@u)`, { c: req.user.companyId, b: id, f: b.fileName, m: mime, s: data.length, d: data, u: req.user.id });
    res.status(201).json({ id: r[0].Id });
}));
exports.bookingsRouter.get('/:id/team-files/:fid', (0, middleware_1.requirePerm)('bookings.assign'), (0, errors_1.h)(async (req, res) => {
    const id = (0, errors_1.parse)(idParam, req.params.id);
    const fid = (0, errors_1.parse)(idParam, req.params.fid);
    const f = (await (0, db_1.query)(`SELECT FileName, MimeType, Data FROM BookingTeamFiles WHERE Id=@f AND BookingId=@b AND CompanyId=@c`, { f: fid, b: id, c: req.user.companyId }))[0];
    if (!f)
        throw new errors_1.HttpError(404, 'NOT_FOUND', 'File not found');
    res.setHeader('Content-Type', f.MimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(f.Data);
}));
exports.bookingsRouter.delete('/:id/team-files/:fid', (0, middleware_1.requirePerm)('bookings.assign'), (0, errors_1.h)(async (req, res) => {
    const id = (0, errors_1.parse)(idParam, req.params.id);
    const fid = (0, errors_1.parse)(idParam, req.params.fid);
    await (0, db_1.query)(`DELETE FROM BookingTeamFiles WHERE Id=@f AND BookingId=@b AND CompanyId=@c`, { f: fid, b: id, c: req.user.companyId });
    res.json({ ok: true });
}));
/** Photos and videos the supervisor recorded on site. Staff of this company with booking access only. */
exports.bookingsRouter.get('/:id/stage-files/:fid', (0, middleware_1.requirePerm)('bookings.view'), (0, errors_1.h)(async (req, res) => {
    await (0, field_1.stageFileForOffice)(req, res, (0, errors_1.parse)(idParam, req.params.fid));
}));
const ASSIGNABLE = ['new', 'confirmed', 'awaiting_assignment', 'assigned', 'redo'];
exports.bookingsRouter.post('/:id/assign', (0, middleware_1.requirePerm)('bookings.assign'), (0, errors_1.h)(async (req, res) => {
    const id = (0, errors_1.parse)(idParam, req.params.id);
    const { technicianIds, supervisorId } = (0, errors_1.parse)(zod_1.z.object({ technicianIds: zod_1.z.array(zod_1.z.number().int().positive()).min(1).max(30), supervisorId: zod_1.z.number().int().positive().nullable().optional() }), req.body);
    const u = req.user;
    const out = await (0, db_1.withTx)(async (tx) => {
        const bk = await lockBooking(tx, u, id);
        if (!ASSIGNABLE.includes(bk.Status))
            throw new errors_1.HttpError(409, 'INVALID_STATE', `Cannot assign technicians while booking is ${bk.Status}`);
        await (0, db_1.query)(`UPDATE BookingAssignments SET IsActive = 0 WHERE BookingId = @b AND IsActive = 1`, { b: id }, tx);
        await (0, scheduling_1.assertTechniciansFree)(tx, u.companyId, technicianIds, bk.StartAt, bk.EndAt, id);
        if (supervisorId !== undefined)
            await setSupervisor(tx, u.companyId, id, supervisorId);
        for (const t of [...new Set(technicianIds)]) {
            await (0, db_1.query)(`INSERT INTO BookingAssignments (BookingId, TechnicianId, StartAt, EndAt) VALUES (@b,@t,@s,@e)`, { b: id, t, s: (0, db_1.dt)(bk.StartAt), e: (0, db_1.dt)(bk.EndAt) }, tx);
        }
        if (bk.Status !== 'assigned') {
            await (0, db_1.query)(`UPDATE Bookings SET Status='assigned', UpdatedAt=SYSUTCDATETIME(), UpdatedBy=@u WHERE Id=@b`, { u: u.id, b: id }, tx);
            await addHistory(tx, id, bk.Status, 'assigned', null, u.id);
        }
        return { id, status: 'assigned' };
    });
    res.json(out);
}));
exports.bookingsRouter.post('/:id/status', (0, middleware_1.requirePerm)('bookings.status'), (0, errors_1.h)(async (req, res) => {
    const id = (0, errors_1.parse)(idParam, req.params.id);
    const b = (0, errors_1.parse)(zod_1.z.object({ status: zod_1.z.enum(transitions_1.STATUSES), reason: zod_1.z.string().trim().max(500).optional() }), req.body);
    const u = req.user;
    if (b.status === 'cancelled' && !u.perms.includes('bookings.cancel'))
        throw new errors_1.HttpError(403, 'FORBIDDEN', 'Cancelling requires bookings.cancel');
    const out = await (0, db_1.withTx)(async (tx) => {
        const bk = await lockBooking(tx, u, id);
        if (!(0, transitions_1.canTransition)(bk.Status, b.status))
            throw new errors_1.HttpError(409, 'INVALID_TRANSITION', `Cannot change status from ${bk.Status} to ${b.status}`);
        if (transitions_1.REASON_REQUIRED.has(b.status) && !b.reason)
            throw new errors_1.HttpError(400, 'REASON_REQUIRED', 'A reason is required for this status');
        if (b.status === 'assigned') {
            const n = await (0, db_1.query)(`SELECT COUNT(*) AS n FROM BookingAssignments WHERE BookingId=@b AND IsActive=1`, { b: id }, tx);
            if (n[0].n === 0)
                throw new errors_1.HttpError(409, 'NO_TECHNICIANS', 'Assign technicians first');
        }
        await (0, db_1.query)(`UPDATE Bookings SET Status=@s, UpdatedAt=SYSUTCDATETIME(), UpdatedBy=@u WHERE Id=@b`, { s: b.status, u: u.id, b: id }, tx);
        if (transitions_1.RELEASES_ASSIGNMENTS.has(b.status)) {
            await (0, db_1.query)(`UPDATE BookingAssignments SET IsActive=0 WHERE BookingId=@b AND IsActive=1`, { b: id }, tx);
        }
        await addHistory(tx, id, bk.Status, b.status, b.reason ?? null, u.id);
        return { id, status: b.status };
    });
    await (0, ratings_1.afterStatus)(u.companyId, id, b.status, config_1.config.appUrl || `https://${req.get('host')}`);
    res.json(out);
}));
const RESCHEDULABLE = ['new', 'awaiting_confirmation', 'confirmed', 'awaiting_assignment', 'assigned', 'postponed'];
exports.bookingsRouter.post('/:id/reschedule', (0, middleware_1.requirePerm)('bookings.update'), (0, errors_1.h)(async (req, res) => {
    const id = (0, errors_1.parse)(idParam, req.params.id);
    const b = (0, errors_1.parse)(zod_1.z.object({ startAt: zod_1.z.coerce.date(), endAt: zod_1.z.coerce.date(), reason: zod_1.z.string().trim().min(2).max(500) }), req.body);
    if (b.endAt <= b.startAt)
        throw new errors_1.HttpError(400, 'VALIDATION_ERROR', 'endAt must be after startAt');
    const u = req.user;
    const out = await (0, db_1.withTx)(async (tx) => {
        const bk = await lockBooking(tx, u, id);
        if (!RESCHEDULABLE.includes(bk.Status))
            throw new errors_1.HttpError(409, 'INVALID_STATE', `Cannot reschedule while booking is ${bk.Status}`);
        const techs = await (0, db_1.query)(`SELECT TechnicianId FROM BookingAssignments WHERE BookingId=@b AND IsActive=1`, { b: id }, tx);
        await (0, scheduling_1.assertTechniciansFree)(tx, u.companyId, techs.map((t) => Number(t.TechnicianId)), b.startAt, b.endAt, id);
        await (0, db_1.query)(`UPDATE Bookings SET StartAt=@s, EndAt=@e, UpdatedAt=SYSUTCDATETIME(), UpdatedBy=@u WHERE Id=@b`, { s: (0, db_1.dt)(b.startAt), e: (0, db_1.dt)(b.endAt), u: u.id, b: id }, tx);
        await (0, db_1.query)(`UPDATE BookingAssignments SET StartAt=@s, EndAt=@e WHERE BookingId=@b AND IsActive=1`, { s: (0, db_1.dt)(b.startAt), e: (0, db_1.dt)(b.endAt), b: id }, tx);
        await addHistory(tx, id, bk.Status, bk.Status, `reschedule: ${b.reason}`, u.id);
        return { id, startAt: b.startAt, endAt: b.endAt };
    });
    res.json(out);
}));
