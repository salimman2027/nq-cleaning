import { Router, type Request } from 'express';
import { z } from 'zod';
import { money, query, withTx } from '../db';
import { HttpError, h, parse } from '../errors';
import { requirePerm } from '../auth/middleware';
import { sniffMime } from '../lib/documents';
import { canTransition, type BookingStatus } from '../lib/transitions';

/**
 * The supervisor's phone app. A supervisor sees only the bookings assigned to them and records what happens on site:
 * depart, arrive, start, progress, finish, cash, next job. Each company decides which of note / photo / video is required per stage.
 */
export const fieldRouter = Router();
export const STAGES = ['depart', 'arrive', 'start', 'progress', 'finish', 'cash', 'next'] as const;
type Stage = (typeof STAGES)[number];
const idParam = z.coerce.number().int().positive();
const MAX_PHOTO = 4 * 1024 * 1024;
const MAX_VIDEO = 15 * 1024 * 1024;

/** The status each stage moves the booking to (progress, cash and next only add to the log). */
const MOVES: Partial<Record<Stage, { from: BookingStatus[]; to: BookingStatus }>> = {
  depart: { from: ['assigned'], to: 'on_the_way' },
  arrive: { from: ['on_the_way'], to: 'arrived' },
  start: { from: ['arrived'], to: 'in_progress' },
  finish: { from: ['in_progress'], to: 'awaiting_review' },
};

export interface StageRule { stage: Stage; noteReq: boolean; photoReq: boolean; videoReq: boolean }

export async function loadStageRules(companyId: number): Promise<StageRule[]> {
  const rows = await query<Record<string, any>>(`SELECT Stage, NoteReq, PhotoReq, VideoReq FROM FieldStageSettings WHERE CompanyId=@c`, { c: companyId });
  return STAGES.map((s) => {
    const r = rows.find((x) => x.Stage === s);
    // Finishing also records the payment, so a proof photo (transfer receipt or cash) is required until the company says otherwise.
    return { stage: s, noteReq: !!r?.NoteReq, photoReq: r ? !!r.PhotoReq : s === 'finish', videoReq: !!r?.VideoReq };
  });
}

