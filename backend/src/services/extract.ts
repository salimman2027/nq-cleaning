import { config } from '../config';
import { sanitizeExtracted, type DocKind, type Extracted } from '../lib/documents';

const PROMPTS: Record<DocKind, string> = {
  cr: 'This is a Saudi commercial registration (السجل التجاري). Return JSON {"crNumber": "<10-digit registration number>"} only.',
  vat: 'This is a Saudi VAT registration certificate. Return JSON {"vatNumber": "<15-digit VAT number>"} only.',
  address: 'This is a Saudi National Address document. Return JSON {"nationalAddress": {"buildingNo":"4 digits","street":"","district":"","city":"","postalCode":"5 digits","additionalNo":"4 digits"}} only.',
};

export const extractionEnabled = (): boolean => Boolean(config.extract.apiKey);

type Fetch = typeof fetch;

/**
 * Reads values from the file with the Anthropic API when ANTHROPIC_API_KEY is set. Best effort: the result is a
 * suggestion that the owner confirms and the platform reviewer checks against the original file.
 */
export async function extractFromFile(kind: DocKind, mime: string, data: Buffer, doFetch: Fetch = fetch): Promise<{ status: 'ok' | 'empty' | 'failed' | 'skipped'; values: Extracted }> {
  if (!extractionEnabled()) return { status: 'skipped', values: {} };
  try {
    const block = mime === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: mime, data: data.toString('base64') } }
      : { type: 'image', source: { type: 'base64', media_type: mime, data: data.toString('base64') } };
    const res = await doFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': config.extract.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: config.extract.model, max_tokens: 400, messages: [{ role: 'user', content: [block, { type: 'text', text: `${PROMPTS[kind]} Use Western digits. If a value is not visible, omit it. No prose.` }] }] }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return { status: 'failed', values: {} };
    const body = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = body.content?.find((c) => c.type === 'text')?.text ?? '';
    const json = text.match(/\{[\s\S]*\}/)?.[0];
    const values = sanitizeExtracted(kind, json ? JSON.parse(json) : {});
    return { status: Object.keys(values).length ? 'ok' : 'empty', values };
  } catch {
    return { status: 'failed', values: {} };
  }
}
