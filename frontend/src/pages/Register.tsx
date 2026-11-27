import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { useI18n } from '../i18n';
import { Button, ErrorBox, Field, Input, PasswordInput } from '../ui';
import { PublicShell } from './Home';

interface Sector { Code: string; NameAr: string; NameEn: string }

export default function Register() {
  const { t, lang } = useI18n();
  const { adopt } = useAuth();
  const nav = useNavigate();
  const [step, setStep] = useState<1 | 2>(1);
  const [needCode, setNeedCode] = useState(true);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState('');
  const [f, setF] = useState({ companyName: '', ownerName: '', email: '', password: '' });
  const [picked, setPicked] = useState<string[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ items: Sector[] }>('/market/sectors').then((r) => setSectors(r.items)).catch(() => undefined);
    api<{ phoneVerification: boolean }>('/market/config').then((r) => { setNeedCode(r.phoneVerification); if (!r.phoneVerification) setStep(2); }).catch(() => undefined);
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try { await fn(); } catch (e) { setError(e instanceof ApiError ? e.message : 'Error'); } finally { setBusy(false); }
  };
  const sendCode = (e: FormEvent) => { e.preventDefault(); void run(async () => {
    const r = await api<{ devCode?: string }>('/onboarding/otp/request', { method: 'POST', body: { phone } });
    setDevCode(r.devCode ?? '');
    setStep(2);
  }); };
  const register = (e: FormEvent) => { e.preventDefault(); void run(async () => {
    const r = await api<{ accessToken: string; refreshToken: string }>('/onboarding/register', { method: 'POST', body: { phone, ...(needCode ? { code } : {}), ...f, sectorCodes: picked } });
    await adopt(r);
    nav('/app/company', { replace: true });
  }); };
  const toggleSector = (c: string) => setPicked((p) => (p.includes(c) ? p.filter((x) => x !== c) : p.length < 3 ? [...p, c] : p));

  return (
    <PublicShell>
      <div className="mx-auto my-8 max-w-md rounded-2xl bg-white p-6 shadow-md ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
        <h1 className="mb-1 text-xl font-bold">{t('registerTitle')}</h1>
        {needCode && <p className="mb-4 text-xs text-slate-500">{t('step')} {step}/2</p>}
        {error && <div className="mb-3"><ErrorBox message={error} /></div>}
        {step === 1 ? (
          <form onSubmit={sendCode} className="space-y-4">
            <Field label={`${t('mobile')} — ${t('mobileHint')}`}><Input inputMode="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
            <Button type="submit" disabled={busy} className="w-full">{busy ? t('loading') : t('sendCode')}</Button>
          </form>
        ) : (
          <form onSubmit={register} className="space-y-3">
            {!needCode && <Field label={`${t('mobile')} — ${t('mobileHint')}`}><Input inputMode="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>}
            {needCode && <Field label={t('otpCode')}><Input inputMode="numeric" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value)} /></Field>}
            {devCode && <p className="rounded bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">{t('devCodeNote')}: <b>{devCode}</b></p>}
            <Field label={t('companyName')}><Input required value={f.companyName} onChange={(e) => setF({ ...f, companyName: e.target.value })} /></Field>
            <Field label={t('ownerName')}><Input required value={f.ownerName} onChange={(e) => setF({ ...f, ownerName: e.target.value })} /></Field>
            <Field label={t('email')}><Input type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
            <Field label={t('password')}><PasswordInput minLength={10} required autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
            <div><span className="mb-1 block text-sm text-slate-600 dark:text-slate-300">{t('sectors')}</span>
              <div className="flex flex-wrap gap-2">
                {sectors.map((s) => (
                  <button type="button" key={s.Code} onClick={() => toggleSector(s.Code)} className={`rounded-full border px-3 py-1 text-sm ${picked.includes(s.Code) ? 'border-cyan-700 bg-cyan-700 text-white' : 'border-slate-300 dark:border-slate-700'}`}>{lang === 'ar' ? s.NameAr : s.NameEn}</button>
                ))}
              </div>
            </div>
            <Button type="submit" disabled={busy || picked.length === 0} className="w-full">{busy ? t('loading') : t('createAccount')}</Button>
          </form>
        )}
      </div>
    </PublicShell>
  );
}
