import { Router } from 'express';
import { z } from 'zod';
import { query, withTx } from '../db';
import { HttpError, h, parse } from '../errors';
import { requirePerm, invalidateCompanyStatus } from '../auth/middleware';
import { CR_RE, SLUG_RE, imageRef, VAT_RE, missingForReview, nationalAddressSchema } from '../lib/company';
import { isCity } from '../lib/areas';
import { DOC_KINDS, MAX_DOC_BYTES, isCompleteAddress, mismatches, safeFileName, sniffMime, type DocKind, type Extracted } from '../lib/documents';
import { extractFromFile, extractionEnabled } from '../services/extract';

export function sendFile(res: import('express').Response, d: Record<string, any>): void {
  res.setHeader('Content-Type', d.MimeType);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(d.FileName)}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(d.Data);
}

export const companyRouter = Router();
companyRouter.use(requirePerm('company.profile.manage'));

export async function listDocuments(companyId: number, entered: { crNumber?: string | null; vatNumber?: string | null; nationalAddress?: unknown }) {
  const rows = await query<Record<string, any>>(
    `SELECT Id, Kind, FileName, MimeType, SizeBytes, Extracted, ExtractStatus, UploadedAt FROM CompanyDocuments WHERE CompanyId=@c AND IsCurrent=1`,
    { c: companyId },
  );
  return rows.map((d) => {
    const extracted: Extracted | null = d.Extracted ? JSON.parse(d.Extracted) : null;
    return { id: d.Id, kind: d.Kind as DocKind, fileName: d.FileName, mimeType: d.MimeType, sizeBytes: d.SizeBytes, uploadedAt: d.UploadedAt, extractStatus: d.ExtractStatus, extracted, mismatch: mismatches(extracted, entered) };
  });
}

async function loadProfile(companyId: number) {
  const c = (await query<Record<string, any>>(
    `SELECT Id, Name, Slug, Phone, Status, Description, LogoUrl, CoverUrl, WhatsApp, PrimaryColor, CrNumber, VatNumber, NationalAddress, SubmittedAt, ReviewedAt, ReviewNote
       FROM Companies WHERE Id=@c AND IsDeleted=0`,
    { c: companyId },
  ))[0];
  if (!c) throw new HttpError(404, 'NOT_FOUND', 'Company not found');
  const sectors = await query<{ Code: string }>(`SELECT s.Code FROM CompanySectors cs JOIN Sectors s ON s.Id=cs.SectorId WHERE cs.CompanyId=@c`, { c: companyId });
  const address = c.NationalAddress ? JSON.parse(c.NationalAddress) : null;
  const documents = await listDocuments(companyId, { crNumber: c.CrNumber, vatNumber: c.VatNumber, nationalAddress: address });
  const areaCount = (await query<{ N: number }>(`SELECT COUNT(DISTINCT City) AS N FROM CompanyAreas WHERE CompanyId=@c`, { c: companyId }))[0].N;
  const missingDocs = DOC_KINDS.filter((k) => !documents.some((d) => d.kind === k));
  return {
    documents, extractionEnabled: extractionEnabled(),
    id: c.Id, name: c.Name, slug: c.Slug, phone: c.Phone, status: c.Status, description: c.Description, logoUrl: c.LogoUrl, coverUrl: c.CoverUrl, whatsapp: c.WhatsApp,
    primaryColor: c.PrimaryColor, crNumber: c.CrNumber, vatNumber: c.VatNumber, nationalAddress: address,
    submittedAt: c.SubmittedAt, reviewedAt: c.ReviewedAt, reviewNote: c.Status === 'rejected' || c.Status === 'suspended' ? c.ReviewNote : null,
    sectorCodes: sectors.map((s) => s.Code),
    missing: [...missingForReview({ name: c.Name, crNumber: c.CrNumber, vatNumber: c.VatNumber, nationalAddress: address, sectorCount: sectors.length }), ...(areaCount ? [] : ['areas']), ...missingDocs.map((k) => `doc:${k}`)],
  };
}

companyRouter.get('/', h(async (req, res) => res.json(await loadProfile(req.user!.companyId))));

const updateSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  slug: z.string().regex(SLUG_RE).optional(),
  description: z.string().max(1000).nullable().optional(),
  logoUrl: imageRef,
  coverUrl: imageRef,
  whatsapp: z.string().regex(/^05\d{8}$/).nullable().optional(),
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
           WhatsApp = CASE WHEN @hasWa = 1 THEN @wa ELSE WhatsApp END,
           CoverUrl = CASE WHEN @hasCover = 1 THEN @cover ELSE CoverUrl END,
           PrimaryColor = CASE WHEN @hasColor = 1 THEN @color ELSE PrimaryColor END,
           CrNumber = COALESCE(@cr, CrNumber), VatNumber = COALESCE(@vat, VatNumber),
           NationalAddress = COALESCE(@addr, NationalAddress)
         WHERE Id=@c`,
        {
          c: cid, name: b.name ?? null, slug: b.slug ?? null,
          hasDesc: b.description !== undefined ? 1 : 0, desc: b.description ?? null,
          hasLogo: b.logoUrl !== undefined ? 1 : 0, logo: b.logoUrl ?? null,
          hasWa: b.whatsapp !== undefined ? 1 : 0, wa: b.whatsapp ?? null,
          hasCover: b.coverUrl !== undefined ? 1 : 0, cover: b.coverUrl ?? null,
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

const uploadSchema = z.object({ fileName: z.string().min(1).max(200), dataBase64: z.string().min(4) });

/** Upload (or replace) one official document. Values read from the file are returned as suggestions only. */
companyRouter.put(
  '/documents/:kind',
  h(async (req, res) => {
    const kind = parse(z.enum(DOC_KINDS), req.params.kind);
    const b = parse(uploadSchema, req.body);
    const cid = req.user!.companyId;
    const cur = await loadProfile(cid);
    if (cur.status !== 'draft' && cur.status !== 'rejected') throw new HttpError(409, 'COMPANY_LOCKED', `Documents cannot be changed while ${cur.status}`);
    const data = Buffer.from(b.dataBase64.replace(/^data:[^,]*,/, ''), 'base64');
    if (data.length === 0) throw new HttpError(400, 'EMPTY_FILE', 'File is empty');
    if (data.length > MAX_DOC_BYTES) throw new HttpError(413, 'FILE_TOO_LARGE', 'File must be 5 MB or smaller');
    const mime = sniffMime(data);
    if (!mime) throw new HttpError(415, 'UNSUPPORTED_FILE', 'Only PDF, PNG, JPG or WEBP files are accepted');
    const ex = await extractFromFile(kind, mime, data);
    await withTx(async (tx) => {
      await query(`UPDATE CompanyDocuments SET IsCurrent=0 WHERE CompanyId=@c AND Kind=@k AND IsCurrent=1`, { c: cid, k: kind }, tx);
      await query(
        `INSERT INTO CompanyDocuments (CompanyId, Kind, FileName, MimeType, SizeBytes, Data, Extracted, ExtractStatus, UploadedBy)
         VALUES (@c,@k,@n,@m,@s,@d,@x,@st,@u)`,
        { c: cid, k: kind, n: safeFileName(b.fileName), m: mime, s: data.length, d: data, x: Object.keys(ex.values).length ? JSON.stringify(ex.values) : null, st: ex.status, u: req.user!.id },
        tx,
      );
    });
    // Fill empty legal fields from what the file says; anything the owner already typed is never overwritten.
    const v = ex.values;
    const dupCr = v.crNumber ? (await query(`SELECT TOP 1 1 AS x FROM Companies WHERE CrNumber=@v AND Id<>@c AND IsDeleted=0`, { v: v.crNumber, c: cid })).length > 0 : true;
    await query(
      `UPDATE Companies SET CrNumber = CASE WHEN CrNumber IS NULL AND @cr IS NOT NULL THEN @cr ELSE CrNumber END,
                            VatNumber = CASE WHEN VatNumber IS NULL AND @vat IS NOT NULL THEN @vat ELSE VatNumber END,
                            NationalAddress = CASE WHEN NationalAddress IS NULL AND @addr IS NOT NULL THEN @addr ELSE NationalAddress END
        WHERE Id=@c`,
      { c: cid, cr: dupCr ? null : v.crNumber ?? null, vat: v.vatNumber ?? null, addr: isCompleteAddress(v.nationalAddress) ? JSON.stringify(v.nationalAddress) : null },
    );
    res.json(await loadProfile(cid));
  }),
);

companyRouter.get(
  '/documents/:kind/file',
  h(async (req, res) => {
    const kind = parse(z.enum(DOC_KINDS), req.params.kind);
    const d = (await query<Record<string, any>>(`SELECT TOP 1 FileName, MimeType, Data FROM CompanyDocuments WHERE CompanyId=@c AND Kind=@k AND IsCurrent=1`, { c: req.user!.companyId, k: kind }))[0];
    if (!d) throw new HttpError(404, 'NOT_FOUND', 'Document not found');
    sendFile(res, d);
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

/** Service areas: cities (and optionally districts inside them) this company works in. */
export async function loadAreas(companyId: number): Promise<{ city: string; districts: string[] }[]> {
  const rows = await query<{ City: string; District: string | null }>(`SELECT City, District FROM CompanyAreas WHERE CompanyId=@c ORDER BY City, District`, { c: companyId });
  const map = new Map<string, string[]>();
  for (const r of rows) { if (!map.has(r.City)) map.set(r.City, []); if (r.District) map.get(r.City)!.push(r.District); }
  return [...map.entries()].map(([city, districts]) => ({ city, districts }));
}

companyRouter.get('/areas', h(async (req, res) => res.json({ areas: await loadAreas(req.user!.companyId) })));

companyRouter.put('/areas', requirePerm('company.profile.manage'), h(async (req, res) => {
  const { areas } = parse(z.object({ areas: z.array(z.object({ city: z.string().trim().max(60), districts: z.array(z.string().trim().min(2).max(80)).max(200) })).max(40) }), req.body);
  for (const a of areas) if (!isCity(a.city)) throw new HttpError(400, 'UNKNOWN_CITY', `Unknown city: ${a.city}`);
  const cur = (await query<{ Status: string }>(`SELECT Status FROM Companies WHERE Id=@c`, { c: req.user!.companyId }))[0];
  if (cur?.Status === 'suspended') throw new HttpError(409, 'COMPANY_LOCKED', 'Company is suspended');
  await withTx(async (tx) => {
    await query(`DELETE FROM CompanyAreas WHERE CompanyId=@c`, { c: req.user!.companyId }, tx);
    for (const a of areas) {
      const ds = [...new Set(a.districts)];
      if (ds.length === 0) await query(`INSERT INTO CompanyAreas (CompanyId, City, District) VALUES (@c,@y,NULL)`, { c: req.user!.companyId, y: a.city }, tx);
      for (const d of ds) await query(`INSERT INTO CompanyAreas (CompanyId, City, District) VALUES (@c,@y,@d)`, { c: req.user!.companyId, y: a.city, d }, tx);
    }
  });
  res.json({ areas: await loadAreas(req.user!.companyId) });
}));
