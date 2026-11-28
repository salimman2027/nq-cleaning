import { Router } from 'express';
import { z } from 'zod';
import { query, withTx } from '../db';
import { HttpError, h, parse } from '../errors';
import { branchScope, requirePerm } from '../auth/middleware';
import { normalizeMobile } from '../lib/phone';
import bcrypt from 'bcryptjs';
import { ensureRoles } from '../services/tenancy';

/** Supervisors and the technicians who report to them. A booking may use any supervisor, not only the technicians' usual one. */
export const supervisorsRouter = Router();

const idParam = z.coerce.number().int().positive();
const body = z.object({
  fullName: z.string().trim().min(2).max(200),
  mobile: z.string().trim().max(20).optional(),
  branchId: z.number().int().positive(),
  maxBookingsPerDay: z.number().int().min(1).max(100).default(10),
});

supervisorsRouter.get('/', requirePerm('technicians.view'), h(async (req, res) => {
  const c = req.user!.companyId;
  const scope = branchScope(req.user!);
  const sups = await query<Record<string, any>>(`SELECT Id, FullName, Mobile, BranchId, MaxBookingsPerDay, CAST(CASE WHEN UserId IS NULL THEN 0 ELSE 1 END AS BIT) AS HasLogin FROM Supervisors WHERE CompanyId=@c AND IsDeleted=0 AND (@b IS NULL OR BranchId=@b) ORDER BY FullName`, { c, b: scope });
  const techs = await query<Record<string, any>>(`SELECT Id, Code, FullName, Status, SupervisorId FROM Technicians WHERE CompanyId=@c AND IsDeleted=0 AND (@b IS NULL OR BranchId=@b) ORDER BY FullName`, { c, b: scope });
  res.json({
    items: sups.map((s) => ({ ...s, technicians: techs.filter((t) => t.SupervisorId === s.Id) })),
    unassigned: techs.filter((t) => t.SupervisorId == null),
  });
}));

supervisorsRouter.post('/', requirePerm('technicians.manage'), h(async (req, res) => {
  const b = parse(body, req.body);
  const br = await query(`SELECT Id FROM Branches WHERE Id=@b AND CompanyId=@c AND IsDeleted=0`, { b: b.branchId, c: req.user!.companyId });
  if (!br[0]) throw new HttpError(400, 'VALIDATION_ERROR', 'Unknown branch');
  const r = await query<{ Id: number }>(`INSERT INTO Supervisors (CompanyId, BranchId, FullName, Mobile, MaxBookingsPerDay) OUTPUT INSERTED.Id VALUES (@c,@b,@n,@m,@x)`,
    { c: req.user!.companyId, b: b.branchId, n: b.fullName, m: b.mobile ? normalizeMobile(b.mobile) : null, x: b.maxBookingsPerDay });
  res.status(201).json({ id: Number(r[0].Id) });
}));

/** One click: 5 supervisors with 5 technicians each, named for testing. Rename them afterwards. */
supervisorsRouter.post('/test-team', requirePerm('technicians.manage'), h(async (req, res) => {
  const c = req.user!.companyId;
  const br = (await query<{ Id: number }>(`SELECT TOP 1 Id FROM Branches WHERE CompanyId=@c AND IsDeleted=0 AND (@b IS NULL OR Id=@b) ORDER BY Id`, { c, b: branchScope(req.user!) }))[0];
  if (!br) throw new HttpError(400, 'VALIDATION_ERROR', 'Unknown branch');
  const dup = await query(`SELECT 1 AS x FROM Supervisors WHERE CompanyId=@c AND IsDeleted=0 AND FullName LIKE N'مشرف [1-5]'`, { c });
  if (dup[0]) throw new HttpError(409, 'ALREADY_EXISTS', 'Test supervisors already exist');
  await withTx(async (tx) => {
    for (let s = 1; s <= 5; s++) {
      const sid = (await query<{ Id: number }>(`INSERT INTO Supervisors (CompanyId, BranchId, FullName, MaxBookingsPerDay) OUTPUT INSERTED.Id VALUES (@c,@b,@n,10)`, { c, b: br.Id, n: `مشرف ${s}` }, tx))[0].Id;
      for (let k = 1; k <= 5; k++) {
        await query(`INSERT INTO Technicians (CompanyId, BranchId, Code, FullName, SupervisorId) VALUES (@c,@b,'T-' + RIGHT('000000' + CAST(NEXT VALUE FOR TechnicianCodeSeq AS VARCHAR(12)), 6),@n,@s)`, { c, b: br.Id, n: `فني ${s}-${k}`, s: sid }, tx);
      }
    }
  });
  res.status(201).json({ supervisors: 5, technicians: 25 });
}));

supervisorsRouter.put('/:id', requirePerm('technicians.manage'), h(async (req, res) => {
  const id = parse(idParam, req.params.id);
  const b = parse(body.omit({ branchId: true }), req.body);
  const r = await query(`UPDATE Supervisors SET FullName=@n, Mobile=@m, MaxBookingsPerDay=@x OUTPUT INSERTED.Id WHERE Id=@i AND CompanyId=@c AND IsDeleted=0`,
    { n: b.fullName, m: b.mobile ? normalizeMobile(b.mobile) : null, x: b.maxBookingsPerDay, i: id, c: req.user!.companyId });
  if (!r[0]) throw new HttpError(404, 'NOT_FOUND', 'Supervisor not found');
  res.json({ id });
}));

