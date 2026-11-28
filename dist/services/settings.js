"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveReport = exports.getSavedReport = exports.saveAi = exports.DEFAULT_MODEL = exports.PROVIDERS = exports.emptyMessaging = exports.DEFAULT_BODY = exports.DEFAULT_TEXTS = exports.EVENTS = void 0;
exports.encrypt = encrypt;
exports.decrypt = decrypt;
exports.getMessaging = getMessaging;
exports.saveMessaging = saveMessaging;
exports.publicView = publicView;
exports.assertPublicHttps = assertPublicHttps;
exports.getAi = getAi;
exports.aiPublicView = aiPublicView;
const node_crypto_1 = __importDefault(require("node:crypto"));
const config_1 = require("../config");
const db_1 = require("../db");
const errors_1 = require("../errors");
/**
 * Platform settings stored in SystemSettings under the platform company. Secrets (API tokens) are encrypted with AES-256-GCM,
 * using a key derived from the server's own secret, and are never sent back to the browser.
 */
const key = () => node_crypto_1.default.createHash('sha256').update(`${config_1.config.jwt.accessSecret}:settings`).digest();
function encrypt(plain) {
    const iv = node_crypto_1.default.randomBytes(12);
    const c = node_crypto_1.default.createCipheriv('aes-256-gcm', key(), iv);
    const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return `${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${enc.toString('base64')}`;
}
function decrypt(blob) {
    const [iv, tag, enc] = blob.split('.');
    const d = node_crypto_1.default.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8');
}
exports.EVENTS = ['order_confirmed', 'service_started', 'service_finished'];
exports.DEFAULT_TEXTS = {
    order_confirmed: 'ابشر يا {{name}}، تم تأكيد طلبك من {{company}} بتاريخ {{date}}. فزعتك',
    service_started: 'يا هلا {{name}}، بدأ فريق {{company}} تنفيذ خدمتك الحين. فزعتك',
    service_finished: 'تم الانتهاء من خدمتك من {{company}}. نتمنى تقيّم تجربتك: {{link}} — فزعتك',
};
exports.DEFAULT_BODY = '{"to":"{{to}}","message":"{{message}}","sender":"{{sender}}"}';
const emptyMessaging = () => ({
    whatsapp: { enabled: false, phoneId: '', lang: 'ar', tokenEnc: null, templates: { order_confirmed: 'faz3tak_order_confirmed', service_started: 'faz3tak_service_started', service_finished: 'faz3tak_service_finished' } },
    sms: { enabled: false, url: '', authHeader: 'Authorization', authScheme: 'Bearer', apiKeyEnc: null, sender: '', bodyTemplate: exports.DEFAULT_BODY, texts: { ...exports.DEFAULT_TEXTS } },
    events: { order_confirmed: true, service_started: true, service_finished: true },
});
exports.emptyMessaging = emptyMessaging;
async function platformId() {
    const r = await (0, db_1.query)(`SELECT TOP 1 Id FROM Companies WHERE IsPlatform=1`);
    if (!r[0])
        throw new errors_1.HttpError(404, 'NOT_FOUND', 'Platform company not found');
    return Number(r[0].Id);
}
let cache = null;
async function getMessaging() {
    if (cache && Date.now() - cache.at < 15_000)
        return cache.v;
    const r = await (0, db_1.query)(`SELECT s.Value FROM SystemSettings s JOIN Companies c ON c.Id=s.CompanyId WHERE c.IsPlatform=1 AND s.[Key]='messaging'`);
    const base = (0, exports.emptyMessaging)();
    let v = base;
    if (r[0]?.Value) {
        const j = JSON.parse(r[0].Value);
        v = {
            whatsapp: { ...base.whatsapp, ...j.whatsapp, templates: { ...base.whatsapp.templates, ...j.whatsapp?.templates } },
            sms: { ...base.sms, ...j.sms, texts: { ...base.sms.texts, ...j.sms?.texts } },
            events: { ...base.events, ...j.events },
        };
    }
    cache = { at: Date.now(), v };
    return v;
}
async function saveMessaging(m) {
    const c = await platformId();
    await (0, db_1.query)(`MERGE SystemSettings AS t USING (SELECT @c AS CompanyId, 'messaging' AS [Key]) AS s ON t.CompanyId=s.CompanyId AND t.[Key]=s.[Key]
     WHEN MATCHED THEN UPDATE SET Value=@v WHEN NOT MATCHED THEN INSERT (CompanyId,[Key],Value) VALUES (@c,'messaging',@v);`, { c, v: JSON.stringify(m) });
    cache = null;
}
/** What the browser may see: everything except the secrets, which are reported only as set / not set with their last 4 characters. */
function publicView(m) {
    const hint = (enc) => { if (!enc)
        return null; try {
        return `••••${decrypt(enc).slice(-4)}`;
    }
    catch {
        return '••••';
    } };
    const { tokenEnc, ...wa } = m.whatsapp;
    const { apiKeyEnc, ...sms } = m.sms;
    return { whatsapp: { ...wa, tokenSet: !!tokenEnc, tokenHint: hint(tokenEnc) }, sms: { ...sms, apiKeySet: !!apiKeyEnc, apiKeyHint: hint(apiKeyEnc) }, events: m.events, defaults: { texts: exports.DEFAULT_TEXTS, bodyTemplate: exports.DEFAULT_BODY } };
}
/** The SMS gateway URL is typed by an administrator; still refuse anything that is not public https. */
function assertPublicHttps(raw) {
    let u;
    try {
        u = new URL(raw);
    }
    catch {
        throw new errors_1.HttpError(400, 'VALIDATION_ERROR', 'Invalid URL');
    }
    const h = u.hostname.toLowerCase();
    if (u.protocol !== 'https:')
        throw new errors_1.HttpError(400, 'VALIDATION_ERROR', 'The gateway URL must use https');
    if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h === '[::1]' || /^(127|10|0)\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) {
        throw new errors_1.HttpError(400, 'VALIDATION_ERROR', 'The gateway URL must be a public address');
    }
}
/** ---- AI provider (platform level): which model writes the reports, and its API key (encrypted, never sent back) ---- */
exports.PROVIDERS = ['claude', 'gemini', 'openai'];
exports.DEFAULT_MODEL = { claude: 'claude-sonnet-4-5', gemini: 'gemini-2.0-flash', openai: 'gpt-4o-mini' };
async function readKey(key) {
    const r = await (0, db_1.query)(`SELECT s.Value FROM SystemSettings s JOIN Companies c ON c.Id=s.CompanyId WHERE c.IsPlatform=1 AND s.[Key]=@k`, { k: key });
    return r[0]?.Value ? JSON.parse(r[0].Value) : null;
}
async function writeKey(key, value) {
    const c = await platformId();
    await (0, db_1.query)(`MERGE SystemSettings AS t USING (SELECT @c AS CompanyId, @k AS [Key]) AS s ON t.CompanyId=s.CompanyId AND t.[Key]=s.[Key]
     WHEN MATCHED THEN UPDATE SET Value=@v WHEN NOT MATCHED THEN INSERT (CompanyId,[Key],Value) VALUES (@c,@k,@v);`, { c, k: key, v: JSON.stringify(value) });
}
async function getAi() {
    const j = await readKey('ai');
    const provider = exports.PROVIDERS.includes(j?.provider) ? j.provider : 'claude';
    return { provider, model: j?.model || exports.DEFAULT_MODEL[provider], apiKeyEnc: j?.apiKeyEnc ?? null };
}
const saveAi = (a) => writeKey('ai', a);
exports.saveAi = saveAi;
function aiPublicView(a) {
    let hint = null;
    if (a.apiKeyEnc) {
        try {
            hint = `••••${decrypt(a.apiKeyEnc).slice(-4)}`;
        }
        catch {
            hint = '••••';
        }
    }
    return { provider: a.provider, model: a.model, keySet: !!a.apiKeyEnc, keyHint: hint, defaults: exports.DEFAULT_MODEL };
}
const getSavedReport = () => readKey('ai_report');
exports.getSavedReport = getSavedReport;
const saveReport = (r) => writeKey('ai_report', r);
exports.saveReport = saveReport;
