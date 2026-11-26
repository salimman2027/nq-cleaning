import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { HttpError } from '../errors';
import type { AuthUser } from '../types';

export interface AccessPayload {
  sub: number;
  cid: number;
  bid: number | null;
  perms: string[];
}

export function signAccess(u: AuthUser): string {
  const payload: AccessPayload = { sub: u.id, cid: u.companyId, bid: u.branchId, perms: u.perms };
  return jwt.sign(payload, config.jwt.accessSecret, {
    algorithm: 'HS256',
    expiresIn: config.jwt.accessTtl as jwt.SignOptions['expiresIn'],
  });
}

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return next(new HttpError(401, 'UNAUTHENTICATED', 'Missing access token'));
  try {
    const p = jwt.verify(token, config.jwt.accessSecret, { algorithms: ['HS256'] }) as unknown as AccessPayload;
    req.user = { id: p.sub, companyId: p.cid, branchId: p.bid, perms: p.perms };
    next();
  } catch {
    next(new HttpError(401, 'INVALID_TOKEN', 'Invalid or expired access token'));
  }
}

/** Enforced on the server for every route; hiding buttons in the UI is never relied on. */
export function requirePerm(...codes: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const u = req.user;
    if (!u) return next(new HttpError(401, 'UNAUTHENTICATED', 'Not signed in'));
    const missing = codes.filter((c) => !u.perms.includes(c));
    if (missing.length) return next(new HttpError(403, 'FORBIDDEN', 'Insufficient permissions', { missing }));
    next();
  };
}

/** Branch the user is restricted to, or null when they may see every branch. */
export function branchScope(u: AuthUser): number | null {
  return u.perms.includes('branches.all') ? null : u.branchId;
}
