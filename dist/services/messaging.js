"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifyEvent = notifyEvent;
exports.sendTest = sendTest;
const db_1 = require("../db");
const otp_1 = require("../lib/otp");
const settings_1 = require("./settings");
async function log(companyId, phone, channel, template, status, error) {
    await (0, db_1.query)(`INSERT INTO NotificationLogs (CompanyId, Phone, Channel, Template, Status, Error) VALUES (@c,@p,@ch,@t,@s,@e)`, { c: companyId, p: phone, ch: channel, t: template, s: status, e: error ? error.slice(0, 500) : null });
}
const fill = (tpl, v) => tpl.replace(/\{\{(\w+)\}\}/g, (_m, k) => v[k] ?? '');
const jsonEsc = (s) => JSON.stringify(s).slice(1, -1);
async function viaWhatsapp(event, phone, vars, companyId) {
    const cfg = (await (0, settings_1.getMessaging)()).whatsapp;
    if (!cfg.enabled || !cfg.phoneId || !cfg.tokenEnc)
        return false;
    try {
        const params = [vars.name, vars.company, vars.link ?? vars.date ?? '-'];
        const template = event === 'test' ? cfg.templates.order_confirmed : cfg.templates[event];
        const r = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(cfg.phoneId)}/messages`, {
            method: 'POST', headers: { Authorization: `Bearer ${(0, settings_1.decrypt)(cfg.tokenEnc)}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ messaging_product: 'whatsapp', to: (0, otp_1.toInternational)(phone), type: 'template', template: { name: template, language: { code: cfg.lang }, components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }] } }),
            signal: AbortSignal.timeout(10_000),
        });
        await log(companyId, phone, 'whatsapp', event, r.ok ? 'sent' : 'failed', r.ok ? undefined : `HTTP ${r.status}`);
        return r.ok;
    }
    catch (e) {
        await log(companyId, phone, 'whatsapp', event, 'failed', e instanceof Error ? e.message : 'error');
        return false;
    }
}
async function viaSms(event, phone, vars, companyId) {
    const cfg = (await (0, settings_1.getMessaging)()).sms;
    if (!cfg.enabled || !cfg.url || !cfg.apiKeyEnc)
        return false;
    try {
        (0, settings_1.assertPublicHttps)(cfg.url);
        const text = event === 'test' ? 'رسالة تجربة من فزعتك' : fill(cfg.texts[event] || settings_1.DEFAULT_TEXTS[event], { name: vars.name, company: vars.company, date: vars.date ?? '', link: vars.link ?? '' });
        const body = fill(cfg.bodyTemplate, { to: jsonEsc((0, otp_1.toInternational)(phone)), message: jsonEsc(text), sender: jsonEsc(cfg.sender) });
        const r = await fetch(cfg.url, {
            method: 'POST', redirect: 'error',
            headers: { 'Content-Type': 'application/json', [cfg.authHeader || 'Authorization']: `${cfg.authScheme ? `${cfg.authScheme} ` : ''}${(0, settings_1.decrypt)(cfg.apiKeyEnc)}` },
            body, signal: AbortSignal.timeout(10_000),
        });
        await log(companyId, phone, 'sms', event, r.ok ? 'sent' : 'failed', r.ok ? undefined : `HTTP ${r.status}`);
        return r.ok;
    }
    catch (e) {
        await log(companyId, phone, 'sms', event, 'failed', e instanceof Error ? e.message : 'error');
        return false;
    }
}
/** Tells the customer about an order event on every enabled channel. Never throws: a failed message must not undo the business action. */
async function notifyEvent(event, phone, vars, companyId) {
    try {
        const cfg = await (0, settings_1.getMessaging)();
        if (!cfg.events[event])
            return [];
        const sent = [];
        if (await viaWhatsapp(event, phone, vars, companyId))
            sent.push('whatsapp');
        if (await viaSms(event, phone, vars, companyId))
            sent.push('sms');
        return sent;
    }
    catch {
        return [];
    }
}
/** Administrator's test button. Reports success per channel so a wrong token or URL is visible immediately. */
async function sendTest(channel, phone) {
    const v = { name: 'تجربة', company: 'فزعتك', date: new Date().toISOString().slice(0, 10), link: '-' };
    return channel === 'whatsapp' ? viaWhatsapp('test', phone, v, null) : viaSms('test', phone, v, null);
}
