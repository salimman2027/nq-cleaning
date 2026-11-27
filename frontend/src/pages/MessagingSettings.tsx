import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { useI18n, type Key } from '../i18n';
import { Button, ErrorBox, Field, Input } from '../ui';

const EVENTS = ['order_confirmed', 'service_started', 'service_finished'] as const;
type Ev = (typeof EVENTS)[number];
interface View {
  whatsapp: { enabled: boolean; phoneId: string; lang: string; tokenSet: boolean; tokenHint: string | null; templates: Record<Ev, string> };
  sms: { enabled: boolean; url: string; authHeader: string; authScheme: string; apiKeySet: boolean; apiKeyHint: string | null; sender: string; bodyTemplate: string; texts: Record<Ev, string> };
  events: Record<Ev, boolean>;
}

export default function MessagingSettings() {
  const { t } = useI18n();
  const [v, setV] = useState<View | null>(null);
  const [token, setToken] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [testPhone, setTestPhone] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => { api<View>('/platform/settings/messaging').then(setV).catch(() => setError('Error')); }, []);
  if (!v) return error ? <ErrorBox message={error} /> : null;
  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : 'Error');
  const save = async () => {
    setError(''); setMsg('');
    try {
      const body = { whatsapp: { ...v.whatsapp, token: token || undefined }, sms: { ...v.sms, apiKey: apiKey || undefined }, events: v.events };
      const r = await api<View>('/platform/settings/messaging', { method: 'PUT', body });
      setV(r); setToken(''); setApiKey(''); setMsg(t('saved'));
    } catch (e) { fail(e); }
  };
  const test = async (channel: 'whatsapp' | 'sms') => {
    setError(''); setMsg('');
    try { await api('/platform/settings/messaging/test', { method: 'POST', body: { channel, phone: testPhone } }); setMsg(t('testSent')); } catch (e) { fail(e); }
  };
  const wa = v.whatsapp, sm = v.sms;
  const setWa = (p: Partial<View['whatsapp']>) => setV({ ...v, whatsapp: { ...wa, ...p } });
  const setSm = (p: Partial<View['sms']>) => setV({ ...v, sms: { ...sm, ...p } });
  const box = 'space-y-3 rounded-2xl bg-white p-4 shadow dark:bg-slate-900';
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold">{t('messaging')}</h2>
      <p className="text-xs text-slate-500">{t('msgHint')}</p>
      {error && <ErrorBox message={error} />}
      {msg && <p className="text-sm text-green-700">{msg}</p>}
      <div className={box}>
        <h3 className="font-semibold">{t('evtTitle')}</h3>
        {EVENTS.map((e) => (
          <label key={e} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.events[e]} onChange={(x) => setV({ ...v, events: { ...v.events, [e]: x.target.checked } })} />{t(`ev_${e}` as Key)}</label>
        ))}
      </div>
      <div className={box}>
        <h3 className="font-semibold">{t('whatsappApi')}</h3>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={wa.enabled} onChange={(e) => setWa({ enabled: e.target.checked })} />{t('enabledLbl')}</label>
        <Field label={t('phoneIdLbl')}><Input dir="ltr" value={wa.phoneId} onChange={(e) => setWa({ phoneId: e.target.value })} /></Field>
        <Field label={t('tokenLbl')}><Input dir="ltr" type="password" autoComplete="off" placeholder={wa.tokenSet ? `${wa.tokenHint ?? ''} ${t('tokenSetHint')}` : ''} value={token} onChange={(e) => setToken(e.target.value)} /></Field>
        <Field label={t('langLbl')}><Input dir="ltr" value={wa.lang} onChange={(e) => setWa({ lang: e.target.value })} /></Field>
        {EVENTS.map((e) => (
          <Field key={e} label={`${t('templateLbl')} - ${t(`ev_${e}` as Key)}`}><Input dir="ltr" value={wa.templates[e]} onChange={(x) => setWa({ templates: { ...wa.templates, [e]: x.target.value } })} /></Field>
        ))}
      </div>
      <div className={box}>
        <h3 className="font-semibold">{t('smsApi')}</h3>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sm.enabled} onChange={(e) => setSm({ enabled: e.target.checked })} />{t('enabledLbl')}</label>
        <Field label={t('gatewayUrl')}><Input dir="ltr" placeholder="https://…" value={sm.url} onChange={(e) => setSm({ url: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('authHeaderLbl')}><Input dir="ltr" value={sm.authHeader} onChange={(e) => setSm({ authHeader: e.target.value })} /></Field>
          <Field label={t('authSchemeLbl')}><Input dir="ltr" value={sm.authScheme} onChange={(e) => setSm({ authScheme: e.target.value })} /></Field>
        </div>
        <Field label={t('apiKeyLbl')}><Input dir="ltr" type="password" autoComplete="off" placeholder={sm.apiKeySet ? `${sm.apiKeyHint ?? ''} ${t('tokenSetHint')}` : ''} value={apiKey} onChange={(e) => setApiKey(e.target.value)} /></Field>
        <Field label={t('senderLbl')}><Input value={sm.sender} onChange={(e) => setSm({ sender: e.target.value })} /></Field>
        <Field label={t('bodyTemplateLbl')}><textarea dir="ltr" rows={3} className="w-full rounded-lg border border-slate-300 bg-white p-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-900" value={sm.bodyTemplate} onChange={(e) => setSm({ bodyTemplate: e.target.value })} /></Field>
        {EVENTS.map((e) => (
          <Field key={e} label={`${t('textsLbl')} - ${t(`ev_${e}` as Key)}`}><textarea rows={2} className="w-full rounded-lg border border-slate-300 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-900" value={sm.texts[e]} onChange={(x) => setSm({ texts: { ...sm.texts, [e]: x.target.value } })} /></Field>
        ))}
      </div>
      <Button onClick={save}>{t('save')}</Button>
      <div className={box}>
        <Field label={t('testPhone')}><Input dir="ltr" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} /></Field>
        <div className="flex gap-2"><Button variant="ghost" onClick={() => test('whatsapp')}>{t('testSend')} - WhatsApp</Button><Button variant="ghost" onClick={() => test('sms')}>{t('testSend')} - SMS</Button></div>
      </div>
      <div className={box}>
        <h3 className="font-semibold">{t('paymentMethods')}</h3>
        <ul className="space-y-2 text-sm">
          <li className="flex items-center gap-2"><span>{t('payCash')}</span><span className="ms-auto rounded bg-green-100 px-2 text-xs text-green-800">{t('enabledLbl')}</span></li>
          {(['payCard', 'payTabby', 'payTamara'] as const).map((k) => <li key={k} className="flex items-center gap-2 text-slate-500"><span>{t(k)}</span><span className="ms-auto rounded bg-slate-100 px-2 text-xs dark:bg-slate-800">{t('soon')}</span></li>)}
        </ul>
        <p className="text-xs text-slate-500">{t('pmNote')}</p>
      </div>
    </div>
  );
}
