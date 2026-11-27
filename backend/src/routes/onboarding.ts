import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { query, withTx } from '../db';
import { HttpError, h, parse } from '../errors';
import { isSaudiMobile } from '../lib/otp';
import { normalizeMobile } from '../lib/phone';
import { newSlug } from '../lib/company';
import { requestOtp, verifyOtp } from '../services/otp';
import { ensureRoles } from '../services/tenancy';
import { createSession } from './auth';

export const onboardingRouter = Router();

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 15, standardHeaders: true, legacyHeaders: false, skip: () => process.env.NODE_ENV === 'test' });
const phoneSchema = z.string().min(9).max(20).transform(normalizeMobile).refine(isSaudiMobile, 'Invalid mobile number');

async function assertFree(phone: string, email?: string): Promise<void> {
  const p = await query(
    `SELECT TOP 1 1 AS x FROM Users WHERE Phone=@p AND IsDeleted=0 UNION ALL SELECT TOP 1 1 FROM Companies WHERE Phone=@p AND IsDeleted=0`,
    { p: phone },
  );
  if (p.length) throw new HttpError(409, 'PHONE_TAKEN', 'This mobile number is already registered');
  if (email) {
    const e = await query(`SELECT TOP 1 1 AS x FROM Users WHERE Email=@e AND IsDeleted=0`, { e: email });
    if (e.length) throw new HttpError(409, 'EMAIL_TAKEN', 'This e-mail is already registered');
  }
}

onboardingRouter.post(
  '/otp/request',
  limiter,
  h(async (req, res) => {
    const { phone } = parse(z.object({ phone: phoneSchema }), req.body);
    await assertFree(phone);
    const out = await requestOtp(phone, 'company_register', req.ip ?? null);
    res.json({ sent: true, ...out });
  }),
);

onboardingRouter.post(
  '/register',
  limiter,
  h(async (req, res) => {
    const b = parse(
      z.object({
        phone: phoneSchema,
        code: z.string().regex(/^\d{6}$/),
        companyName: z.string().trim().min(2).max(200),
        ownerName: z.string().trim().min(2).max(200),
        email: z.string().email().max(256).transform((s) => s.toLowerCase()),
        password: z.string().min(10).max(200),
        sectorCodes: z.array(z.string().max(40)).min(1).max(3),
      }),
      req.body,
    );
    await assertFree(b.phone, b.email);
    const sectors = await query<{ Id: number }>(
      `SELECT Id FROM Sectors WHERE IsActive=1 AND Code IN (SELECT value FROM STRING_SPLIT(@codes, ','))`,
      { codes: b.sectorCodes.join(',') },
    );
    if (sectors.length !== new Set(b.sectorCodes).size) throw new HttpError(400, 'UNKNOWN_SECTOR', 'Unknown sector');

    await verifyOtp(b.phone, 'company_register', b.code);

    const hash = await bcrypt.hash(b.password, 12);
    const ownerId = await withTx(async (tx) => {
      const co = (await query<{ Id: number }>(
        `INSERT INTO Companies (Name, Slug, Phone, Status) OUTPUT INSERTED.Id VALUES (@n, @s, @p, 'draft')`,
        { n: b.companyName, s: newSlug(randomBytes(4).toString('hex')), p: b.phone },
        tx,
      ))[0];
      const companyId = Number(co.Id);
      await query(`INSERT INTO Branches (CompanyId, Name) VALUES (@c, N'Main')`, { c: companyId }, tx);
      await ensureRoles(tx, companyId);
      for (const s of sectors) await query(`INSERT INTO CompanySectors (CompanyId, SectorId) VALUES (@c,@s)`, { c: companyId, s: s.Id }, tx);
      const u = (await query<{ Id: number }>(
        `INSERT INTO Users (CompanyId, FullName, Email, PasswordHash, Phone) OUTPUT INSERTED.Id VALUES (@c,@n,@e,@h,@p)`,
        { c: companyId, n: b.ownerName, e: b.email, h: hash, p: b.phone },
        tx,
      ))[0];
      await query(`INSERT INTO UserRoles (UserId, RoleId) SELECT @u, Id FROM Roles WHERE CompanyId=@c AND Name='Company Owner'`, { u: u.Id, c: companyId }, tx);
      await query(`INSERT INTO AuditLogs (CompanyId, UserId, Action, Entity, EntityId) VALUES (@c,@u,'company.register','Company',@e)`, { c: companyId, u: u.Id, e: String(companyId) }, tx);
      return Number(u.Id);
    });
    res.status(201).json(await createSession(ownerId));
  }),
);
