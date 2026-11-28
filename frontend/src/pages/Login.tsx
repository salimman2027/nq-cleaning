import { LogoMark } from '../Logo';
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { useI18n } from '../i18n';
import { Button, ErrorBox, Field, Input, PasswordInput } from '../ui';
import { Remember } from '../Remember';

export default function Login() {
  const { login } = useAuth();
  const { t, toggle } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [forgot, setForgot] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { adopt } = useAuth();
  const [mode, setMode] = useState<'email' | 'phone'>('email');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState('');
  const [phoneLogin, setPhoneLogin] = useState(false);
  useEffect(() => { api<{ phoneVerification: boolean }>('/market/config').then((r) => setPhoneLogin(r.phoneVerification)).catch(() => undefined); }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'phone') {
        if (!sent) {
          const r = await api<{ devCode?: string }>('/auth/otp/request', { method: 'POST', body: { phone } });
          setDevCode(r.devCode ?? '');
          setSent(true);
        } else {
          await adopt(await api<{ accessToken: string; refreshToken: string }>('/auth/otp/verify', { method: 'POST', body: { phone, code: otp } }));
        }
        return;
      }
      await login(email.trim(), password);
    } catch (err) {
      setError(err instanceof ApiError ? (err.code === 'BAD_CREDENTIALS' ? t('badCreds') : err.message) : 'Error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-full lg:grid-cols-2 dark:bg-slate-950 dark:text-slate-100">
      <aside className="lattice hidden flex-col justify-between bg-cyan-900 p-10 text-white lg:flex">
        <Link to="/" className="flex items-center gap-2.5 text-lg font-bold"><LogoMark className="h-9 w-9" />{t('app')}</Link>
        <div><p className="max-w-sm text-3xl font-bold leading-snug">{t('marketTitle')}</p><p className="mt-3 max-w-sm text-white/70">{t('marketSub')}</p></div>
        <Link to="/join" className="text-sm text-white/80 hover:text-white">{t('joinAsCompany')}</Link>
      </aside>
      <div className="flex items-center justify-center bg-[#f4f6fa] p-6 dark:bg-slate-950">
        <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-bold">{t('login')}</h1>
        {mode === 'email' ? (
          <>
            <Field label={t('emailOrMobile')}><Input type="text" inputMode="email" autoCapitalize="none" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label={t('password')}><PasswordInput autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            <Remember />
          </>
        ) : (
          <>
            <Field label={`${t('mobile')} — ${t('mobileHint')}`}><Input inputMode="tel" required disabled={sent} value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
            {sent && <Field label={t('otpCode')}><Input inputMode="numeric" maxLength={6} required value={otp} onChange={(e) => setOtp(e.target.value)} /></Field>}
            {devCode && <p className="rounded bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">{t('devCodeNote')}: <b>{devCode}</b></p>}
          </>
        )}
        {error && <ErrorBox message={error} />}
        {mode === 'email' && <button type="button" onClick={() => setForgot(!forgot)} className="text-sm text-cyan-700 dark:text-cyan-400">{t('forgotPass')}</button>}
        {forgot && <p className="rise rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">{t('forgotHelp')}</p>}
        <Button type="submit" disabled={busy} className="w-full">{busy ? t('loading') : mode === 'phone' ? (sent ? t('verify') : t('sendCode')) : t('login')}</Button>
        {phoneLogin && <button type="button" onClick={() => { setMode(mode === 'email' ? 'phone' : 'email'); setSent(false); setError(''); }} className="w-full text-sm text-cyan-700 dark:text-cyan-400">{mode === 'email' ? t('signInPhone') : t('signInEmail')}</button>}
        <button type="button" onClick={toggle} className="w-full text-sm text-slate-500">{t('lang')}</button>
      </form>
      </div>
    </div>
  );
}
