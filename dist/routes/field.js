"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stageFileForOffice = exports.OPTIONAL_STAGES = exports.STAGES = exports.fieldRouter = void 0;
exports.loadStageRules = loadStageRules;
exports.sniffKind = sniffKind;
exports.stageLabels = stageLabels;
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../db");
const errors_1 = require("../errors");
const middleware_1 = require("../auth/middleware");
const documents_1 = require("../lib/documents");
const transitions_1 = require("../lib/transitions");
/**
 * The supervisor's phone app. A supervisor sees only the bookings assigned to them and records what happens on site:
 * depart, arrive, start, progress, finish, cash, next job. Each company decides which of note / photo / video is required per stage.
 */
exports.fieldRouter = (0, express_1.Router)();
exports.STAGES = ['depart', 'arrive', 'start', 'progress', 'finish', 'cash', 'next'];
const idParam = zod_1.z.coerce.number().int().positive();
const MAX_PHOTO = 4 * 1024 * 1024;
const MAX_VIDEO = 15 * 1024 * 1024;
/** The status each stage moves the booking to (progress, cash and next only add to the log). */
const MOVES = {
    depart: { from: ['assigned'], to: 'on_the_way' },
    arrive: { from: ['on_the_way'], to: 'arrived' },
    start: { from: ['arrived'], to: 'in_progress' },
    finish: { from: ['in_progress'], to: 'awaiting_review' },
};
/** Stages a company may switch off; the others are the job's backbone (the status machine needs them). */
exports.OPTIONAL_STAGES = ['progress', 'next'];
async function loadStageRules(companyId) {
    const rows = await (0, db_1.query)(`SELECT Stage, NoteReq, PhotoReq, VideoReq, Label, Enabled FROM FieldStageSettings WHERE CompanyId=@c`, { c: companyId });
    return exports.STAGES.map((s) => {
        const r = rows.find((x) => x.Stage === s);
        // Finishing also records the payment, so a proof photo (transfer receipt or cash) is required until the company says otherwise.
        return { stage: s, noteReq: !!r?.NoteReq, photoReq: r ? !!r.PhotoReq : s === 'finish', videoReq: !!r?.VideoReq, label: r?.Label ?? null, enabled: exports.OPTIONAL_STAGES.includes(s) ? r?.Enabled !== false && r?.Enabled !== 0 : true };
    });
}
function sniffKind(b) {
    const img = (0, documents_1.sniffMime)(b);
    if (img && img !== 'application/pdf')
        return { kind: 'photo', mime: img };
    if (b.length > 12 && b.subarray(4, 8).toString('latin1') === 'ftyp')
        return { kind: 'video', mime: b.subarray(8, 12).toString('latin1').startsWith('qt') ? 'video/quicktime' : 'video/mp4' };
    if (b.length > 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3)
        return { kind: 'video', mime: 'video/webm' };
    return null;
}
async function mySupervisorId(req) {
    const r = (await (0, db_1.query)(`SELECT Id FROM Supervisors WHERE UserId=@u AND CompanyId=@c AND IsDeleted=0`, { u: req.user.id, c: req.user.companyId }))[0];
    if (!r)
        throw new errors_1.HttpError(403, 'NOT_A_SUPERVISOR', 'This account is not linked to a supervisor');
    return Number(r.Id);
}
const JOB_SQL = `SELECT b.Id, b.BookingNo, b.Status, b.StartAt, b.EndAt, b.Total, b.Paid, b.Notes, c.Name AS CustomerName, c.Mobile AS CustomerMobile,
       a.City, a.District, a.Street, a.MapUrl, r.Latitude, r.Longitude, COALESCE(b.PhotoUrl, r.PhotoUrl) AS PhotoUrl
  FROM Bookings b JOIN Customers c ON c.Id=b.CustomerId JOIN CustomerAddresses a ON a.Id=b.AddressId
  LEFT JOIN BookingRequests r ON r.BookingId=b.Id
 WHERE b.CompanyId=@c AND b.IsDeleted=0 AND b.SupervisorId=@s`;
