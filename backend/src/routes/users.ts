import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query, withTx } from '../db';
import { HttpError, h, parse } from '../errors';
import { requirePerm } from '../auth/middleware';

export const usersRouter = Router();

usersRouter.use(requirePerm('users.manage'));

usersRouter.get(
  '/',
  h(async (req, res) => {
    const rows = await query(
      `SELECT u.Id, u.FullName, u.Email, u.BranchId, u.IsActive,
              (SELECT STRING_AGG(r.Name, ', ') FROM UserRoles ur JOIN Roles r ON r.Id=ur.RoleId WHERE ur.UserId=u.Id) AS Roles
         FROM Users u WHERE u.CompanyId=@c AND u.IsDeleted=0 ORDER BY u.FullName`,
      { c: req.user!.companyId },
    );
    res.json({ items: rows });
  }),
);

usersRouter.get(
  '/roles',
  h(async (req, res) => {
    res.json({ items: await query(`SELECT Id, Name FROM Roles WHERE CompanyId=@c ORDER BY Name`, { c: req.user!.companyId }) });
  }),
);

usersRouter.post(
  '/',
  h(async (req, res) => {
    const b = parse(
      z.object({
        fullName: z.string().min(2).max(200),
        email: z.string().email().max(256),
        password: z.string().min(12).max(200),
        branchId: z.number().int().positive().nullable().default(null),
        roleIds: z.array(z.number().int().positive()).min(1).max(5),
      }),
      req.body,
    );
    const c = req.user!.companyId;
    const id = await withTx(async (tx) => {
      const roles = await query<{ Id: number }>(`SELECT Id FROM Roles WHERE CompanyId=@c AND Id IN (${b.roleIds.map((_, i) => `@r${i}`).join(',')})`, { c, ...Object.fromEntries(b.roleIds.map((r, i) => [`r${i}`, r])) }, tx);
      if (roles.length !== new Set(b.roleIds).size) throw new HttpError(400, 'VALIDATION_ERROR', 'Unknown role');
      if (b.branchId) {
        const br = await query(`SELECT Id FROM Branches WHERE Id=@b AND CompanyId=@c AND IsDeleted=0`, { b: b.branchId, c }, tx);
        if (!br[0]) throw new HttpError(400, 'VALIDATION_ERROR', 'Unknown branch');
      }
      const hash = await bcrypt.hash(b.password, 12);
      const r = await query<{ Id: number }>(
        `INSERT INTO Users (CompanyId, BranchId, FullName, Email, PasswordHash, CreatedBy) OUTPUT INSERTED.Id VALUES (@c,@b,@n,@e,@p,@u)`,
        { c, b: b.branchId, n: b.fullName, e: b.email.toLowerCase(), p: hash, u: req.user!.id },
        tx,
      );
      const uid = Number(r[0].Id);
      for (const rid of new Set(b.roleIds)) await query(`INSERT INTO UserRoles (UserId, RoleId) VALUES (@u,@r)`, { u: uid, r: rid }, tx);
      await query(`INSERT INTO AuditLogs (CompanyId, UserId, Action, Entity, EntityId) VALUES (@c,@u,'create','User',@e)`, { c, u: req.user!.id, e: String(uid) }, tx);
      return uid;
    });
    res.status(201).json({ id });
  }),
);

usersRouter.patch(
  '/:id/active',
  h(async (req, res) => {
    const id = parse(z.coerce.number().int().positive(), req.params.id);
    const { isActive } = parse(z.object({ isActive: z.boolean() }), req.body);
    if (id === req.user!.id && !isActive) throw new HttpError(400, 'VALIDATION_ERROR', 'You cannot deactivate yourself');
    const r = await query(`UPDATE Users SET IsActive=@a, UpdatedAt=SYSUTCDATETIME(), UpdatedBy=@u OUTPUT INSERTED.Id WHERE Id=@i AND CompanyId=@c AND IsDeleted=0`, { a: isActive, u: req.user!.id, i: id, c: req.user!.companyId });
    if (!r[0]) throw new HttpError(404, 'NOT_FOUND', 'User not found');
    if (!isActive) await query(`UPDATE RefreshTokens SET RevokedAt=SYSUTCDATETIME() WHERE UserId=@i AND RevokedAt IS NULL`, { i: id });
    res.json({ id, isActive });
  }),
);
