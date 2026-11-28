import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db';
import { HttpError, h, parse } from '../errors';
import { requirePerm } from '../auth/middleware';
import { isSaudiMobile } from '../lib/otp';
import { normalizeMobile } from '../lib/phone';
import { sendTest } from '../services/messaging';
import { EVENTS, PROVIDERS, DEFAULT_MODEL, aiPublicView, assertPublicHttps, encrypt, getAi, getMessaging, getSavedReport, publicView, saveAi, saveMessaging, saveReport, type Messaging } from '../services/settings';
import { generate } from '../services/ai';

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

/** ---- AI model and API key ---- */
platformSettingsRouter.get('/settings/ai', requirePerm('platform.brand.manage'), h(async (_req, res) => { res.json(aiPublicView(await getAi())); }));

platformSettingsRouter.put('/settings/ai', requirePerm('platform.brand.manage'), h(async (req, res) => {
  const b = parse(z.object({ provider: z.enum(PROVIDERS), model: z.string().trim().regex(/^[A-Za-z0-9._:-]{0,80}$/, 'model name').optional(), apiKey: z.string().trim().min(10).max(500).optional(), clearApiKey: z.boolean().optional() }), req.body);
  const cur = await getAi();
  const apiKeyEnc = b.clearApiKey ? null : b.apiKey ? encrypt(b.apiKey) : cur.apiKeyEnc;
  await saveAi({ provider: b.provider, model: b.model || DEFAULT_MODEL[b.provider], apiKeyEnc });
  await query(`INSERT INTO AuditLogs (CompanyId, UserId, Action, Entity, EntityId, Details) VALUES (@c,@u,'settings.ai','Settings','ai',@d)`, { c: req.user!.companyId, u: req.user!.id, d: `provider=${b.provider} key=${apiKeyEnc ? 'set' : 'none'}` });
  res.json(aiPublicView(await getAi()));
}));

platformSettingsRouter.post('/settings/ai/test', requirePerm('platform.brand.manage'), h(async (_req, res) => {
  const r = await generate('Reply with the single word OK.', 'ping', 20);
  res.json({ ok: true, provider: r.provider, model: r.model });
}));

