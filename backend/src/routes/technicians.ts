import { Router } from 'express';
import { z } from 'zod';
import { dt, money, query } from '../db';
import { HttpError, h, parse } from '../errors';
import { branchScope, requirePerm } from '../auth/middleware';
import { config } from '../config';
import { normalizeMobile } from '../lib/phone';
import { sniffMime } from '../lib/documents';
import type { Request } from 'express';

export const techniciansRouter = Router();

/** Residence IDs are personal data: only staff who manage technicians or assign them to jobs. */
const canSeeIqama = (req: Request) => !!req.user && (req.user.perms.includes('technicians.manage') || req.user.perms.includes('bookings.assign'));
const needIqama = (req: Request) => { if (!canSeeIqama(req)) throw new HttpError(403, 'FORBIDDEN', 'Insufficient permissions'); };

const TECH_STATUS = ['available', 'booked', 'on_the_way', 'working', 'break', 'absent', 'leave', 'off_duty'] as const;

techniciansRouter.get(
  '/',
  requirePerm('technicians.view'),
  h(async (req, res) => {
    const scope = branchScope(req.user!);
    const rows = await query(
      `SELECT Id, Code, FullName, Mobile, BranchId, HourlyCost, Status, SupervisorId, IqamaNumber, CAST(CASE WHEN EXISTS (SELECT 1 FROM TechnicianIqama q WHERE q.TechnicianId=Technicians.Id) THEN 1 ELSE 0 END AS BIT) AS HasIqamaPhoto, (SELECT FullName FROM Supervisors sv WHERE sv.Id=Technicians.SupervisorId) AS SupervisorName FROM Technicians
        WHERE CompanyId=@c AND IsDeleted=0 AND (@b IS NULL OR BranchId=@b) ORDER BY FullName`,
      { c: req.user!.companyId, b: scope },
    );
    // Cost is sensitive; only returned to users who may view costs.
    const canCost = req.user!.perms.includes('finance.view_cost');
    const canId = canSeeIqama(req);
    res.json({ items: rows.map((r) => ({ ...r, HourlyCost: canCost ? r.HourlyCost : undefined, IqamaNumber: canId ? r.IqamaNumber : undefined, HasIqamaPhoto: canId ? r.HasIqamaPhoto : undefined })) });
  }),
);

/** Technicians with no overlapping assignment (travel buffer included) and no leave in the range. */
techniciansRouter.get(
  '/available',
  requirePerm('technicians.view'),
  h(async (req, res) => {
    const q = parse(z.object({ start: z.coerce.date(), end: z.coerce.date() }), req.query);
    if (q.end <= q.start) throw new HttpError(400, 'VALIDATION_ERROR', 'end must be after start');
    const buffer = config.travelBufferMinutes * 60 * 1000;
    const scope = branchScope(req.user!);
    const rows = await query(
      `SELECT t.Id, t.Code, t.FullName, t.BranchId, t.SupervisorId, t.IqamaNumber, CAST(CASE WHEN EXISTS (SELECT 1 FROM TechnicianIqama q WHERE q.TechnicianId=t.Id) THEN 1 ELSE 0 END AS BIT) AS HasIqamaPhoto FROM Technicians t
        WHERE t.CompanyId=@c AND t.IsDeleted=0 AND t.Status NOT IN ('absent','leave','off_duty') AND (@b IS NULL OR t.BranchId=@b)
          AND NOT EXISTS (SELECT 1 FROM BookingAssignments a JOIN Bookings bk ON bk.Id=a.BookingId
                           WHERE a.TechnicianId=t.Id AND a.IsActive=1 AND bk.IsDeleted=0 AND bk.Status NOT IN ('cancelled','postponed')
                             AND a.StartAt < @eb AND a.EndAt > @sb)
          AND NOT EXISTS (SELECT 1 FROM TechnicianLeaves l WHERE l.TechnicianId=t.Id AND l.FromAt < @e AND l.ToAt > @s)
        ORDER BY t.FullName`,
      { c: req.user!.companyId, b: scope, s: dt(q.start), e: dt(q.end), sb: dt(new Date(q.start.getTime() - buffer)), eb: dt(new Date(q.end.getTime() + buffer)) },
    );
    const canId = canSeeIqama(req);
    res.json({ items: rows.map((r: Record<string, any>) => ({ ...r, IqamaNumber: canId ? r.IqamaNumber : undefined, HasIqamaPhoto: canId ? r.HasIqamaPhoto : undefined })) });
  }),
);

const techSchema = z.object({
  fullName: z.string().min(2).max(200),
  mobile: z.string().max(20).optional(),
  branchId: z.number().int().positive(),
  hourlyCost: z.number().min(0).max(10000).default(0),
});

techniciansRouter.post(
  '/',
  requirePerm('technicians.manage'),
  h(async (req, res) => {
    const b = parse(techSchema, req.body);
    const branch = await query(`SELECT Id FROM Branches WHERE Id=@b AND CompanyId=@c AND IsDeleted=0`, { b: b.branchId, c: req.user!.companyId });
    if (!branch[0]) throw new HttpError(400, 'VALIDATION_ERROR', 'Unknown branch');
    const r = await query<{ Id: number; Code: string }>(
      `INSERT INTO Technicians (CompanyId, BranchId, Code, FullName, Mobile, HourlyCost)
       OUTPUT INSERTED.Id, INSERTED.Code
       VALUES (@c,@b,'T-' + RIGHT('000000' + CAST(NEXT VALUE FOR TechnicianCodeSeq AS VARCHAR(12)), 6),@n,@m,@hc)`,
      { c: req.user!.companyId, b: b.branchId, n: b.fullName, m: b.mobile ? normalizeMobile(b.mobile) : null, hc: money(b.hourlyCost) },
    );
    res.status(201).json({ id: Number(r[0].Id), code: r[0].Code });
  }),
);

