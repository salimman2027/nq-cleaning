import { createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config';
import { query, withTx } from '../db';
import { HttpError, h, parse } from '../errors';
import { authenticate, signAccess } from '../auth/middleware';
import type { AuthUser } from '../types';
import { normalizeMobile } from '../lib/phone';
import { isSaudiMobile } from '../lib/otp';
import { requestOtp, verifyOtp } from '../services/otp';

export const authRouter = Router();

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
// Used to keep response time similar when the e-mail does not exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

export async function loadPerms(userId: number, tx?: import('mssql').Transaction): Promise<string[]> {
  const rows = await query<{ Code: string }>(
    `SELECT DISTINCT p.Code FROM UserRoles ur
     JOIN RolePermissions rp ON rp.RoleId = ur.RoleId
     JOIN Permissions p ON p.Id = rp.PermissionId
     WHERE ur.UserId = @uid`,
    { uid: userId },
    tx,
  );
  return rows.map((r) => r.Code);
}

export async function issueRefresh(userId: number, tx: import('mssql').Transaction): Promise<{ token: string; id: number }> {
  const token = randomBytes(48).toString('base64url');
  const rows = await query<{ Id: number }>(
    `INSERT INTO RefreshTokens (UserId, TokenHash, ExpiresAt)
     OUTPUT INSERTED.Id VALUES (@u, @h, DATEADD(DAY, @d, SYSUTCDATETIME()))`,
    { u: userId, h: sha256(token), d: config.jwt.refreshDays },
    tx,
  );
  return { token, id: Number(rows[0].Id) };
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});

authRouter.post(
  '/login',
  loginLimiter,
  h(async (req, res) => {
    const body = parse(z.object({ email: z.string().email().max(256), password: z.string().min(1).max(200) }), req.body);
    const users = await query<{
      Id: number; CompanyId: number; BranchId: number | null; FullName: string; PasswordHash: string;
    }>(
      `SELECT Id, CompanyId, BranchId, FullName, PasswordHash FROM Users
       WHERE Email = @e AND IsActive = 1 AND IsDeleted = 0`,
      { e: body.email.toLowerCase() },
    );
    let matched: (typeof users)[number] | undefined;
    if (users.length === 0) {
      await bcrypt.compare(body.password, DUMMY_HASH);
    }
    for (const u of users) {
      if (await bcrypt.compare(body.password, u.PasswordHash)) {
        matched = u;
        break;
      }
    }
    if (!matched) throw new HttpError(401, 'BAD_CREDENTIALS', 'Incorrect e-mail or password');

    const perms = await loadPerms(matched.Id);
    const user: AuthUser = { id: matched.Id, companyId: matched.CompanyId, branchId: matched.BranchId, perms };
    const refresh = await withTx((tx) => issueRefresh(user.id, tx));
    await query(`INSERT INTO AuditLogs (CompanyId, UserId, Action, Entity, EntityId) VALUES (@c,@u,'login','User',@e)`, {
      c: user.companyId, u: user.id, e: String(user.id),
    });
    res.json({
      accessToken: signAccess(user),
      refreshToken: refresh.token,
      user: { id: user.id, name: matched.FullName, companyId: user.companyId, branchId: user.branchId, perms },
    });
  }),
);

authRouter.post(
  '/refresh',
  h(async (req, res) => {
    const { refreshToken } = parse(z.object({ refreshToken: z.string().min(20).max(200) }), req.body);
    const out = await withTx(async (tx) => {
      const rows = await query<{ Id: number; UserId: number; ExpiresAt: Date; RevokedAt: Date | null }>(
        `SELECT Id, UserId, ExpiresAt, RevokedAt FROM RefreshTokens WITH (UPDLOCK) WHERE TokenHash = @h`,
        { h: sha256(refreshToken) },
        tx,
      );
      const row = rows[0];
      if (!row) throw new HttpError(401, 'INVALID_REFRESH', 'Invalid refresh token');
      if (row.RevokedAt) {
        // A rotated token was presented again: assume theft and revoke every session of that user.
        await query(`UPDATE RefreshTokens SET RevokedAt = SYSUTCDATETIME() WHERE UserId = @u AND RevokedAt IS NULL`, { u: row.UserId }, tx);
        return { reuse: true as const };
      }
      if (row.ExpiresAt.getTime() < Date.now()) throw new HttpError(401, 'INVALID_REFRESH', 'Refresh token expired');
      const users = await query<{ Id: number; CompanyId: number; BranchId: number | null }>(
        `SELECT Id, CompanyId, BranchId FROM Users WHERE Id = @u AND IsActive = 1 AND IsDeleted = 0`,
        { u: row.UserId },
        tx,
      );
      if (!users[0]) throw new HttpError(401, 'INVALID_REFRESH', 'User is inactive');
      const next = await issueRefresh(row.UserId, tx);
      await query(`UPDATE RefreshTokens SET RevokedAt = SYSUTCDATETIME(), ReplacedBy = @n WHERE Id = @i`, { n: next.id, i: row.Id }, tx);
      const perms = await loadPerms(row.UserId, tx);
      const user: AuthUser = { id: users[0].Id, companyId: users[0].CompanyId, branchId: users[0].BranchId, perms };
      return { reuse: false as const, accessToken: signAccess(user), refreshToken: next.token };
    });
    if (out.reuse) throw new HttpError(401, 'REFRESH_REUSE', 'Refresh token was already used; sign in again');
    res.json({ accessToken: out.accessToken, refreshToken: out.refreshToken });
  }),
);

