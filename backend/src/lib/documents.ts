import { z } from 'zod';
import { CR_RE, VAT_RE, nationalAddressSchema } from './company';

export const DOC_KINDS = ['cr', 'vat', 'address'] as const;
export type DocKind = (typeof DOC_KINDS)[number];
export const MAX_DOC_BYTES = 5 * 1024 * 1024;

/** Detect the real file type from its first bytes; the client-declared type is never trusted. */
export function sniffMime(b: Buffer): 'application/pdf' | 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

export const safeFileName = (n: string): string => n.replace(/[\\/\x00-\x1f"]/g, '_').trim().slice(0, 150) || 'document';

/** Arabic-Indic and Persian digits to ASCII, so "٣١٠..." compares equal to "310...". */
export function westernDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0));
}

export interface Extracted { crNumber?: string; vatNumber?: string; nationalAddress?: z.infer<typeof nationalAddressSchema> }

/** Validate whatever a model returned against the same rules as manual entry; anything that fails is dropped. */
export function sanitizeExtracted(kind: DocKind, raw: unknown): Extracted {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const clean = (v: unknown) => (typeof v === 'string' ? westernDigits(v).replace(/[\s-]/g, '') : '');
  const out: Extracted = {};
  if (kind === 'cr') { const v = clean(o.crNumber); if (CR_RE.test(v)) out.crNumber = v; }
  if (kind === 'vat') { const v = clean(o.vatNumber); if (VAT_RE.test(v)) out.vatNumber = v; }
  if (kind === 'address') {
    const a = (o.nationalAddress && typeof o.nationalAddress === 'object' ? o.nationalAddress : o) as Record<string, unknown>;
    const r = nationalAddressSchema.safeParse({
      buildingNo: clean(a.buildingNo), additionalNo: clean(a.additionalNo), postalCode: clean(a.postalCode),
      street: typeof a.street === 'string' ? a.street.trim() : '', district: typeof a.district === 'string' ? a.district.trim() : '', city: typeof a.city === 'string' ? a.city.trim() : '',
    });
    if (r.success) out.nationalAddress = r.data;
  }
  return out;
}

/** Fields where the extracted value disagrees with what the owner typed. */
export function mismatches(extracted: Extracted | null, entered: { crNumber?: string | null; vatNumber?: string | null; nationalAddress?: unknown }): string[] {
  const m: string[] = [];
  if (!extracted) return m;
  if (extracted.crNumber && entered.crNumber && extracted.crNumber !== entered.crNumber) m.push('crNumber');
  if (extracted.vatNumber && entered.vatNumber && extracted.vatNumber !== entered.vatNumber) m.push('vatNumber');
  if (extracted.nationalAddress && entered.nationalAddress && JSON.stringify(sortKeys(extracted.nationalAddress)) !== JSON.stringify(sortKeys(entered.nationalAddress))) m.push('nationalAddress');
  return m;
}
const sortKeys = (o: unknown): unknown => (o && typeof o === 'object' ? Object.fromEntries(Object.entries(o as object).sort(([a], [b]) => a.localeCompare(b))) : o);
