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

export type AddressParts = Partial<z.infer<typeof nationalAddressSchema>>;
export interface Extracted { crNumber?: string; vatNumber?: string; nationalAddress?: AddressParts }

/** Validate whatever was read (by a model or by text rules) with the same rules as manual entry; anything that fails is dropped. */
export function sanitizeExtracted(kind: DocKind, raw: unknown): Extracted {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const clean = (v: unknown) => (typeof v === 'string' ? westernDigits(v).replace(/[\s-]/g, '') : '');
  const out: Extracted = {};
  if (kind === 'cr') { const v = clean(o.crNumber); if (CR_RE.test(v)) out.crNumber = v; }
  if (kind === 'vat') { const v = clean(o.vatNumber); if (VAT_RE.test(v)) out.vatNumber = v; }
  if (kind === 'address') {
    const a = (o.nationalAddress && typeof o.nationalAddress === 'object' ? o.nationalAddress : o) as Record<string, unknown>;
    const part: AddressParts = {};
    for (const k of ['buildingNo', 'additionalNo'] as const) { const v = clean(a[k]); if (/^\d{4}$/.test(v)) part[k] = v; }
    const pc = clean(a.postalCode); if (/^\d{5}$/.test(pc)) part.postalCode = pc;
    for (const k of ['street', 'district', 'city'] as const) { const v = typeof a[k] === 'string' ? (a[k] as string).trim() : ''; if (v.length >= 2 && v.length <= 120 && !/\d{4,}/.test(v)) part[k] = v; }
    if (Object.keys(part).length) out.nationalAddress = part;
  }
  return out;
}

export const isCompleteAddress = (a: unknown): a is z.infer<typeof nationalAddressSchema> => nationalAddressSchema.safeParse(a).success;

/** Fields where the extracted value disagrees with what the owner typed (only fields present on both sides are compared). */
export function mismatches(extracted: Extracted | null, entered: { crNumber?: string | null; vatNumber?: string | null; nationalAddress?: unknown }): string[] {
  const m: string[] = [];
  if (!extracted) return m;
  if (extracted.crNumber && entered.crNumber && extracted.crNumber !== entered.crNumber) m.push('crNumber');
  if (extracted.vatNumber && entered.vatNumber && extracted.vatNumber !== entered.vatNumber) m.push('vatNumber');
  const ea = extracted.nationalAddress as Record<string, string> | undefined;
  const na = entered.nationalAddress as Record<string, string> | null | undefined;
  if (ea && na && Object.keys(ea).some((k) => na[k] !== undefined && ea[k] !== na[k])) m.push('nationalAddress');
  return m;
}

const norm = (t: string): string => westernDigits(t).replace(/[​-‏‪-‮⁦-⁩﻿]/g, '');
const near = (text: string, label: RegExp, value: string, span = 25): string | undefined => {
  const after = text.match(new RegExp(`(?:${label.source})[^\\d\\n]{0,${span}}(${value})`, 'i'));
  if (after) return after[1];
  const before = text.match(new RegExp(`(${value})[^\\d\\n]{0,${span}}(?:${label.source})`, 'i'));
  return before?.[1];
};

/**
 * Rule-based reading of text taken from a PDF (no AI). Layouts differ, so this is best effort: it returns only what it
 * finds, every value is re-validated by sanitizeExtracted, and the owner and the reviewer still check the original.
 */
export function parseDocumentText(kind: DocKind, raw: string): Extracted {
  const t = norm(raw);
  if (kind === 'vat') return sanitizeExtracted('vat', { vatNumber: t.match(/(?<!\d)3\d{13}3(?!\d)/)?.[0] });
  if (kind === 'cr') {
    const cands = [...t.matchAll(/(?<!\d)[1-7]\d{9}(?!\d)/g)].map((m) => m[0]);
    const kw = near(t, /السجل التجاري|رقم السجل|commercial registration|CR\s*(?:No|Number)?/, '[1-7]\\d{9}(?!\\d)', 40);
    return sanitizeExtracted('cr', { crNumber: kw ?? (new Set(cands).size === 1 ? cands[0] : undefined) });
  }
  return sanitizeExtracted('address', {
    buildingNo: near(t, /رقم المبنى|building\s*(?:no|number)?/, '\\d{4}(?!\\d)'),
    additionalNo: near(t, /الرقم الإضافي|الرقم الاضافي|additional\s*(?:no|number)?/, '\\d{4}(?!\\d)'),
    postalCode: near(t, /الرمز البريدي|الرمز البريدى|postal\s*code|zip/, '\\d{5}(?!\\d)'),
    // Street, district and city are NOT read from PDF text: Arabic words often come out of PDFs letter-reversed, so
    // they are only taken from the AI path (which looks at the page as an image) or typed by the owner.
  });
}
