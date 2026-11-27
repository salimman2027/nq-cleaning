import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

/** 6-digit numeric code from a CSPRNG. */
export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Keyed hash bound to phone + purpose, so a stolen table cannot be brute-forced offline without the secret. */
export function hashCode(secret: string, phone: string, purpose: string, code: string): string {
  return createHmac('sha256', secret).update(`${purpose}|${phone}|${code}`).digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/** Saudi mobile in local form 05XXXXXXXX (after normalizeMobile). */
export const isSaudiMobile = (p: string): boolean => /^05\d{8}$/.test(p);

/** E.164 digits without '+', for WhatsApp Cloud API. */
export const toInternational = (local: string): string => (local.startsWith('0') ? '966' + local.slice(1) : local);