export function sniffKind(b: Buffer): { kind: 'photo' | 'video'; mime: string } | null {
  const img = sniffMime(b);
  if (img && img !== 'application/pdf') return { kind: 'photo', mime: img };
  if (b.length > 12 && b.subarray(4, 8).toString('latin1') === 'ftyp') return { kind: 'video', mime: b.subarray(8, 12).toString('latin1').startsWith('qt') ? 'video/quicktime' : 'video/mp4' };
  if (b.length > 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { kind: 'video', mime: 'video/webm' };
  return null;
}

async function mySupervisorId(req: Request): Promise<number> {
  const r = (await query<{ Id: number }>(`SELECT Id FROM Supervisors WHERE UserId=@u AND CompanyId=@c AND IsDeleted=0`, { u: req.user!.id, c: req.user!.companyId }))[0];
  if (!r) throw new HttpError(403, 'NOT_A_SUPERVISOR', 'This account is not linked to a supervisor');
  return Number(r.Id);
}

const JOB_SQL = `SELECT b.Id, b.BookingNo, b.Status, b.StartAt, b.EndAt, b.Total, b.Paid, b.Notes, c.Name AS CustomerName, c.Mobile AS CustomerMobile,
       a.City, a.District, a.Street, a.MapUrl, r.Latitude, r.Longitude, r.PhotoUrl
  FROM Bookings b JOIN Customers c ON c.Id=b.CustomerId JOIN CustomerAddresses a ON a.Id=b.AddressId
  LEFT JOIN BookingRequests r ON r.BookingId=b.Id
 WHERE b.CompanyId=@c AND b.IsDeleted=0 AND b.SupervisorId=@s`;

async function decorate(rows: Record<string, any>[], companyId: number) {
  if (!rows.length) return rows;
  const ids = rows.map((r) => Number(r.Id));
  const lines = await query<Record<string, any>>(`SELECT d.BookingId, s.Name, d.Quantity FROM BookingDetails d JOIN Services s ON s.Id=d.ServiceId WHERE d.BookingId IN (${ids.join(',')})`);
  const team = await query<Record<string, any>>(`SELECT a.BookingId, t.FullName FROM BookingAssignments a JOIN Technicians t ON t.Id=a.TechnicianId WHERE a.IsActive=1 AND a.BookingId IN (${ids.join(',')})`);
  const events = await query<Record<string, any>>(`SELECT Id, BookingId, Stage, Note, Amount, CreatedAt, (SELECT COUNT(*) FROM BookingStageFiles f WHERE f.EventId=e.Id) AS Files FROM BookingStageEvents e WHERE CompanyId=@c AND BookingId IN (${ids.join(',')}) ORDER BY Id`, { c: companyId });
  return rows.map((r) => ({
    ...r,
    Lines: lines.filter((l) => Number(l.BookingId) === Number(r.Id)),
    Team: team.filter((l) => Number(l.BookingId) === Number(r.Id)).map((l) => l.FullName),
    Events: events.filter((l) => Number(l.BookingId) === Number(r.Id)),
  }));
}

fieldRouter.get('/stages', requirePerm('field.work'), h(async (req, res) => res.json({ items: await loadStageRules(req.user!.companyId) })));

const TODAY = `CAST(DATEADD(hour,3,b.StartAt) AS date) = CAST(DATEADD(hour,3,SYSUTCDATETIME()) AS date)`;
const SCHEDULED = `b.Status IN ('confirmed','assigned')`;
const RUNNING = `b.Status IN ('on_the_way','arrived','in_progress','paused')`;
const FINISHED = `b.Status IN ('awaiting_review','done','closed')`;
const LATE = `((${SCHEDULED} AND b.StartAt < SYSUTCDATETIME()) OR (${RUNNING} AND b.EndAt < SYSUTCDATETIME())) AND b.StartAt >= DATEADD(day,-3,SYSUTCDATETIME())`;
/** The filters of the supervisor dashboard. Without one, the list is the jobs still to work on (and finished ones with cash still due). */
const FILTERS: Record<string, string> = {
  upcoming: `${TODAY} AND ${SCHEDULED} AND b.StartAt >= SYSUTCDATETIME()`,
  progress: `${RUNNING}`,
  done: `${TODAY} AND ${FINISHED}`,
  late: LATE,
};

fieldRouter.get('/jobs', requirePerm('field.work'), h(async (req, res) => {
  const s = await mySupervisorId(req).catch(() => null);
  if (s === null) { res.json({ items: [], linked: false }); return; }
  const f = typeof req.query.f === 'string' ? req.query.f : '';
  const cond = FILTERS[f]
    ? `AND (${FILTERS[f]})`
    : `AND ((b.Status IN ('assigned','on_the_way','arrived','in_progress','paused') AND b.StartAt >= DATEADD(day,-3,SYSUTCDATETIME()) AND b.StartAt < DATEADD(day,8,SYSUTCDATETIME()))
         OR (b.Status IN ('awaiting_review','done') AND b.Paid < b.Total AND b.StartAt >= DATEADD(day,-3,SYSUTCDATETIME())))`;
  const rows = await query<Record<string, any>>(`${JOB_SQL} ${cond} ORDER BY b.StartAt`, { c: req.user!.companyId, s });
  res.json({ items: await decorate(rows, req.user!.companyId), linked: true });
}));

/** Numbers for the supervisor's own dashboard: today's agenda, what is running, what is done, what is late, and cash. */
fieldRouter.get('/summary', requirePerm('field.work'), h(async (req, res) => {
  const s = await mySupervisorId(req).catch(() => null);
  if (s === null) { res.json({ linked: false }); return; }
  const c = req.user!.companyId;
  const r = (await query<Record<string, any>>(
    `SELECT SUM(CASE WHEN ${TODAY} AND ${SCHEDULED} AND b.StartAt >= SYSUTCDATETIME() THEN 1 ELSE 0 END) AS Upcoming,
            SUM(CASE WHEN ${RUNNING} THEN 1 ELSE 0 END) AS Running,
            SUM(CASE WHEN ${TODAY} AND ${FINISHED} THEN 1 ELSE 0 END) AS Done,
            SUM(CASE WHEN ${LATE} THEN 1 ELSE 0 END) AS Late,
            SUM(CASE WHEN ${TODAY} THEN 1 ELSE 0 END) AS Today
       FROM Bookings b WHERE b.CompanyId=@c AND b.IsDeleted=0 AND b.SupervisorId=@s AND b.Status NOT IN ('cancelled','postponed')`, { c, s }))[0];
  const cash = (await query<Record<string, any>>(
    `SELECT ISNULL(SUM(e.Amount),0) AS Collected FROM BookingStageEvents e JOIN Bookings b ON b.Id=e.BookingId
      WHERE e.CompanyId=@c AND b.SupervisorId=@s AND e.Stage IN ('cash','finish') AND e.Amount IS NOT NULL AND CAST(DATEADD(hour,3,e.CreatedAt) AS date) = CAST(DATEADD(hour,3,SYSUTCDATETIME()) AS date)`, { c, s }))[0];
  const due = (await query<Record<string, any>>(
    `SELECT ISNULL(SUM(b.Total-b.Paid),0) AS Due FROM Bookings b WHERE b.CompanyId=@c AND b.IsDeleted=0 AND b.SupervisorId=@s AND ${FINISHED} AND b.Paid < b.Total AND b.StartAt >= DATEADD(day,-30,SYSUTCDATETIME())`, { c, s }))[0];
  res.json({ linked: true, today: Number(r.Today ?? 0), upcoming: Number(r.Upcoming ?? 0), running: Number(r.Running ?? 0), done: Number(r.Done ?? 0), late: Number(r.Late ?? 0), cashToday: Number(cash.Collected), cashDue: Number(due.Due) });
}));

fieldRouter.get('/jobs/:id', requirePerm('field.work'), h(async (req, res) => {
  const s = await mySupervisorId(req);
  const rows = await query<Record<string, any>>(`${JOB_SQL} AND b.Id=@i`, { c: req.user!.companyId, s, i: parse(idParam, req.params.id) });
  if (!rows.length) throw new HttpError(404, 'NOT_FOUND', 'Job not found');
  res.json((await decorate(rows, req.user!.companyId))[0]);
}));

const eventSchema = z.object({
  stage: z.enum(STAGES),
  note: z.string().trim().max(1000).optional(),
  amount: z.number().positive().max(1_000_000).optional(),
  method: z.enum(['cash', 'transfer']).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  files: z.array(z.object({ fileName: z.string().trim().min(1).max(200), dataBase64: z.string().min(4) })).max(8).default([]),
});

fieldRouter.post('/jobs/:id/events', requirePerm('field.work'), h(async (req, res) => {
  const companyId = req.user!.companyId;
  const sup = await mySupervisorId(req);
  const id = parse(idParam, req.params.id);
  const b = parse(eventSchema, req.body);
  const files = b.files.map((f) => {
    const data = Buffer.from(f.dataBase64.replace(/^data:[^,]*,/, ''), 'base64');
    const k = sniffKind(data);
    if (!k) throw new HttpError(415, 'UNSUPPORTED_FILE', 'Only photos (PNG, JPG, WEBP) or videos (MP4, MOV, WEBM)');
    if (data.length > (k.kind === 'photo' ? MAX_PHOTO : MAX_VIDEO)) throw new HttpError(413, 'FILE_TOO_LARGE', k.kind === 'photo' ? 'Photo is too large' : 'Video is too large (15 MB max)');
    return { name: f.fileName, data, ...k };
  });
  const rule = (await loadStageRules(companyId)).find((r) => r.stage === b.stage)!;
  if (rule.noteReq && !b.note) throw new HttpError(400, 'NOTE_REQUIRED', 'A note is required for this stage');
  if (rule.photoReq && !files.some((f) => f.kind === 'photo')) throw new HttpError(400, 'PHOTO_REQUIRED', 'A photo is required for this stage');
  if (rule.videoReq && !files.some((f) => f.kind === 'video')) throw new HttpError(400, 'VIDEO_REQUIRED', 'A video is required for this stage');

  const out = await withTx(async (tx) => {
    const bk = (await query<Record<string, any>>(`SELECT Id, Status, Total, Paid FROM Bookings WITH (UPDLOCK) WHERE Id=@i AND CompanyId=@c AND SupervisorId=@s AND IsDeleted=0`, { i: id, c: companyId, s: sup }, tx))[0];
    if (!bk) throw new HttpError(404, 'NOT_FOUND', 'Job not found');
    const status = bk.Status as BookingStatus;
    const mv = MOVES[b.stage];
    if (mv) {
      if (!mv.from.includes(status) || !canTransition(status, mv.to)) throw new HttpError(409, 'INVALID_STATE', `Cannot do "${b.stage}" while the job is ${status}`);
    } else if (b.stage === 'progress') {
      if (status !== 'in_progress') throw new HttpError(409, 'INVALID_STATE', 'Progress can be reported while the work is in progress');
    } else if (b.stage === 'cash') {
      if (!['awaiting_review', 'done', 'closed'].includes(status)) throw new HttpError(409, 'INVALID_STATE', 'Cash is collected after the work is finished');
      if (!b.amount) throw new HttpError(400, 'AMOUNT_REQUIRED', 'Enter the amount received');
      if (Number(bk.Paid) + b.amount > Number(bk.Total) + 0.001) throw new HttpError(400, 'OVER_PAYMENT', 'The amount is more than what is still due');
    } else if (b.stage === 'next' && ['assigned', 'on_the_way', 'arrived', 'in_progress', 'paused'].includes(status)) {
      throw new HttpError(409, 'INVALID_STATE', 'Finish this job before moving to the next one');
    }
    if (b.stage === 'finish') {
      const due = Number(bk.Total) - Number(bk.Paid);
      if (due > 0.001 && !b.amount) throw new HttpError(400, 'AMOUNT_REQUIRED', 'Enter the amount received');
      if (b.amount && b.amount > due + 0.001) throw new HttpError(400, 'OVER_PAYMENT', 'The amount is more than what is still due');
    }
    const ev = (await query<{ Id: number }>(
      `INSERT INTO BookingStageEvents (CompanyId, BookingId, Stage, Note, Amount, Method, Latitude, Longitude, CreatedBy) OUTPUT inserted.Id VALUES (@c,@b,@s,@n,@a,@me,@la,@ln,@u)`,
      { me: b.amount ? (b.method ?? 'cash') : null, c: companyId, b: id, s: b.stage, n: b.note ?? null, a: b.amount != null ? money(b.amount) : null, la: b.lat ?? null, ln: b.lng ?? null, u: req.user!.id }, tx))[0];
    for (const f of files) {
      await query(`INSERT INTO BookingStageFiles (EventId, BookingId, CompanyId, Kind, MimeType, FileName, SizeBytes, Data) VALUES (@e,@b,@c,@k,@m,@f,@s,@d)`,
        { e: ev.Id, b: id, c: companyId, k: f.kind, m: f.mime, f: f.name.replace(/[\\/\x00-\x1f"]/g, '_').slice(0, 150), s: f.data.length, d: f.data }, tx);
    }
    if (mv) {
      await query(`UPDATE Bookings SET Status=@t, UpdatedAt=SYSUTCDATETIME(), UpdatedBy=@u WHERE Id=@i`, { t: mv.to, u: req.user!.id, i: id }, tx);
      await query(`INSERT INTO BookingStatusHistory (BookingId, FromStatus, ToStatus, Reason, ChangedBy) VALUES (@b,@f,@t,N'من تطبيق المشرف',@u)`, { b: id, f: status, t: mv.to, u: req.user!.id }, tx);
    }
    if ((b.stage === 'cash' || b.stage === 'finish') && b.amount) {
      const paid = Math.round((Number(bk.Paid) + b.amount!) * 100) / 100;
      await query(`UPDATE Bookings SET Paid=@p, UpdatedAt=SYSUTCDATETIME() WHERE Id=@i`, { p: money(paid), i: id }, tx);
      if (paid + 0.001 >= Number(bk.Total)) await query(`UPDATE BookingRequests SET PaymentStatus='paid', UpdatedAt=SYSUTCDATETIME() WHERE BookingId=@i`, { i: id }, tx);
    }
    return { id: Number(ev.Id), status: mv ? mv.to : status };
  });
  res.status(201).json(out);
}));

async function sendFile(req: Request, res: import('express').Response, fid: number, companyWide: boolean) {
  const f = (await query<Record<string, any>>(`SELECT f.MimeType, f.Data, b.SupervisorId FROM BookingStageFiles f JOIN Bookings b ON b.Id=f.BookingId WHERE f.Id=@f AND f.CompanyId=@c`, { f: fid, c: req.user!.companyId }))[0];
  if (!f) throw new HttpError(404, 'NOT_FOUND', 'File not found');
  if (!companyWide && Number(f.SupervisorId) !== (await mySupervisorId(req))) throw new HttpError(404, 'NOT_FOUND', 'File not found');
  res.setHeader('Content-Type', f.MimeType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(f.Data);
}
fieldRouter.get('/files/:fid', requirePerm('field.work'), h(async (req, res) => sendFile(req, res, parse(idParam, req.params.fid), false)));
/** Office staff look at the same log from the booking screen. */
export const stageFileForOffice = (req: Request, res: import('express').Response, fid: number) => sendFile(req, res, fid, true);