authRouter.post(
  '/logout',
  h(async (req, res) => {
    const { refreshToken } = parse(z.object({ refreshToken: z.string().min(20).max(200) }), req.body);
    await query(`UPDATE RefreshTokens SET RevokedAt = SYSUTCDATETIME() WHERE TokenHash = @h AND RevokedAt IS NULL`, { h: sha256(refreshToken) });
    res.status(204).end();
  }),
);

authRouter.get(
  '/me',
  authenticate,
  h(async (req, res) => {
    const u = req.user!;
    const rows = await query(`SELECT Id, FullName, Email, BranchId FROM Users WHERE Id = @i AND CompanyId = @c`, { i: u.id, c: u.companyId });
    res.json({ ...rows[0], perms: u.perms });
  }),
);

/** Opens a session (access + refresh token) for an already-verified user. */
export async function createSession(userId: number) {
  const rows = await query<{ Id: number; CompanyId: number; BranchId: number | null; FullName: string }>(
    `SELECT Id, CompanyId, BranchId, FullName FROM Users WHERE Id=@u AND IsActive=1 AND IsDeleted=0`,
    { u: userId },
  );
  const u = rows[0];
  if (!u) throw new HttpError(401, 'BAD_CREDENTIALS', 'Account not available');
  const perms = await loadPerms(u.Id);
  const user: AuthUser = { id: u.Id, companyId: u.CompanyId, branchId: u.BranchId, perms };
  const refresh = await withTx((tx) => issueRefresh(user.id, tx));
  return {
    accessToken: signAccess(user),
    refreshToken: refresh.token,
    user: { id: user.id, name: u.FullName, companyId: user.companyId, branchId: user.branchId, perms },
  };
}

const otpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 15, standardHeaders: true, legacyHeaders: false, skip: () => process.env.NODE_ENV === 'test' });
const phoneSchema = z.string().min(9).max(20).transform(normalizeMobile).refine(isSaudiMobile, 'Invalid mobile number');

/** Always answers 200 so the endpoint cannot be used to discover which numbers have accounts. */
authRouter.post(
  '/otp/request',
  otpLimiter,
  h(async (req, res) => {
    const { phone } = parse(z.object({ phone: phoneSchema }), req.body);
    const u = await query(`SELECT TOP 1 Id FROM Users WHERE Phone=@p AND IsActive=1 AND IsDeleted=0`, { p: phone });
    let devCode: string | undefined;
    if (u[0]) {
      try {
        devCode = (await requestOtp(phone, 'login', req.ip ?? null)).devCode;
      } catch (e) {
        if (!(e instanceof HttpError && e.status === 429)) throw e; // do not reveal that the number has an account
      }
    }
    res.json({ sent: true, ...(devCode ? { devCode } : {}) });
  }),
);

authRouter.post(
  '/otp/verify',
  otpLimiter,
  h(async (req, res) => {
    const b = parse(z.object({ phone: phoneSchema, code: z.string().regex(/^\d{6}$/) }), req.body);
    await verifyOtp(b.phone, 'login', b.code);
    const u = (await query<{ Id: number }>(`SELECT TOP 1 Id FROM Users WHERE Phone=@p AND IsActive=1 AND IsDeleted=0`, { p: b.phone }))[0];
    if (!u) throw new HttpError(400, 'OTP_INVALID', 'Invalid or expired code');
    res.json(await createSession(u.Id));
  }),
);
