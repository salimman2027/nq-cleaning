import { Router } from 'express';
import { z } from 'zod';
import { dt, money, query } from '../db';
import { HttpError, h, parse } from '../errors';
import { branchScope, requirePerm } from '../auth/middleware';
import { config } from '../config';
import { normalizeMobile } from '../lib/phone';

export const techniciansRouter = Router();

const TECH_STATUS = ['available', 'booked', 'on_the_way', 'working', 'break', 'absent', 'leave', 'off_duty'] as const;

techniciansRouter.get(
  '/',
  requirePerm('technicians.view'),
  h(async (req, res) => {
    const scope = branchScope(req.user!);
    const rows = await query(
      `SELECT Id, Code, FullName, Mobile, BranchId, HourlyCost, Status FROM Technicians
        WHERE CompanyId=@c AND IsDeleted=0 AND (@b IS NULL OR BranchId=@b) ORDER BY FullName`,
      { c: req.user!.companyId, b: scope },
    );
    // Cost is sensitive; only returned to users who may view costs.
    const canCost = req.user!.perms.includes('finance.view_cost');
    res.json({ items: rows.map((r) => (canCost ? r : { ...r, HourlyCost: undefined })) });
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
      `SELECT t.Id, t.Code, t.FullName, t.BranchId FROM Technicians t
        WHERE t.CompanyId=@c AND t.IsDeleted=0 AND t.Status NOT IN ('absent','leave','off_duty') AND (@b IS NULL OR t.BranchId=@b)
          AND NOT EXISTS (SELECT 1 FROM BookingAssignments a JOIN Bookings bk ON bk.Id=a.BookingId
                           WHERE a.TechnicianId=t.Id AND a.IsActive=1 AND bk.IsDeleted=0 AND bk.Status NOT IN ('cancelled','postponed')
                             AND a.StartAt < @eb AND a.EndAt > @sb)
          AND NOT EXISTS (SELECT 1 FROM TechnicianLeaves l WHERE l.TechnicianId=t.Id AND l.FromAt < @e AND l.ToAt > @s)
        ORDER BY t.FullName`,
      { c: req.user!.companyId, b: scope, s: dt(q.start), e: dt(q.end), sb: dt(new Date(q.start.getTime() - buffer)), eb: dt(new Date(q.end.getTime() + buffer)) },
    );
    res.json({ items: rows });
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
