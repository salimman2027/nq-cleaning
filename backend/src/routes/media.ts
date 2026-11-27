import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db';
import { HttpError, h, parse } from '../errors';
import { authenticate } from '../auth/middleware';
import { sniffMime } from '../lib/documents';

export const mediaRouter = Router();
const MAX = 2 * 1024 * 1024;

/** Public: images are shown on public storefronts. Served inert (no sniffing, no script, sandboxed). */
mediaRouter.get('/:id', h(async (req, res) => {
  const id = parse(z.coerce.number().int().positive(), req.params.id);
  const m = (await query<Record<string, any>>(`SELECT MimeType, Data FROM MediaFiles WHERE Id=@i`, { i: id }))[0];
  if (!m) throw new HttpError(404, 'NOT_FOUND', 'Image not found');
  res.setHeader('Content-Type', m.MimeType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(m.Data);
}));

mediaRouter.post('/', authenticate, h(async (req, res) => {
  const u = req.user!;
  if (!u.perms.includes('company.profile.manage') && !u.perms.includes('services.manage')) throw new HttpError(403, 'FORBIDDEN', 'Insufficient permissions');
  const { dataBase64 } = parse(z.object({ dataBase64: z.string().min(4) }), req.body);
  const data = Buffer.from(dataBase64.replace(/^data:[^,]*,/, ''), 'base64');
  if (data.length > MAX) throw new HttpError(413, 'FILE_TOO_LARGE', 'Image must be 2 MB or smaller');
  const mime = sniffMime(data);
  if (!mime || mime === 'application/pdf') throw new HttpError(415, 'UNSUPPORTED_FILE', 'Only PNG, JPG or WEBP images are accepted');
  const r = await query<{ Id: number }>(`INSERT INTO MediaFiles (CompanyId, MimeType, SizeBytes, Data) OUTPUT inserted.Id VALUES (@c,@m,@s,@d)`, { c: u.companyId, m: mime, s: data.length, d: data });
  res.status(201).json({ url: `/api/media/${r[0].Id}` });
}));
