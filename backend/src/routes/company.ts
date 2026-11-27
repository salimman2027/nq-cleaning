import { Router } from 'express';
import { z } from 'zod';
import { query, withTx } from '../db';
import { HttpError, h, parse } from '../errors';
import { requirePerm, invalidateCompanyStatus } from '../auth/middleware';
import { CR_RE, SLUG_RE, VAT_RE, missingForReview, nationalAddressSchema } from '../lib/company';

export const companyRouter = Router();
companyRouter.use(requirePerm('company.profile.manage'));

async function loadProfile(companyId: number) {
  const c = (await query<Record<string, any>>(
    `SELECT Id, Name, Slug, Phone, Status, Description, LogoUrl, PrimaryColor, CrNumber, VatNumber, NationalAddress, SubmittedAt, ReviewedAt, ReviewNote
       FROM Companies WHERE Id=@c AND IsDeleted=0`,
    { c: companyId },
  ))[0];
  if (!c) throw new HttpError(404, 'NOT_FOUND', 'Company not found');
  const sectors = await query<{ Code: string }>(`SELECT s.Code FROM CompanySectors cs JOIN Sectors s ON s.Id=cs.SectorId WHERE cs.CompanyId=@c`, { c: companyId });
  const address = c.NationalAddress ? JSON.parse(c.NationalAddress) : null;
  return {
    id: c.Id, name: c.Name, slug: c.Slug, phone: c.Phone, status: c.Status, description: c.Description, logoUrl: c.LogoUrl,
    primaryColor: c.PrimaryColor, crNumber: c.CrNumber, vatNumber: c.VatNumber, nationalAddress: address,
    submittedAt: c.SubmittedAt, reviewedAt: c.ReviewedAt, reviewNote: c.Status === 'rejected' ? c.ReviewNote : null,
    sectorCodes: sectors.map((s) => s.Code),
    missing: missingForReview({ name: c.Name, crNumber: c.CrNumber, vatNumber: c.VatNumber, nationalAddress: address, sectorCount: sectors.length }),
  };
}

companyRouter.get('/', h(async (req, res) => res.json(await loadProfile(req.user!.companyId))));

const updateSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  slug: z.string().regex(SLUG_RE).optional(),
  description: z.string().max(1000).nullable().optional(),
  logoUrl: z.string().url().max(500).refine((u) => u.startsWith('https://'), 'https only').nullable().optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  crNumber: z.string().regex(CR_RE).optional(),
  vatNumber: z.string().regex(VAT_RE).optional(),
  nationalAddress: nationalAddressSchema.optional(),
  sectorCodes: z.array(z.string().max(40)).min(1).max(3).optional(),
});

companyRouter.put(
  '/',
  h(async (req, res) => {
    const b = parse(updateSchema, req.body);
    const cid = req.user!.companyId;
    const cur = await loadProfile(cid);
    if (cur.status === 'suspended' || cur.status === 'pending_review') throw new HttpError(409, 'COMPANY_LOCKED', `Profile cannot be edited while ${cur.status}`);
    if (cur.status === 'approved') {
      const legalChanged =
        (b.crNumber !== undefined && b.crNumber !== cur.crNumber) ||
        (b.vatNumber !== undefined && b.vatNumber !== cur.vatNumber) ||
        (b.nationalAddress !== undefined && JSON.stringify(b.nationalAddress) !== JSON.stringify(cur.nationalAddress));
      if (legalChanged) throw new HttpError(409, 'LEGAL_FIELDS_LOCKED', 'Legal details cannot be changed after approval; contact the platform');
    }
    if (b.crNumber) {
      const dup = await query(`SELECT TOP 1 1 AS x FROM Companies WHERE CrNumber=@v AND Id<>@c AND IsDeleted=0`, { v: b.crNumber, c: cid });
      if (dup.length) throw new HttpError(409, 'CR_TAKEN', 'This commercial registration is already used');
    }
    let sectorIds: number[] | null = null;
    if (b.sectorCodes) {
      const rows = await query<{ Id: number }>(`SELECT Id FROM Sectors WHERE IsActive=1 AND Code IN (SELECT value FROM STRING_SPLIT(@codes, ','))`, { codes: b.sectorCodes.join(',') });
      if (rows.length !== new Set(b.sectorCodes).size) throw new HttpError(400, 'UNKNOWN_SECTOR', 'Unknown sector');
      sectorIds = rows.map((r) => Number(r.Id));
    }
    await withTx(async (tx) => {
      await query(
        `UPDATE Companies SET
           Name = COALESCE(@name, Name), Slug = COALESCE(@slug, Slug),
           Description = CASE WHEN @hasDesc = 1 THEN @desc ELSE Description END,
           LogoUrl = CASE WHEN @hasLogo = 1 THEN @logo ELSE LogoUrl END,
           PrimaryColor = CASE WHEN @hasColor = 1 THEN @color ELSE PrimaryColor END,
           CrNumber = COALESCE(@cr, CrNumber), VatNumber = COALESCE(@vat, VatNumber),
           NationalAddress = COALESCE(@addr, NationalAddress)
         WHERE Id=@c`,
        {
          c: cid, name: b.name ?? null, slug: b.slug ?? null,
          hasDesc: b.description !== undefined ? 1 : 0, desc: b.description ?? null,
          hasLogo: b.logoUrl !== undefined ? 1 : 0, logo: b.logoUrl ?? null,
          hasColor: b.primaryColor !== undefined ? 1 : 0, color: b.primaryColor ?? null,
          cr: b.crNumber ?? null, vat: b.vatNumber ?? null, addr: b.nationalAddress ? JSON.stringify(b.nationalAddress) : null,
        },
        tx,
      );
      if (sectorIds) {
        await query(`DELETE FROM CompanySectors WHERE CompanyId=@c`, { c: cid }, tx);
        for (const s of sectorIds) await query(`INSERT INTO CompanySectors (CompanyId, SectorId) VALUES (@c,@s)`, { c: cid, s }, tx);
      }
    });
    res.json(await loadProfile(cid));
  }),
);

companyRouter.post(
  '/submit',
  h(async (req, res) => {
    const cid = req.user!.companyId;
    const p = await loadProfile(cid);
    if (p.status !== 'draft' && p.status !== 'rejected') throw new HttpError(409, 'BAD_STATE', `Cannot submit a company that is ${p.status}`);
    if (p.missing.length) throw new HttpError(409, 'INCOMPLETE', 'Profile is incomplete', { missing: p.missing });
    await query(`UPDATE Companies SET Status='pending_review', SubmittedAt=SYSUTCDATETIME(), ReviewNote=NULL WHERE Id=@c AND Status IN ('draft','rejected')`, { c: cid });
    await query(`INSERT INTO AuditLogs (CompanyId, UserId, Action, Entity, EntityId) VALUES (@c,@u,'company.submit','Company',@e)`, { c: cid, u: req.user!.id, e: String(cid) });
    invalidateCompanyStatus(cid);
    res.json(await loadProfile(cid));
  }),
);
