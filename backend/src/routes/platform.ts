import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { query } from '../db';
import { HttpError, h, parse } from '../errors';
import { invalidateCompanyStatus, requirePerm } from '../auth/middleware';
import { send } from '../services/notify';
import { listDocuments, sendFile } from './company';
import { DOC_KINDS } from '../lib/documents';

export const platformRouter = Router();

const STATUSES = ['draft', 'pending_review', 'approved', 'rejected', 'suspended'] as const;

platformRouter.get(
  '/companies',
  requirePerm('platform.companies.view'),
  h(async (req, res) => {
    const q = parse(z.object({ status: z.enum(STATUSES).optional(), search: z.string().max(100).optional() }), req.query);
    const rows = await query(
      `SELECT c.Id, c.Name, c.Slug, c.Phone, c.Status, c.CrNumber, c.VatNumber, c.SubmittedAt, c.ReviewedAt, c.CreatedAt
         FROM Companies c
        WHERE c.IsDeleted=0 AND c.IsPlatform=0 AND (@st IS NULL OR c.Status=@st)
          AND (@q IS NULL OR c.Name LIKE '%' + @q + '%' OR c.Phone LIKE '%' + @q + '%')
        ORDER BY CASE c.Status WHEN 'pending_review' THEN 0 ELSE 1 END, c.SubmittedAt DESC, c.Id DESC`,
      { st: q.status ?? null, q: q.search ? q.search.replace(/[\\%_\[]/g, '') || null : null },
    );
    res.json({ items: rows });
  }),
);

async function getCompany(id: number) {
  const c = (await query<Record<string, any>>(
    `SELECT Id, Name, Slug, Phone, Status, Description, CrNumber, VatNumber, NationalAddress, SubmittedAt, ReviewedAt, ReviewNote, CreatedAt
       FROM Companies WHERE Id=@i AND IsDeleted=0 AND IsPlatform=0`,
    { i: id },
  ))[0];
  if (!c) throw new HttpError(404, 'NOT_FOUND', 'Company not found');
  return c;
}

platformRouter.get(
  '/companies/:id',
  requirePerm('platform.companies.view'),
  h(async (req, res) => {
    const id = parse(z.coerce.number().int().positive(), req.params.id);
    const c = await getCompany(id);
    const owner = (await query(`SELECT TOP 1 u.FullName, u.Email, u.Phone FROM Users u JOIN UserRoles ur ON ur.UserId=u.Id JOIN Roles r ON r.Id=ur.RoleId WHERE u.CompanyId=@c AND r.Name='Company Owner' ORDER BY u.Id`, { c: id }))[0] ?? null;
    const sectors = await query(`SELECT s.Code, s.NameAr, s.NameEn FROM CompanySectors cs JOIN Sectors s ON s.Id=cs.SectorId WHERE cs.CompanyId=@c`, { c: id });
    const address = c.NationalAddress ? JSON.parse(c.NationalAddress) : null;
    const documents = await listDocuments(id, { crNumber: c.CrNumber, vatNumber: c.VatNumber, nationalAddress: address });
    res.json({ ...c, NationalAddress: address, owner, sectors, documents });
  }),
);

platformRouter.get(
  '/companies/:id/documents/:kind/file',
  requirePerm('platform.companies.view'),
  h(async (req, res) => {
    const id = parse(z.coerce.number().int().positive(), req.params.id);
    const kind = parse(z.enum(DOC_KINDS), req.params.kind);
    await getCompany(id);
    const d = (await query<Record<string, any>>(`SELECT TOP 1 FileName, MimeType, Data FROM CompanyDocuments WHERE CompanyId=@c AND Kind=@k AND IsCurrent=1`, { c: id, k: kind }))[0];
    if (!d) throw new HttpError(404, 'NOT_FOUND', 'Document not found');
    await query(`INSERT INTO AuditLogs (CompanyId, UserId, Action, Entity, EntityId) VALUES (@c,@u,'company.document.view','Company',@e)`, { c: req.user!.companyId, u: req.user!.id, e: `${id}:${kind}` });
    sendFile(res, d);
  }),
);

async function transition(req: import('express').Request, to: 'approved' | 'rejected' | 'suspended', from: string[], reason: string | null, action: string) {
  const id = parse(z.coerce.number().int().positive(), req.params.id);
  const c = await getCompany(id);
  if (!from.includes(c.Status)) throw new HttpError(409, 'BAD_STATE', `Cannot change a company that is ${c.Status}`);
  await query(
    `UPDATE Companies SET Status=@s, ReviewedAt=SYSUTCDATETIME(), ReviewedBy=@u, ReviewNote=@n WHERE Id=@i AND Status=@old`,
    { s: to, u: req.user!.id, n: reason, i: id, old: c.Status },
  );
  await query(`INSERT INTO AuditLogs (CompanyId, UserId, Action, Entity, EntityId, Details) VALUES (@c,@u,@a,'Company',@e,@d)`, {
    c: req.user!.companyId, u: req.user!.id, a: action, e: String(id), d: reason,
  });
  invalidateCompanyStatus(id);
  return c;
}

/** Notification failures must not undo a review decision; they are logged and reported to the caller. */
async function tell(phone: string | null, template: 'company_approved' | 'company_rejected', params: string[], companyId: number): Promise<boolean> {
  if (!phone) return false;
  try {
    await send(phone, template, params, companyId);
    return true;
  } catch {
    return false;
  }
}

platformRouter.post(
  '/companies/:id/approve',
  requirePerm('platform.companies.review'),
  h(async (req, res) => {
    const c = await transition(req, 'approved', ['pending_review'], null, 'company.approve');
    const link = `${config.appUrl}/login`;
    const notified = await tell(c.Phone, 'company_approved', [c.Name, link], c.Id);
    res.json({ status: 'approved', notified, dashboardUrl: link });
  }),
);

platformRouter.post(
  '/companies/:id/reject',
  requirePerm('platform.companies.review'),
  h(async (req, res) => {
    const { reason } = parse(z.object({ reason: z.string().trim().min(5).max(500) }), req.body);
    const c = await transition(req, 'rejected', ['pending_review'], reason, 'company.reject');
    const notified = await tell(c.Phone, 'company_rejected', [c.Name, reason], c.Id);
    res.json({ status: 'rejected', notified });
  }),
);

platformRouter.post(
  '/companies/:id/suspend',
  requirePerm('platform.companies.review'),
  h(async (req, res) => {
    const { reason } = parse(z.object({ reason: z.string().trim().min(5).max(500) }), req.body);
    await transition(req, 'suspended', ['approved'], reason, 'company.suspend');
    res.json({ status: 'suspended' });
  }),
);

platformRouter.post(
  '/companies/:id/reactivate',
  requirePerm('platform.companies.review'),
  h(async (req, res) => {
    await transition(req, 'approved', ['suspended'], null, 'company.reactivate');
    res.json({ status: 'approved' });
  }),
);

const sectorSchema = z.object({
  code: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
  nameAr: z.string().trim().min(2).max(100),
  nameEn: z.string().trim().min(2).max(100),
  sortOrder: z.number().int().min(0).max(1000).default(0),
  isActive: z.boolean().default(true),
});

platformRouter.get('/sectors', requirePerm('platform.companies.view'), h(async (_req, res) => {
  res.json({ items: await query(`SELECT Id, Code, NameAr, NameEn, SortOrder, IsActive FROM Sectors ORDER BY SortOrder, Id`) });
}));

platformRouter.post('/sectors', requirePerm('platform.sectors.manage'), h(async (req, res) => {
  const b = parse(sectorSchema, req.body);
  const r = await query<{ Id: number }>(`INSERT INTO Sectors (Code, NameAr, NameEn, SortOrder, IsActive) OUTPUT INSERTED.Id VALUES (@c,@a,@e,@s,@i)`, {
    c: b.code, a: b.nameAr, e: b.nameEn, s: b.sortOrder, i: b.isActive ? 1 : 0,
  });
  res.status(201).json({ id: Number(r[0].Id) });
}));

platformRouter.put('/sectors/:id', requirePerm('platform.sectors.manage'), h(async (req, res) => {
  const id = parse(z.coerce.number().int().positive(), req.params.id);
  const b = parse(sectorSchema.omit({ code: true }), req.body);
  const r = await query(`UPDATE Sectors SET NameAr=@a, NameEn=@e, SortOrder=@s, IsActive=@i OUTPUT INSERTED.Id WHERE Id=@id`, {
    a: b.nameAr, e: b.nameEn, s: b.sortOrder, i: b.isActive ? 1 : 0, id,
  });
  if (!r.length) throw new HttpError(404, 'NOT_FOUND', 'Sector not found');
  res.json({ id });
}));

/** Platform branding (logo shown on the public site). Stored as a setting of the platform company. */
platformRouter.get('/brand', requirePerm('platform.companies.view'), h(async (_req, res) => {
  const r = await query<{ Value: string }>(`SELECT s.Value FROM SystemSettings s JOIN Companies c ON c.Id=s.CompanyId WHERE c.IsPlatform=1 AND s.[Key]='brand.logoUrl'`);
  res.json({ logoUrl: r[0]?.Value ?? null });
}));

platformRouter.put('/brand', requirePerm('platform.brand.manage'), h(async (req, res) => {
  const b = parse(z.object({ logoUrl: z.string().url().max(500).refine((u) => u.startsWith('https://'), 'https only').nullable() }), req.body);
  const co = (await query<{ Id: number }>(`SELECT TOP 1 Id FROM Companies WHERE IsPlatform=1`))[0];
  if (!co) throw new HttpError(404, 'NOT_FOUND', 'Platform company not found');
  if (b.logoUrl) {
    await query(
      `MERGE SystemSettings AS t USING (SELECT @c AS CompanyId, 'brand.logoUrl' AS [Key]) AS s ON t.CompanyId=s.CompanyId AND t.[Key]=s.[Key]
       WHEN MATCHED THEN UPDATE SET Value=@v WHEN NOT MATCHED THEN INSERT (CompanyId,[Key],Value) VALUES (@c,'brand.logoUrl',@v);`,
      { c: co.Id, v: b.logoUrl },
    );
  } else {
    await query(`DELETE FROM SystemSettings WHERE CompanyId=@c AND [Key]='brand.logoUrl'`, { c: co.Id });
  }
  res.json({ logoUrl: b.logoUrl });
}));
