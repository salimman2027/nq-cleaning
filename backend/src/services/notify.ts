import { config } from '../config';
import { query } from '../db';
import { HttpError } from '../errors';
import { toInternational } from '../lib/otp';

export type Template = 'otp' | 'company_approved' | 'company_rejected' | 'order_confirmed';

async function log(companyId: number | null, phone: string, channel: string, template: string, status: string, error?: string) {
  // Never store message parameters (they may contain one-time codes).
  await query(
    `INSERT INTO NotificationLogs (CompanyId, Phone, Channel, Template, Status, Error) VALUES (@c,@p,@ch,@t,@s,@e)`,
    { c: companyId, p: phone, ch: channel, t: template, s: status, e: error ? error.slice(0, 500) : null },
  );
}

/** True when real delivery is configured; production refuses to pretend otherwise. */
export function deliveryConfigured(): boolean {
  return config.notify.provider === 'whatsapp' && !!config.notify.whatsappToken && !!config.notify.whatsappPhoneId;
}

/**
 * Sends a pre-approved WhatsApp template message. Provider 'dev' only records that a send was attempted
 * (no content), which lets the platform run locally and in CI without any external account.
 * SMS gateways are not implemented yet.
 */
export async function send(phone: string, template: Template, params: string[], companyId: number | null = null): Promise<void> {
  if (config.notify.provider === 'dev') {
    await log(companyId, phone, 'dev', template, 'skipped');
    return;
  }
  if (!deliveryConfigured()) throw new HttpError(503, 'NOTIFY_NOT_CONFIGURED', 'Message delivery is not configured');
  const name = { otp: config.notify.otpTemplate, company_approved: config.notify.approvedTemplate, company_rejected: config.notify.rejectedTemplate, order_confirmed: config.notify.orderConfirmedTemplate }[template];
  const components: unknown[] = [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }];
  // Authentication templates carry the code in a copy-code button as well.
  if (template === 'otp') components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: params[0] }] });
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(config.notify.whatsappPhoneId)}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.notify.whatsappToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: toInternational(phone),
        type: 'template',
        template: { name, language: { code: config.notify.whatsappLang }, components },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) {
      await log(companyId, phone, 'whatsapp', template, 'failed', `HTTP ${r.status}`);
      throw new HttpError(502, 'NOTIFY_FAILED', 'Could not deliver the message');
    }
    await log(companyId, phone, 'whatsapp', template, 'sent');
  } catch (e) {
    if (e instanceof HttpError) throw e;
    await log(companyId, phone, 'whatsapp', template, 'failed', e instanceof Error ? e.message : 'error');
    throw new HttpError(502, 'NOTIFY_FAILED', 'Could not deliver the message');
  }
}