/** Gives a supervisor a phone login (mobile number + password), or resets the password of the existing one. The account can only use the field app. */
supervisorsRouter.post('/:id/login', requirePerm('users.manage'), h(async (req, res) => {
  const id = parse(idParam, req.params.id);
  const { password } = parse(z.object({ password: z.string().min(8).max(200) }), req.body);
  const c = req.user!.companyId;
  const sv = (await query<Record<string, any>>(`SELECT Id, FullName, Mobile, BranchId, UserId FROM Supervisors WHERE Id=@i AND CompanyId=@c AND IsDeleted=0`, { i: id, c }))[0];
  if (!sv) throw new HttpError(404, 'NOT_FOUND', 'Supervisor not found');
  if (!sv.Mobile || !/^05\d{8}$/.test(sv.Mobile)) throw new HttpError(400, 'MOBILE_REQUIRED', 'Add the supervisor mobile number (05XXXXXXXX) first');
  const hash = await bcrypt.hash(password, 12);
  await withTx(async (tx) => {
    if (sv.UserId) {
      await query(`UPDATE Users SET PasswordHash=@p, IsActive=1, UpdatedAt=SYSUTCDATETIME(), UpdatedBy=@u WHERE Id=@i AND CompanyId=@c`, { p: hash, u: req.user!.id, i: sv.UserId, c }, tx);
      return;
    }
    const email = `${sv.Mobile}@field.local`;
    if ((await query(`SELECT 1 AS x FROM Users WHERE Email=@e AND IsDeleted=0`, { e: email }, tx)).length) throw new HttpError(409, 'DUPLICATE', 'This mobile number already has a login');
    await ensureRoles(tx, c);
    const u = (await query<{ Id: number }>(`INSERT INTO Users (CompanyId, BranchId, FullName, Email, PasswordHash, CreatedBy) OUTPUT INSERTED.Id VALUES (@c,@b,@n,@e,@p,@u)`, { c, b: sv.BranchId, n: sv.FullName, e: email, p: hash, u: req.user!.id }, tx))[0];
    const role = (await query<{ Id: number }>(`SELECT Id FROM Roles WHERE CompanyId=@c AND Name='Field Supervisor'`, { c }, tx))[0];
    await query(`INSERT INTO UserRoles (UserId, RoleId) VALUES (@u,@r)`, { u: u.Id, r: role.Id }, tx);
    await query(`UPDATE Supervisors SET UserId=@u WHERE Id=@i`, { u: u.Id, i: id }, tx);
    await query(`INSERT INTO AuditLogs (CompanyId, UserId, Action, Entity, EntityId) VALUES (@c,@u,'create','FieldLogin',@e)`, { c, u: req.user!.id, e: String(id) }, tx);
  });
  res.json({ username: sv.Mobile });
}));

/** Removing a supervisor frees their technicians; past bookings keep the name for the reports. */
supervisorsRouter.delete('/:id', requirePerm('technicians.manage'), h(async (req, res) => {
  const id = parse(idParam, req.params.id);
  await withTx(async (tx) => {
    const r = await query(`UPDATE Supervisors SET IsDeleted=1 OUTPUT INSERTED.Id WHERE Id=@i AND CompanyId=@c AND IsDeleted=0`, { i: id, c: req.user!.companyId }, tx);
    if (!r[0]) throw new HttpError(404, 'NOT_FOUND', 'Supervisor not found');
    await query(`UPDATE Technicians SET SupervisorId=NULL WHERE SupervisorId=@i AND CompanyId=@c`, { i: id, c: req.user!.companyId }, tx);
    await query(`UPDATE Users SET IsActive=0 WHERE Id=(SELECT UserId FROM Supervisors WHERE Id=@i) AND CompanyId=@c`, { i: id, c: req.user!.companyId }, tx);
  });
  res.status(204).end();
}));

/** Move a technician under another supervisor (or none). */
supervisorsRouter.put('/technician/:techId', requirePerm('technicians.manage'), h(async (req, res) => {
  const techId = parse(idParam, req.params.techId);
  const { supervisorId } = parse(z.object({ supervisorId: z.number().int().positive().nullable() }), req.body);
  const c = req.user!.companyId;
  if (supervisorId !== null) {
    const s = await query(`SELECT Id FROM Supervisors WHERE Id=@i AND CompanyId=@c AND IsDeleted=0`, { i: supervisorId, c });
    if (!s[0]) throw new HttpError(400, 'VALIDATION_ERROR', 'Unknown supervisor');
  }
  const r = await query(`UPDATE Technicians SET SupervisorId=@s OUTPUT INSERTED.Id WHERE Id=@t AND CompanyId=@c AND IsDeleted=0`, { s: supervisorId, t: techId, c });
  if (!r[0]) throw new HttpError(404, 'NOT_FOUND', 'Technician not found');
  res.json({ id: techId, supervisorId });
}));
