import { HttpError } from '../errors';
import { decrypt, getAi } from './settings';

/**
 * Asks the model the platform administrator chose (Claude, Gemini or ChatGPT) using the API key saved in the platform settings.
 * Only fixed provider hosts are called. Only aggregated figures are ever sent, never customer names or phone numbers.
 */
export async function generate(system: string, prompt: string, maxTokens = 1800): Promise<{ text: string; provider: string; model: string }> {
  const ai = await getAi();
  if (!ai.apiKeyEnc) throw new HttpError(400, 'AI_NOT_CONFIGURED', 'Choose an AI model and save its API key in the platform settings first');
  const key = decrypt(ai.apiKeyEnc);
  const signal = AbortSignal.timeout(60_000);
  let res: Response;
  let pick: (j: any) => string | undefined;
  if (ai.provider === 'claude') {
    res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal, headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: ai.model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt }] }) });
    pick = (j) => j?.content?.map((c: { text?: string }) => c.text ?? '').join('');
  } else if (ai.provider === 'openai') {
    res = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', signal, headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: ai.model, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] }) });
    pick = (j) => j?.choices?.[0]?.message?.content;
  } else {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(ai.model)}:generateContent`, { method: 'POST', signal, headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: maxTokens } }) });
    pick = (j) => j?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('');
  }
  if (!res.ok) throw new HttpError(502, 'AI_FAILED', `The AI provider answered HTTP ${res.status}. Check the API key, the model name and the provider's balance.`);
  const text = pick(await res.json().catch(() => null))?.trim();
  if (!text) throw new HttpError(502, 'AI_FAILED', 'The AI provider returned an empty answer');
  return { text, provider: ai.provider, model: ai.model };
}
