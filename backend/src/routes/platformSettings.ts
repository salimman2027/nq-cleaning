import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db';
import { HttpError, h, parse } from '../errors';
import { requirePerm } from '../auth/middleware';
import { isSaudiMobile } from '../lib/otp';
import { normalizeMobile } from '../lib/phone';
import { sendTest } from '../services/messaging';
import { EVENTS, assertPublicHttps, encrypt, getMessaging, publicView, saveMessaging, type Messaging } from '../services/settings';

/** Platform administrator: WhatsApp Business API and SMS gateway credentials, and which events notify the customer. */
export const platformSettingsRouter = Router();

const text = (n: number) => z.string().trim().max(n);
const tplName = z.string().trim().regex(/^[a-z0-9_]{1,200}$/, 'template name');
const tmplByEvent = <T extends z.ZodTypeAny>(t: T) => z.object({ order_confirmed: t, service_started: t, service_finished: t });
const schema = z.object({
  whatsapp: z.object({
    enabled: z.boolean(), phoneId: z.string().trim().regex(/^\d{0,30}$/), lang: z.string().trim().regex(/^[a-z]{2}(_[A-Z]{2})?$/),
    templates: tmplByEvent(tplName), token: z.string().trim().min(10).max(1000).optional(), clearToken: z.boolean().optional(),
  }),
  sms: z.object({
    enabled: z.boolean(), url: text(500), authHeader: z.string().trim().regex(/^[A-Za-z0-9-]{1,40}$/), authScheme: text(20), sender: text(30),
    bodyTemplate: text(1000), texts: tmplByEvent(text(320)), apiKey: z.string().trim().min(6).max(1000).optional(), clearApiKey: z.boolean().optional(),
  }),
  events: tmplByEvent(z.boolean()),
});

platformSettingsRouter.get('/settings/messaging', requirePerm('platform.brand.manage'), h(async (_req, res) => { res.json(publicView(await getMessaging())); }));

platformSettingsRouter.put('/settings/messaging', requirePerm('platform.brand.manage'), h(async (req, res) => {
  const b = parse(schema, req.body);
  const cur = await getMessaging();
  const tokenEnc = b.whatsapp.clearToken ? null : b.whatsapp.token ? encrypt(b.whatsapp.token) : cur.whatsapp.tokenEnc;
  const apiKeyEnc = b.sms.clearApiKey ? null : b.sms.apiKey ? encrypt(b.sms.apiKey) : cur.sms.apiKeyEnc;
  if (b.whatsapp.enabled && (!b.whatsapp.phoneId || !tokenEnc)) throw new HttpError(400, 'VALIDATION_ERROR', 'WhatsApp needs the phone number ID and the access token');
  if (b.sms.url) assertPublicHttps(b.sms.url);
  if (b.sms.enabled) {
    if (!b.sms.url || !apiKeyEnc) throw new HttpError(400, 'VALIDATION_ERROR', 'SMS needs the gateway URL and the API key');
    if (!b.sms.bodyTemplate.includes('{{to}}') || !b.sms.bodyTemplate.includes('{{message}}')) throw new HttpError(400, 'VALIDATION_ERROR', 'The body template must contain {{to}} and {{message}}');
    try { JSON.parse(b.sms.bodyTemplate.replace(/\{\{\w+\}\}/g, 'x')); } catch { throw new HttpError(400, 'VALIDATION_ERROR', 'The body template must be valid JSON'); }
  }
  const next: Messaging = {
    whatsapp: { enabled: b.whatsapp.enabled, phoneId: b.whatsapp.phoneId, lang: b.whatsapp.lang, templates: b.whatsapp.templates, tokenEnc },
    sms: { enabled: b.sms.enabled, url: b.sms.url, authHeader: b.sms.authHeader, authScheme: b.sms.authScheme, sender: b.sms.sender, bodyTemplate: b.sms.bodyTemplate, texts: b.sms.texts, apiKeyEnc },
    events: b.events,
  };
  await saveMessaging(next);
  await query(`INSERT INTO AuditLogs (CompanyId, UserId, Action, Entity, EntityId, Details) VALUES (@c,@u,'settings.messaging','Settings','messaging',@d)`, {
    c: req.user!.companyId, u: req.user!.id, d: `wa=${next.whatsapp.enabled} sms=${next.sms.enabled} events=${EVENTS.filter((e) => next.events[e]).join(',')}`,
  });
  res.json(publicView(next));
}));

platformSettingsRouter.post('/settings/messaging/test', requirePerm('platform.brand.manage'), h(async (req, res) => {
  const b = parse(z.object({ channel: z.enum(['whatsapp', 'sms']), phone: z.string().trim().min(9).max(20).transform(normalizeMobile).refine(isSaudiMobile, 'Invalid mobile number') }), req.body);
  const ok = await sendTest(b.channel, b.phone);
  res.json({ ok });
}));
