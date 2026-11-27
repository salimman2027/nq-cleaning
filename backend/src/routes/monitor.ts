import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db';
import { HttpError, h, parse } from '../errors';
import { requirePerm } from '../auth/middleware';

/** Platform monitoring: per-company activity by period and customer complaints. Local time is Asia/Riyadh (UTC+3, no DST). */
export const monitorRouter = Router();

const DAYS = { day: 0, week: 6, month: 29 } as const;
const LOCAL = (col: string) => `CAST(DATEADD(hour,3,${col}) AS DATE)`;

monitorRouter.get('/monitor', requirePerm('platform.companies.view'), h(async (req, res) => {
  const { period } = parse(z.object({ period: z.enum(['day', 'week', 'month']).default('week') }), req.query);
  const n = DAYS[period];
  const p = { n };
  const since = `DATEADD(day,-@n,CAST(DATEADD(hour,3,SYSUTCDATETIME()) AS DATE))`;
  const companies = await query<Record<string, any>>(
    `SELECT c.Id, c.Name, c.Slug, c.Status, c.ReviewNote,
       (SELECT COUNT(*) FROM BookingRequests r WHERE r.CompanyId=c.Id AND ${LOCAL('r.CreatedAt')} >= ${since}) AS Requests,
       (SELECT COUNT(*) FROM BookingRequests r WHERE r.CompanyId=c.Id AND r.Status='confirmed' AND ${LOCAL('r.CreatedAt')} >= ${since}) AS Confirmed,
       (SELECT COUNT(*) FROM BookingRequests r WHERE r.CompanyId=c.Id AND r.Status='cancelled' AND ${LOCAL('r.CreatedAt')} >= ${since}) AS Cancelled,
       (SELECT COUNT(*) FROM BookingRequests r WHERE r.CompanyId=c.Id AND r.Status='new' AND ${LOCAL('r.CreatedAt')} >= ${since}) AS Waiting,
       (SELECT ISNULL(SUM(r.Total),0) FROM BookingRequests r WHERE r.CompanyId=c.Id AND r.Status<>'cancelled' AND ${LOCAL('r.CreatedAt')} >= ${since}) AS Value,
       (SELECT ISNULL(SUM(r.Total),0) FROM BookingRequests r WHERE r.CompanyId=c.Id AND r.PaymentStatus='paid' AND ${LOCAL('r.CreatedAt')} >= ${since}) AS Collected,
       (SELECT COUNT(*) FROM Bookings b WHERE b.CompanyId=c.Id AND b.IsDeleted=0 AND ${LOCAL('b.CreatedAt')} >= ${since}) AS Bookings,
       (SELECT COUNT(*) FROM Complaints k WHERE k.CompanyId=c.Id AND k.Status<>'resolved') AS OpenComplaints,
       (SELECT COUNT(*) FROM Complaints k WHERE k.CompanyId=c.Id AND ${LOCAL('k.CreatedAt')} >= ${since}) AS Complaints
     FROM Companies c WHERE c.IsPlatform=0 AND c.Status IN ('approved','suspended')
     ORDER BY Requests DESC, c.Name`, p);
  const series = await query<{ D: string; N: number }>(
    `SELECT CONVERT(varchar(10), ${LOCAL('CreatedAt')}, 23) AS D, COUNT(*) AS N FROM BookingRequests
     WHERE ${LOCAL('CreatedAt')} >= ${since} GROUP BY ${LOCAL('CreatedAt')} ORDER BY 1`, p);
  const t = (k: string) => companies.reduce((a, c) => a + Number(c[k] ?? 0), 0);
  res.json({
    period,
    totals: { companies: companies.length, requests: t('Requests'), bookings: t('Bookings'), value: t('Value'), collected: t('Collected'), complaints: t('Complaints'), openComplaints: t('OpenComplaints') },
    series: series.map((s) => ({ date: s.D, count: Number(s.N) })),
    companies,
  });
}));

monitorRouter.get('/complaints', requirePerm('platform.companies.view'), h(async (req, res) => {
  const q = parse(z.object({ status: z.enum(['open', 'in_review', 'resolved']).optional(), companyId: z.coerce.number().int().positive().optional() }), req.query);
  const rows = await query(
    `SELECT TOP 200 k.Id, k.CompanyId, c.Name AS CompanyName, k.RequestId, k.CustomerName, k.Phone, k.Message, k.Status, k.PlatformNote, k.HandledAt, k.CreatedAt
     FROM Complaints k JOIN Companies c ON c.Id=k.CompanyId
     WHERE (@s IS NULL OR k.Status=@s) AND (@c IS NULL OR k.CompanyId=@c)
     ORDER BY CASE k.Status WHEN 'open' THEN 0 WHEN 'in_review' THEN 1 ELSE 2 END, k.CreatedAt DESC`, { s: q.status ?? null, c: q.companyId ?? null });
  res.json({ items: rows });
}));

monitorRouter.patch('/complaints/:id', requirePerm('platform.companies.review'), h(async (req, res) => {
  const id = parse(z.coerce.number().int().positive(), req.params.id);
  const b = parse(z.object({ status: z.enum(['open', 'in_review', 'resolved']), note: z.string().trim().max(500).optional() }), req.body);
  const r = await query(`UPDATE Complaints SET Status=@s, PlatformNote=COALESCE(@n, PlatformNote), HandledBy=@u, HandledAt=SYSUTCDATETIME() OUTPUT INSERTED.Id WHERE Id=@i`, { s: b.status, n: b.note ?? null, u: req.user!.id, i: id });
  if (!r.length) throw new HttpError(404, 'NOT_FOUND', 'Complaint not found');
  await query(`INSERT INTO AuditLogs (CompanyId, UserId, Action, Entity, EntityId, Details) VALUES (@c,@u,'complaint.update','Complaint',@e,@d)`, { c: req.user!.companyId, u: req.user!.id, e: String(id), d: b.status });
  res.json({ id, status: b.status });
}));