techniciansRouter.patch(
  '/:id/status',
  requirePerm('technicians.manage'),
  h(async (req, res) => {
    const id = parse(z.coerce.number().int().positive(), req.params.id);
    const { status } = parse(z.object({ status: z.enum(TECH_STATUS) }), req.body);
    const r = await query(`UPDATE Technicians SET Status=@s OUTPUT INSERTED.Id WHERE Id=@i AND CompanyId=@c AND IsDeleted=0`, { s: status, i: id, c: req.user!.companyId });
    if (!r[0]) throw new HttpError(404, 'NOT_FOUND', 'Technician not found');
    res.json({ id, status });
  }),
);

techniciansRouter.post(
  '/:id/leaves',
  requirePerm('technicians.manage'),
  h(async (req, res) => {
    const id = parse(z.coerce.number().int().positive(), req.params.id);
    const b = parse(z.object({ fromAt: z.coerce.date(), toAt: z.coerce.date(), reason: z.string().max(300).optional() }), req.body);
    if (b.toAt <= b.fromAt) throw new HttpError(400, 'VALIDATION_ERROR', 'toAt must be after fromAt');
    const own = await query(`SELECT Id FROM Technicians WHERE Id=@i AND CompanyId=@c AND IsDeleted=0`, { i: id, c: req.user!.companyId });
    if (!own[0]) throw new HttpError(404, 'NOT_FOUND', 'Technician not found');
    await query(`INSERT INTO TechnicianLeaves (TechnicianId, FromAt, ToAt, Reason) VALUES (@t,@f,@to,@r)`, { t: id, f: dt(b.fromAt), to: dt(b.toAt), r: b.reason ?? null });
    res.status(201).json({ ok: true });
  }),
);

const techId = z.coerce.number().int().positive();

techniciansRouter.put(
  '/:id/iqama',
  requirePerm('technicians.manage'),
  h(async (req, res) => {
    const id = parse(techId, req.params.id);
    const { number } = parse(z.object({ number: z.string().trim().regex(/^[12]\d{9}$/, 'Iqama / ID number is 10 digits starting with 1 or 2').or(z.literal('')) }), req.body);
    const r = await query(`UPDATE Technicians SET IqamaNumber=@n WHERE Id=@i AND CompanyId=@c AND IsDeleted=0`, { n: number || null, i: id, c: req.user!.companyId });
    void r;
    res.json({ id, number: number || null });
  }),
);

techniciansRouter.post(
  '/:id/iqama-photo',
  requirePerm('technicians.manage'),
  h(async (req, res) => {
    const id = parse(techId, req.params.id);
    const { dataBase64 } = parse(z.object({ dataBase64: z.string().min(4) }), req.body);
    const t = await query(`SELECT 1 AS x FROM Technicians WHERE Id=@i AND CompanyId=@c AND IsDeleted=0`, { i: id, c: req.user!.companyId });
    if (!t.length) throw new HttpError(404, 'NOT_FOUND', 'Technician not found');
    const data = Buffer.from(dataBase64.replace(/^data:[^,]*,/, ''), 'base64');
    if (data.length > 2 * 1024 * 1024) throw new HttpError(413, 'FILE_TOO_LARGE', 'File must be 2 MB or smaller');
    const mime = sniffMime(data);
    if (!mime) throw new HttpError(415, 'UNSUPPORTED_FILE', 'Only PNG, JPG, WEBP or PDF');
    await query(
      `MERGE TechnicianIqama AS t USING (SELECT @i AS TechnicianId) AS s ON t.TechnicianId=s.TechnicianId
       WHEN MATCHED THEN UPDATE SET MimeType=@m, SizeBytes=@s, Data=@d, UploadedAt=SYSUTCDATETIME()
       WHEN NOT MATCHED THEN INSERT (TechnicianId, CompanyId, MimeType, SizeBytes, Data) VALUES (@i,@c,@m,@s,@d);`,
      { i: id, c: req.user!.companyId, m: mime, s: data.length, d: data });
    res.status(201).json({ id });
  }),
);

techniciansRouter.get(
  '/:id/iqama-photo',
  h(async (req, res) => {
    needIqama(req);
    const id = parse(techId, req.params.id);
    const f = (await query<Record<string, any>>(`SELECT MimeType, Data FROM TechnicianIqama WHERE TechnicianId=@i AND CompanyId=@c`, { i: id, c: req.user!.companyId }))[0];
    if (!f) throw new HttpError(404, 'NOT_FOUND', 'No file');
    res.setHeader('Content-Type', f.MimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(f.Data);
  }),
);

techniciansRouter.delete(
  '/:id/iqama-photo',
  requirePerm('technicians.manage'),
  h(async (req, res) => {
    await query(`DELETE FROM TechnicianIqama WHERE TechnicianId=@i AND CompanyId=@c`, { i: parse(techId, req.params.id), c: req.user!.companyId });
    res.json({ ok: true });
  }),
);