/** ---- Platform report: real figures first, then the model's reading of them ---- */
async function reportStats(days: number) {
  const since = `DATEADD(day,-@d,SYSUTCDATETIME())`;
  const p = { d: days };
  const [tot] = await query<Record<string, number>>(
    `SELECT COUNT(*) AS Requests, SUM(CASE WHEN Status='confirmed' THEN 1 ELSE 0 END) AS Confirmed, SUM(CASE WHEN Status='cancelled' THEN 1 ELSE 0 END) AS Cancelled,
            SUM(CASE WHEN Status='new' AND CreatedAt < DATEADD(hour,-24,SYSUTCDATETIME()) THEN 1 ELSE 0 END) AS WaitingOver24h,
            ISNULL(SUM(CASE WHEN Status<>'cancelled' THEN Total END),0) AS Value
       FROM BookingRequests WHERE CreatedAt >= ${since}`, p);
  const services = await query<Record<string, any>>(
    `SELECT TOP 10 i.Name AS Service, ISNULL(s.Category, N'') AS Category, COUNT(DISTINCT r.Id) AS Requests, SUM(i.Qty) AS Units, ISNULL(SUM(i.UnitPrice*i.Qty),0) AS Value
       FROM BookingRequestItems i JOIN BookingRequests r ON r.Id=i.RequestId JOIN Services s ON s.Id=i.ServiceId
      WHERE r.CreatedAt >= ${since} AND r.Status<>'cancelled' GROUP BY i.Name, s.Category ORDER BY COUNT(DISTINCT r.Id) DESC, SUM(i.Qty) DESC`, p);
  const categories = await query<Record<string, any>>(
    `SELECT TOP 8 ISNULL(NULLIF(s.Category,N''), N'بدون قسم') AS Category, COUNT(DISTINCT r.Id) AS Requests
       FROM BookingRequestItems i JOIN BookingRequests r ON r.Id=i.RequestId JOIN Services s ON s.Id=i.ServiceId
      WHERE r.CreatedAt >= ${since} AND r.Status<>'cancelled' GROUP BY ISNULL(NULLIF(s.Category,N''), N'بدون قسم') ORDER BY COUNT(DISTINCT r.Id) DESC`, p);
  const cities = await query<Record<string, any>>(
    `SELECT TOP 8 City, COUNT(*) AS Requests FROM BookingRequests WHERE CreatedAt >= ${since} AND City IS NOT NULL AND Status<>'cancelled' GROUP BY City ORDER BY COUNT(*) DESC`, p);
  const [co] = await query<Record<string, number>>(`SELECT COUNT(*) AS Approved FROM Companies WHERE IsPlatform=0 AND Status='approved'`);
  const [rt] = await query<Record<string, number>>(`SELECT ROUND(AVG(CAST(Stars AS FLOAT)),2) AS Avg, COUNT(*) AS N FROM Ratings WHERE Stars IS NOT NULL`);
  const [cp] = await query<Record<string, number>>(`SELECT COUNT(*) AS N FROM Complaints WHERE CreatedAt >= ${since}`, p);
  const num = (v: unknown) => Number(v ?? 0);
  return {
    days, requests: num(tot?.Requests), confirmed: num(tot?.Confirmed), cancelled: num(tot?.Cancelled), waitingOver24h: num(tot?.WaitingOver24h), value: num(tot?.Value),
    approvedCompanies: num(co?.Approved), ratingAvg: rt?.Avg ?? null, ratingsCount: num(rt?.N), complaints: num(cp?.N),
    topServices: services.map((x) => ({ service: x.Service, category: x.Category, requests: num(x.Requests), units: num(x.Units), value: num(x.Value) })),
    categories: categories.map((x) => ({ category: x.Category, requests: num(x.Requests) })),
    cities: cities.map((x) => ({ city: x.City, requests: num(x.Requests) })),
  };
}

const days = z.coerce.number().int().refine((n) => [7, 30, 90].includes(n)).default(30);

platformSettingsRouter.get('/ai-report', requirePerm('platform.brand.manage'), h(async (req, res) => {
  const d = parse(days, req.query.days);
  res.json({ stats: await reportStats(d), configured: !!(await getAi()).apiKeyEnc, last: (await getSavedReport()) ?? null });
}));

platformSettingsRouter.post('/ai-report', requirePerm('platform.brand.manage'), h(async (req, res) => {
  const d = parse(days, req.body?.days);
  const stats = await reportStats(d);
  const system = 'أنت محلل أعمال لمنصة فزعتك (سوق خدمات منزلية وتجارية في السعودية فيه عدة شركات). اكتب للملاك تقريراً بالعربية بلهجة سعودية مهنية وبسيطة. '
    + 'استخدم الأرقام المرفقة فقط ولا تخترع أرقاماً أو شركات أو عملاء؛ إذا كانت البيانات قليلة قل ذلك صراحة. الأرقام المالية بالريال السعودي. '
    + 'الهيكل: ١) ملخص في ثلاثة أسطر ٢) أكثر الخدمات والأقسام طلباً وماذا يعني ذلك ٣) المدن والفرص الجغرافية ٤) تنبيهات (إلغاءات، طلبات بلا رد أكثر من ٢٤ ساعة، شكاوى) ٥) خمس أفكار عملية قابلة للتنفيذ لزيادة الطلب أو الجودة، كل فكرة بسطر مع سببها من الأرقام.';
  const out = await generate(system, `الأرقام لآخر ${d} يوم (JSON):\n${JSON.stringify(stats)}`);
  const last = { at: new Date().toISOString(), days: d, provider: out.provider, model: out.model, text: out.text };
  await saveReport(last);
  await query(`INSERT INTO AuditLogs (CompanyId, UserId, Action, Entity, EntityId, Details) VALUES (@c,@u,'ai.report','Report','ai',@d)`, { c: req.user!.companyId, u: req.user!.id, d: `${out.provider} ${d}d` });
  res.json({ stats, configured: true, last });
}));
