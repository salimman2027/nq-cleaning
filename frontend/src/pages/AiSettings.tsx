import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { useI18n } from '../i18n';
import { Button, ErrorBox, Field, Input } from '../ui';

type Provider = 'claude' | 'gemini' | 'openai';
interface View { provider: Provider; model: string; keySet: boolean; keyHint: string | null; defaults: Record<Provider, string> }
const NAMES: Record<Provider, string> = { claude: 'Claude', gemini: 'Gemini', openai: 'ChatGPT' };
const MAKERS: Record<Provider, string> = { claude: 'Anthropic', gemini: 'Google', openai: 'OpenAI' };

/** Platform administrator: which AI model writes the platform reports, and its API key (kept encrypted on the server, never shown again). */
export default function AiSettings() {
  const { t } = useI18n();
  const [v, setV] = useState<View | null>(null);
  const [provider, setProvider] = useState<Provider>('claude');
  const [model, setModel] = useState('');
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<View>('/platform/settings/ai').then((r) => { setV(r); setProvider(r.provider); setModel(r.model); }).catch(() => setErr('Error')); }, []);
  if (!v) return err ? <ErrorBox message={err} /> : null;
  const fail = (e: unknown) => setErr(e instanceof ApiError ? e.message : 'Error');
  const save = async (clear = false) => {
    setErr(''); setMsg(''); setBusy(true);
    try { const r = await api<View>('/platform/settings/ai', { method: 'PUT', body: { provider, model: model.trim() || undefined, apiKey: key || undefined, clearApiKey: clear || undefined } }); setV(r); setModel(r.model); setKey(''); setMsg(t('saved')); }
    catch (e) { fail(e); } finally { setBusy(false); }
  };
  const test = async () => {
    setErr(''); setMsg(''); setBusy(true);
    try { await api('/platform/settings/ai/test', { method: 'POST' }); setMsg(t('aiTestOk')); } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const pickProvider = (p: Provider) => { setProvider(p); setModel(v.defaults[p]); };
  return (
    <div className="space-y-4 rounded-2xl bg-white p-4 shadow dark:bg-slate-900">
      <div><h2 className="text-lg font-bold">{t('aiTitle')}</h2><p className="text-xs text-slate-500">{t('aiHint')}</p></div>
      {err && <ErrorBox message={err} />}
      {msg && <p className="text-sm text-green-700">{msg}</p>}
      <div role="radiogroup" className="grid gap-2 sm:grid-cols-3">
        {(Object.keys(NAMES) as Provider[]).map((p) => (
          <button key={p} type="button" role="radio" aria-checked={provider === p} onClick={() => pickProvider(p)}
            className={`rounded-xl border p-3 text-start ${provider === p ? 'border-cyan-700 bg-cyan-50 ring-2 ring-cyan-700 dark:bg-slate-800' : 'border-slate-300 dark:border-slate-600'}`}>
            <div className="font-semibold">{NAMES[p]}</div><div className="text-xs text-slate-500">{MAKERS[p]}</div>
          </button>
        ))}
      </div>
      <Field label={t('aiModel')}><Input dir="ltr" value={model} onChange={(e) => setModel(e.target.value)} /><span className="mt-1 block text-xs text-slate-500">{t('aiModelHint')}</span></Field>
      <Field label={`${t('apiKeyLbl')} — ${NAMES[provider]}`}><Input dir="ltr" type="password" autoComplete="off" placeholder={v.keySet ? `${v.keyHint ?? ''} ${t('tokenSetHint')}` : ''} value={key} onChange={(e) => setKey(e.target.value)} /></Field>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => void save()}>{t('save')}</Button>
        <Button variant="ghost" disabled={busy || !v.keySet} onClick={() => void test()}>{t('aiTest')}</Button>
        {v.keySet && <Button variant="ghost" disabled={busy} onClick={() => void save(true)}>{t('aiRemoveKey')}</Button>}
      </div>
    </div>
  );
}
