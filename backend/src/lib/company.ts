import { z } from 'zod';

export const CR_RE = /^\d{10}$/;
export const VAT_RE = /^3\d{13}3$/; // Saudi VAT registration: 15 digits, starts and ends with 3
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/;

export const nationalAddressSchema = z.object({
  buildingNo: z.string().regex(/^\d{4}$/),
  street: z.string().min(2).max(120),
  district: z.string().min(2).max(120),
  city: z.string().min(2).max(80),
  postalCode: z.string().regex(/^\d{5}$/),
  additionalNo: z.string().regex(/^\d{4}$/),
});
export type NationalAddress = z.infer<typeof nationalAddressSchema>;

export interface ProfileForSubmit {
  name?: string | null;
  crNumber?: string | null;
  vatNumber?: string | null;
  nationalAddress?: unknown;
  sectorCount: number;
}

/** Names of the fields still missing before a company may be sent for review. */
export function missingForReview(p: ProfileForSubmit): string[] {
  const m: string[] = [];
  if (!p.name || p.name.trim().length < 2) m.push('name');
  if (!p.crNumber || !CR_RE.test(p.crNumber)) m.push('crNumber');
  if (!p.vatNumber || !VAT_RE.test(p.vatNumber)) m.push('vatNumber');
  if (!nationalAddressSchema.safeParse(p.nationalAddress).success) m.push('nationalAddress');
  if (p.sectorCount < 1) m.push('sectors');
  return m;
}

export const newSlug = (rand: string): string => `co-${rand}`;

/** An image reference: a file uploaded to this platform (/api/media/N) or an https URL. */
export const imageRef = z.string().max(500).refine((u) => /^\/api\/media\/\d+$/.test(u) || (u.startsWith('https://') && z.string().url().safeParse(u).success), 'Image must be an upload or an https URL').nullable().optional();
