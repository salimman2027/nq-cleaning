"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deliveryConfigured = deliveryConfigured;
exports.send = send;
const config_1 = require("../config");
const db_1 = require("../db");
const errors_1 = require("../errors");
const otp_1 = require("../lib/otp");
async function log(companyId, phone, channel, template, status, error) {
    // Never store message parameters (they may contain one-time codes).
    await (0, db_1.query)(`INSERT INTO NotificationLogs (CompanyId, Phone, Channel, Template, Status, Error) VALUES (@c,@p,@ch,@t,@s,@e)`, { c: companyId, p: phone, ch: channel, t: template, s: status, e: error ? error.slice(0, 500) : null });
}
/** True when real delivery is configured; production refuses to pretend otherwise. */
function deliveryConfigured() {
    return config_1.config.notify.provider === 'whatsapp' && !!config_1.config.notify.whatsappToken && !!config_1.config.notify.whatsappPhoneId;
}
/**
 * Sends a pre-approved WhatsApp template message. Provider 'dev' only records that a send was attempted
 * (no content), which lets the platform run locally and in CI without any external account.
 * SMS gateways are not implemented yet.
 */
async function send(phone, template, params, companyId = null) {
    if (config_1.config.notify.provider === 'dev') {
        await log(companyId, phone, 'dev', template, 'skipped');
        return;
    }
    if (!deliveryConfigured())
        throw new errors_1.HttpError(503, 'NOTIFY_NOT_CONFIGURED', 'Message delivery is not configured');
    const name = { otp: config_1.config.notify.otpTemplate, company_approved: config_1.config.notify.approvedTemplate, company_rejected: config_1.config.notify.rejectedTemplate, order_confirmed: config_1.config.notify.orderConfirmedTemplate }[template];
    const components = [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }];
    // Authentication templates carry the code in a copy-code button as well.
    if (template === 'otp')
        components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: params[0] }] });
    try {
        const r = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(config_1.config.notify.whatsappPhoneId)}/messages`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${config_1.config.notify.whatsappToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                to: (0, otp_1.toInternational)(phone),
                type: 'template',
                template: { name, language: { code: config_1.config.notify.whatsappLang }, components },
            }),
            signal: AbortSignal.timeout(10_000),
        });
        if (!r.ok) {
            await log(companyId, phone, 'whatsapp', template, 'failed', `HTTP ${r.status}`);
            throw new errors_1.HttpError(502, 'NOTIFY_FAILED', 'Could not deliver the message');
        }
        await log(companyId, phone, 'whatsapp', template, 'sent');
    }
    catch (e) {
        if (e instanceof errors_1.HttpError)
            throw e;
        await log(companyId, phone, 'whatsapp', template, 'failed', e instanceof Error ? e.message : 'error');
        throw new errors_1.HttpError(502, 'NOTIFY_FAILED', 'Could not deliver the message');
    }
}