async function decorate(rows, companyId) {
    if (!rows.length)
        return rows;
    const ids = rows.map((r) => Number(r.Id));
    const lines = await (0, db_1.query)(`SELECT d.BookingId, s.Name, d.Quantity FROM BookingDetails d JOIN Services s ON s.Id=d.ServiceId WHERE d.BookingId IN (${ids.join(',')})`);
    const team = await (0, db_1.query)(`SELECT a.BookingId, t.FullName FROM BookingAssignments a JOIN Technicians t ON t.Id=a.TechnicianId WHERE a.IsActive=1 AND a.BookingId IN (${ids.join(',')})`);
    const events = await (0, db_1.query)(`SELECT Id, BookingId, Stage, Note, Amount, CreatedAt, (SELECT COUNT(*) FROM BookingStageFiles f WHERE f.EventId=e.Id) AS Files FROM BookingStageEvents e WHERE CompanyId=@c AND BookingId IN (${ids.join(',')}) ORDER BY Id`, { c: companyId });
    return rows.map((r) => ({
        ...r,
        Lines: lines.filter((l) => Number(l.BookingId) === Number(r.Id)),
        Team: team.filter((l) => Number(l.BookingId) === Number(r.Id)).map((l) => l.FullName),
        Events: events.filter((l) => Number(l.BookingId) === Number(r.Id)),
    }));
}
exports.fieldRouter.get('/stages', (0, middleware_1.requirePerm)('field.work'), (0, errors_1.h)(async (req, res) => res.json({ items: await loadStageRules(req.user.companyId) })));
const TODAY = `CAST(DATEADD(hour,3,b.StartAt) AS date) = CAST(DATEADD(hour,3,SYSUTCDATETIME()) AS date)`;
const SCHEDULED = `b.Status IN ('confirmed','assigned')`;
const RUNNING = `b.Status IN ('on_the_way','arrived','in_progress','paused')`;
const FINISHED = `b.Status IN ('awaiting_review','done','closed')`;
const LATE = `((${SCHEDULED} AND b.StartAt < SYSUTCDATETIME()) OR (${RUNNING} AND b.EndAt < SYSUTCDATETIME())) AND b.StartAt >= DATEADD(day,-3,SYSUTCDATETIME())`;
/** The filters of the supervisor dashboard. Without one, the list is the jobs still to work on (and finished ones with cash still due). */
const FILTERS = {
    upcoming: `${TODAY} AND ${SCHEDULED} AND b.StartAt >= SYSUTCDATETIME()`,
    progress: `${RUNNING}`,
    done: `${TODAY} AND ${FINISHED}`,
    late: LATE,
};
exports.fieldRouter.get('/jobs', (0, middleware_1.requirePerm)('field.work'), (0, errors_1.h)(async (req, res) => {
    const s = await mySupervisorId(req).catch(() => null);
    if (s === null) {
        res.json({ items: [], linked: false });
        return;
    }
    const f = typeof req.query.f === 'string' ? req.query.f : '';
    const cond = FILTERS[f]
        ? `AND (${FILTERS[f]})`
        : `AND ((b.Status IN ('assigned','on_the_way','arrived','in_progress','paused') AND b.StartAt >= DATEADD(day,-3,SYSUTCDATETIME()) AND b.StartAt < DATEADD(day,8,SYSUTCDATETIME()))
         OR (b.Status IN ('awaiting_review','done') AND b.Paid < b.Total AND b.StartAt >= DATEADD(day,-3,SYSUTCDATETIME())))`;
    const rows = await (0, db_1.query)(`${JOB_SQL} ${cond} ORDER BY b.StartAt`, { c: req.user.companyId, s });
    res.json({ items: await decorate(rows, req.user.companyId), linked: true });
}));
/** Numbers for the supervisor's own dashboard: today's agenda, what is running, what is done, what is late, and cash. */
exports.fieldRouter.get('/summary', (0, middleware_1.requirePerm)('field.work'), (0, errors_1.h)(async (req, res) => {
    const s = await mySupervisorId(req).catch(() => null);
    if (s === null) {
        res.json({ linked: false });
        return;
    }
    const c = req.user.companyId;
    const r = (await (0, db_1.query)(`SELECT SUM(CASE WHEN ${TODAY} AND ${SCHEDULED} AND b.StartAt >= SYSUTCDATETIME() THEN 1 ELSE 0 END) AS Upcoming,
            SUM(CASE WHEN ${RUNNING} THEN 1 ELSE 0 END) AS Running,
            SUM(CASE WHEN ${TODAY} AND ${FINISHED} THEN 1 ELSE 0 END) AS Done,
            SUM(CASE WHEN ${LATE} THEN 1 ELSE 0 END) AS Late,
            SUM(CASE WHEN ${TODAY} THEN 1 ELSE 0 END) AS Today
       FROM Bookings b WHERE b.CompanyId=@c AND b.IsDeleted=0 AND b.SupervisorId=@s AND b.Status NOT IN ('cancelled','postponed')`, { c, s }))[0];
    const cash = (await (0, db_1.query)(`SELECT ISNULL(SUM(e.Amount),0) AS Collected FROM BookingStageEvents e JOIN Bookings b ON b.Id=e.BookingId
      WHERE e.CompanyId=@c AND b.SupervisorId=@s AND e.Stage IN ('cash','finish') AND e.Amount IS NOT NULL AND CAST(DATEADD(hour,3,e.CreatedAt) AS date) = CAST(DATEADD(hour,3,SYSUTCDATETIME()) AS date)`, { c, s }))[0];
    const due = (await (0, db_1.query)(`SELECT ISNULL(SUM(b.Total-b.Paid),0) AS Due FROM Bookings b WHERE b.CompanyId=@c AND b.IsDeleted=0 AND b.SupervisorId=@s AND ${FINISHED} AND b.Paid < b.Total AND b.StartAt >= DATEADD(day,-30,SYSUTCDATETIME())`, { c, s }))[0];
    res.json({ linked: true, today: Number(r.Today ?? 0), upcoming: Number(r.Upcoming ?? 0), running: Number(r.Running ?? 0), done: Number(r.Done ?? 0), late: Number(r.Late ?? 0), cashToday: Number(cash.Collected), cashDue: Number(due.Due) });
}));
exports.fieldRouter.get('/jobs/:id', (0, middleware_1.requirePerm)('field.work'), (0, errors_1.h)(async (req, res) => {
    const s = await mySupervisorId(req);
    const rows = await (0, db_1.query)(`${JOB_SQL} AND b.Id=@i`, { c: req.user.companyId, s, i: (0, errors_1.parse)(idParam, req.params.id) });
    if (!rows.length)
        throw new errors_1.HttpError(404, 'NOT_FOUND', 'Job not found');
    res.json((await decorate(rows, req.user.companyId))[0]);
}));
const eventSchema = zod_1.z.object({
    stage: zod_1.z.enum(exports.STAGES),
    note: zod_1.z.string().trim().max(1000).optional(),
    amount: zod_1.z.number().positive().max(1_000_000).optional(),
    method: zod_1.z.enum(['cash', 'transfer']).optional(),
    lat: zod_1.z.number().min(-90).max(90).optional(),
    lng: zod_1.z.number().min(-180).max(180).optional(),
    files: zod_1.z.array(zod_1.z.object({ fileName: zod_1.z.string().trim().min(1).max(200), dataBase64: zod_1.z.string().min(4) })).max(8).default([]),
});
exports.fieldRouter.post('/jobs/:id/events', (0, middleware_1.requirePerm)('field.work'), (0, errors_1.h)(async (req, res) => {
    const companyId = req.user.companyId;
    const sup = await mySupervisorId(req);
    const id = (0, errors_1.parse)(idParam, req.params.id);
    const b = (0, errors_1.parse)(eventSchema, req.body);
    const files = b.files.map((f) => {
        const data = Buffer.from(f.dataBase64.replace(/^data:[^,]*,/, ''), 'base64');
        const k = sniffKind(data);
        if (!k)
            throw new errors_1.HttpError(415, 'UNSUPPORTED_FILE', 'Only photos (PNG, JPG, WEBP) or videos (MP4, MOV, WEBM)');
        if (data.length > (k.kind === 'photo' ? MAX_PHOTO : MAX_VIDEO))
            throw new errors_1.HttpError(413, 'FILE_TOO_LARGE', k.kind === 'photo' ? 'Photo is too large' : 'Video is too large (15 MB max)');
        return { name: f.fileName, data, ...k };
    });
    const rule = (await loadStageRules(companyId)).find((r) => r.stage === b.stage);
    if (!rule.enabled)
        throw new errors_1.HttpError(400, 'STAGE_DISABLED', 'This stage is switched off by the company');
    if (rule.noteReq && !b.note)
        throw new errors_1.HttpError(400, 'NOTE_REQUIRED', 'A note is required for this stage');
    if (rule.photoReq && !files.some((f) => f.kind === 'photo'))
        throw new errors_1.HttpError(400, 'PHOTO_REQUIRED', 'A photo is required for this stage');
    if (rule.videoReq && !files.some((f) => f.kind === 'video'))
        throw new errors_1.HttpError(400, 'VIDEO_REQUIRED', 'A video is required for this stage');
    const out = await (0, db_1.withTx)(async (tx) => {
        const bk = (await (0, db_1.query)(`SELECT Id, Status, Total, Paid FROM Bookings WITH (UPDLOCK) WHERE Id=@i AND CompanyId=@c AND SupervisorId=@s AND IsDeleted=0`, { i: id, c: companyId, s: sup }, tx))[0];
        if (!bk)
            throw new errors_1.HttpError(404, 'NOT_FOUND', 'Job not found');
        const status = bk.Status;
        const mv = MOVES[b.stage];
        if (mv) {
            if (!mv.from.includes(status) || !(0, transitions_1.canTransition)(status, mv.to))
                throw new errors_1.HttpError(409, 'INVALID_STATE', `Cannot do "${b.stage}" while the job is ${status}`);
        }
        else if (b.stage === 'progress') {
            if (status !== 'in_progress')
                throw new errors_1.HttpError(409, 'INVALID_STATE', 'Progress can be reported while the work is in progress');
        }
        else if (b.stage === 'cash') {
            if (!['awaiting_review', 'done', 'closed'].includes(status))
                throw new errors_1.HttpError(409, 'INVALID_STATE', 'Cash is collected after the work is finished');
            if (!b.amount)
                throw new errors_1.HttpError(400, 'AMOUNT_REQUIRED', 'Enter the amount received');
            if (Number(bk.Paid) + b.amount > Number(bk.Total) + 0.001)
                throw new errors_1.HttpError(400, 'OVER_PAYMENT', 'The amount is more than what is still due');
        }
        else if (b.stage === 'next' && ['assigned', 'on_the_way', 'arrived', 'in_progress', 'paused'].includes(status)) {
            throw new errors_1.HttpError(409, 'INVALID_STATE', 'Finish this job before moving to the next one');
        }
        if (b.stage === 'finish') {
            const due = Number(bk.Total) - Number(bk.Paid);
            if (due > 0.001 && !b.amount)
                throw new errors_1.HttpError(400, 'AMOUNT_REQUIRED', 'Enter the amount received');
            if (b.amount && b.amount > due + 0.001)
                throw new errors_1.HttpError(400, 'OVER_PAYMENT', 'The amount is more than what is still due');
        }
        const ev = (await (0, db_1.query)(`INSERT INTO BookingStageEvents (CompanyId, BookingId, Stage, Note, Amount, Method, Latitude, Longitude, CreatedBy) OUTPUT inserted.Id VALUES (@c,@b,@s,@n,@a,@me,@la,@ln,@u)`, { me: b.amount ? (b.method ?? 'cash') : null, c: companyId, b: id, s: b.stage, n: b.note ?? null, a: b.amount != null ? (0, db_1.money)(b.amount) : null, la: b.lat ?? null, ln: b.lng ?? null, u: req.user.id }, tx))[0];
        for (const f of files) {
            await (0, db_1.query)(`INSERT INTO BookingStageFiles (EventId, BookingId, CompanyId, Kind, MimeType, FileName, SizeBytes, Data) VALUES (@e,@b,@c,@k,@m,@f,@s,@d)`, { e: ev.Id, b: id, c: companyId, k: f.kind, m: f.mime, f: f.name.replace(/[\\/\x00-\x1f"]/g, '_').slice(0, 150), s: f.data.length, d: f.data }, tx);
        }
        if (mv) {
            await (0, db_1.query)(`UPDATE Bookings SET Status=@t, UpdatedAt=SYSUTCDATETIME(), UpdatedBy=@u WHERE Id=@i`, { t: mv.to, u: req.user.id, i: id }, tx);
            await (0, db_1.query)(`INSERT INTO BookingStatusHistory (BookingId, FromStatus, ToStatus, Reason, ChangedBy) VALUES (@b,@f,@t,N'من تطبيق المشرف',@u)`, { b: id, f: status, t: mv.to, u: req.user.id }, tx);
        }
        if ((b.stage === 'cash' || b.stage === 'finish') && b.amount) {
            const paid = Math.round((Number(bk.Paid) + b.amount) * 100) / 100;
            await (0, db_1.query)(`UPDATE Bookings SET Paid=@p, UpdatedAt=SYSUTCDATETIME() WHERE Id=@i`, { p: (0, db_1.money)(paid), i: id }, tx);
            if (paid + 0.001 >= Number(bk.Total))
                await (0, db_1.query)(`UPDATE BookingRequests SET PaymentStatus='paid', UpdatedAt=SYSUTCDATETIME() WHERE BookingId=@i`, { i: id }, tx);
        }
        return { id: Number(ev.Id), status: mv ? mv.to : status };
    });
    res.status(201).json(out);
}));
async function sendFile(req, res, fid, companyWide) {
    const f = (await (0, db_1.query)(`SELECT f.MimeType, f.Data, b.SupervisorId FROM BookingStageFiles f JOIN Bookings b ON b.Id=f.BookingId WHERE f.Id=@f AND f.CompanyId=@c`, { f: fid, c: req.user.companyId }))[0];
    if (!f)
        throw new errors_1.HttpError(404, 'NOT_FOUND', 'File not found');
    if (!companyWide && Number(f.SupervisorId) !== (await mySupervisorId(req)))
        throw new errors_1.HttpError(404, 'NOT_FOUND', 'File not found');
    res.setHeader('Content-Type', f.MimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(f.Data);
}
exports.fieldRouter.get('/files/:fid', (0, middleware_1.requirePerm)('field.work'), (0, errors_1.h)(async (req, res) => sendFile(req, res, (0, errors_1.parse)(idParam, req.params.fid), false)));
/** Office staff look at the same log from the booking screen. */
const stageFileForOffice = (req, res, fid) => sendFile(req, res, fid, true);
exports.stageFileForOffice = stageFileForOffice;
/** Custom stage names a company chose, by stage code. */
async function stageLabels(companyId) {
    const rows = await (0, db_1.query)(`SELECT Stage, Label FROM FieldStageSettings WHERE CompanyId=@c AND Label IS NOT NULL`, { c: companyId });
    return Object.fromEntries(rows.map((r) => [r.Stage, r.Label]));
}
