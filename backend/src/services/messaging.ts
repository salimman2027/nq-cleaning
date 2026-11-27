import { query } from '../db';
import { toInternational } from '../lib/otp';
import { DEFAULT_TEXTS, decrypt, getMessaging, assertPublicHttps, type MsgEvent } from './settings';

export interface Vars { name: string; company: string; date?: string; link?: string }
export type Channel = 'whatsapp' | 'sms';

async function log(companyId: number | null, phone: string, channel: string, template: string, status: string, error?: string) {
  await query(`INSERT INTO NotificationLogs (CompanyId, Phone, Channel, Template, Status, Error) VALUES (@c,@p,@ch,@t,@s,@e)`, { c: companyId, p: phone, ch: channel, t: template, s: status, e: error ? error.slice(0, 500) : null });
}
const fill = (tpl: string, v: Record<string, string>) => tpl.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => v[k] ?? '');
const jsonEsc = (s: string) => JSON.stringify(s).slice(1, -1);

async function viaWhatsapp(event: MsgEvent | 'test', phone: string, vars: Vars, companyId: number | null): Promise<boolean> {
  const cfg = (await getMessaging()).whatsapp;
  if (!cfg.enabled || !cfg.phoneId || !cfg.tokenEnc) return false;
  try {
    const params = [vars.name, vars.company, vars.link ?? vars.date ?? '-'];
    const template = event === 'test' ? cfg.templates.order_confirmed : cfg.templates[event];
    const r = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(cfg.phoneId)}/messages`, {
      method: 'POST', headers: { Authorization: `Bearer ${decrypt(cfg.tokenEnc)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: toInternational(phone), type: 'template', template: { name: template, language: { code: cfg.lang }, components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }] } }),
      signal: AbortSignal.timeout(10_000),
    });
    await log(companyId, phone, 'whatsapp', event, r.ok ? 'sent' : 'failed', r.ok ? undefined : `HTTP ${r.status}`);
    return r.ok;
  } catch (e) { await log(companyId, phone, 'whatsapp', event, 'failed', e instanceof Error ? e.message : 'error'); return false; }
}

async function viaSms(event: MsgEvent | 'test', phone: string, vars: Vars, companyId: number | null): Promise<boolean> {
  const cfg = (await getMessaging()).sms;
  if (!cfg.enabled || !cfg.url || !cfg.apiKeyEnc) return false;
  try {
    assertPublicHttps(cfg.url);
    const text = event === 'test' ? 'رسالة تجربة من فزعتك' : fill(cfg.texts[event] || DEFAULT_TEXTS[event], { name: vars.name, company: vars.company, date: vars.date ?? '', link: vars.link ?? '' });
    const body = fill(cfg.bodyTemplate, { to: jsonEsc(toInternational(phone)), message: jsonEsc(text), sender: jsonEsc(cfg.sender) });
    const r = await fetch(cfg.url, {
      method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json', [cfg.authHeader || 'Authorization']: `${cfg.authScheme ? `${cfg.authScheme} ` : ''}${decrypt(cfg.apiKeyEnc)}` },
      body, signal: AbortSignal.timeout(10_000),
    });
    await log(companyId, phone, 'sms', event, r.ok ? 'sent' : 'failed', r.ok ? undefined : `HTTP ${r.status}`);
    return r.ok;
  } catch (e) { await log(companyId, phone, 'sms', event, 'failed', e instanceof Error ? e.message : 'error'); return false; }
}

/** Tells the customer about an order event on every enabled channel. Never throws: a failed message must not undo the business action. */
export async function notifyEvent(event: MsgEvent, phone: string, vars: Vars, companyId: number | null): Promise<Channel[]> {
  try {
    const cfg = await getMessaging();
    if (!cfg.events[event]) return [];
    const sent: Channel[] = [];
    if (await viaWhatsapp(event, phone, vars, companyId)) sent.push('whatsapp');
    if (await viaSms(event, phone, vars, companyId)) sent.push('sms');
    return sent;
  } catch { return []; }
}

/** Administrator's test button. Reports success per channel so a wrong token or URL is visible immediately. */
export async function sendTest(channel: Channel, phone: string): Promise<boolean> {
  const v: Vars = { name: 'تجربة', company: 'فزعتك', date: new Date().toISOString().slice(0, 10), link: '-' };
  return channel === 'whatsapp' ? viaWhatsapp('test', phone, v, null) : viaSms('test', phone, v, null);
}
