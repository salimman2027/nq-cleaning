import crypto from 'node:crypto';
import { config } from '../config';
import { query } from '../db';
import { HttpError } from '../errors';

/**
 * Platform settings stored in SystemSettings under the platform company. Secrets (API tokens) are encrypted with AES-256-GCM,
 * using a key derived from the server's own secret, and are never sent back to the browser.
 */
const key = (): Buffer => crypto.createHash('sha256').update(`${config.jwt.accessSecret}:settings`).digest();

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${enc.toString('base64')}`;
}
export function decrypt(blob: string): string {
  const [iv, tag, enc] = blob.split('.');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8');
}

export const EVENTS = ['order_confirmed', 'service_started', 'service_finished'] as const;
export type MsgEvent = (typeof EVENTS)[number];

export interface Messaging {
  whatsapp: { enabled: boolean; phoneId: string; lang: string; tokenEnc: string | null; templates: Record<MsgEvent, string> };
  sms: { enabled: boolean; url: string; authHeader: string; authScheme: string; apiKeyEnc: string | null; sender: string; bodyTemplate: string; texts: Record<MsgEvent, string> };
  events: Record<MsgEvent, boolean>;
}

export const DEFAULT_TEXTS: Record<MsgEvent, string> = {
  order_confirmed: 'ابشر يا {{name}}، تم تأكيد طلبك من {{company}} بتاريخ {{date}}. فزعتك',
  service_started: 'يا هلا {{name}}، بدأ فريق {{company}} تنفيذ خدمتك الحين. فزعتك',
  service_finished: 'تم الانتهاء من خدمتك من {{company}}. نتمنى تقيّم تجربتك: {{link}} — فزعتك',
};
export const DEFAULT_BODY = '{"to":"{{to}}","message":"{{message}}","sender":"{{sender}}"}';

export const emptyMessaging = (): Messaging => ({
  whatsapp: { enabled: false, phoneId: '', lang: 'ar', tokenEnc: null, templates: { order_confirmed: 'faz3tak_order_confirmed', service_started: 'faz3tak_service_started', service_finished: 'faz3tak_service_finished' } },
  sms: { enabled: false, url: '', authHeader: 'Authorization', authScheme: 'Bearer', apiKeyEnc: null, sender: '', bodyTemplate: DEFAULT_BODY, texts: { ...DEFAULT_TEXTS } },
  events: { order_confirmed: true, service_started: true, service_finished: true },
});

async function platformId(): Promise<number> {
  const r = await query<{ Id: number }>(`SELECT TOP 1 Id FROM Companies WHERE IsPlatform=1`);
  if (!r[0]) throw new HttpError(404, 'NOT_FOUND', 'Platform company not found');
  return Number(r[0].Id);
}

let cache: { at: number; v: Messaging } | null = null;
export async function getMessaging(): Promise<Messaging> {
  if (cache && Date.now() - cache.at < 15_000) return cache.v;
  const r = await query<{ Value: string }>(`SELECT s.Value FROM SystemSettings s JOIN Companies c ON c.Id=s.CompanyId WHERE c.IsPlatform=1 AND s.[Key]='messaging'`);
  const base = emptyMessaging();
  let v = base;
  if (r[0]?.Value) {
    const j = JSON.parse(r[0].Value) as Partial<Messaging>;
    v = {
      whatsapp: { ...base.whatsapp, ...j.whatsapp, templates: { ...base.whatsapp.templates, ...j.whatsapp?.templates } },
      sms: { ...base.sms, ...j.sms, texts: { ...base.sms.texts, ...j.sms?.texts } },
      events: { ...base.events, ...j.events },
    };
  }
  cache = { at: Date.now(), v };
  return v;
}

export async function saveMessaging(m: Messaging): Promise<void> {
  const c = await platformId();
  await query(
    `MERGE SystemSettings AS t USING (SELECT @c AS CompanyId, 'messaging' AS [Key]) AS s ON t.CompanyId=s.CompanyId AND t.[Key]=s.[Key]
     WHEN MATCHED THEN UPDATE SET Value=@v WHEN NOT MATCHED THEN INSERT (CompanyId,[Key],Value) VALUES (@c,'messaging',@v);`,
    { c, v: JSON.stringify(m) },
  );
  cache = null;
}

/** What the browser may see: everything except the secrets, which are reported only as set / not set with their last 4 characters. */
export function publicView(m: Messaging) {
  const hint = (enc: string | null) => { if (!enc) return null; try { return `••••${decrypt(enc).slice(-4)}`; } catch { return '••••'; } };
  const { tokenEnc, ...wa } = m.whatsapp;
  const { apiKeyEnc, ...sms } = m.sms;
  return { whatsapp: { ...wa, tokenSet: !!tokenEnc, tokenHint: hint(tokenEnc) }, sms: { ...sms, apiKeySet: !!apiKeyEnc, apiKeyHint: hint(apiKeyEnc) }, events: m.events, defaults: { texts: DEFAULT_TEXTS, bodyTemplate: DEFAULT_BODY } };
}

/** The SMS gateway URL is typed by an administrator; still refuse anything that is not public https. */
export function assertPublicHttps(raw: string): void {
  let u: URL;
  try { u = new URL(raw); } catch { throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid URL'); }
  const h = u.hostname.toLowerCase();
  if (u.protocol !== 'https:') throw new HttpError(400, 'VALIDATION_ERROR', 'The gateway URL must use https');
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h === '[::1]' || /^(127|10|0)\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'The gateway URL must be a public address');
  }
}

/** ---- AI provider (platform level): which model writes the reports, and its API key (encrypted, never sent back) ---- */
export const PROVIDERS = ['claude', 'gemini', 'openai'] as const;
export type Provider = (typeof PROVIDERS)[number];
export const DEFAULT_MODEL: Record<Provider, string> = { claude: 'claude-sonnet-4-5', gemini: 'gemini-2.0-flash', openai: 'gpt-4o-mini' };
export interface AiSettings { provider: Provider; model: string; apiKeyEnc: string | null }

async function readKey<T>(key: string): Promise<T | null> {
  const r = await query<{ Value: string }>(`SELECT s.Value FROM SystemSettings s JOIN Companies c ON c.Id=s.CompanyId WHERE c.IsPlatform=1 AND s.[Key]=@k`, { k: key });
  return r[0]?.Value ? (JSON.parse(r[0].Value) as T) : null;
}
async function writeKey(key: string, value: unknown): Promise<void> {
  const c = await platformId();
  await query(
    `MERGE SystemSettings AS t USING (SELECT @c AS CompanyId, @k AS [Key]) AS s ON t.CompanyId=s.CompanyId AND t.[Key]=s.[Key]
     WHEN MATCHED THEN UPDATE SET Value=@v WHEN NOT MATCHED THEN INSERT (CompanyId,[Key],Value) VALUES (@c,@k,@v);`,
    { c, k: key, v: JSON.stringify(value) },
  );
}
export async function getAi(): Promise<AiSettings> {
  const j = await readKey<Partial<AiSettings>>('ai');
  const provider = PROVIDERS.includes(j?.provider as Provider) ? (j!.provider as Provider) : 'claude';
  return { provider, model: j?.model || DEFAULT_MODEL[provider], apiKeyEnc: j?.apiKeyEnc ?? null };
}
export const saveAi = (a: AiSettings) => writeKey('ai', a);
export function aiPublicView(a: AiSettings) {
  let hint: string | null = null;
  if (a.apiKeyEnc) { try { hint = `••••${decrypt(a.apiKeyEnc).slice(-4)}`; } catch { hint = '••••'; } }
  return { provider: a.provider, model: a.model, keySet: !!a.apiKeyEnc, keyHint: hint, defaults: DEFAULT_MODEL };
}
export const getSavedReport = () => readKey<{ at: string; days: number; provider: string; model: string; text: string }>('ai_report');
export const saveReport = (r: { at: string; days: number; provider: string; model: string; text: string }) => writeKey('ai_report', r);
