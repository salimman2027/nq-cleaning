import { useState, type FormEvent } from 'react';
import { ApiError } from '../api';
import { useAuth } from '../auth';
import { useI18n } from '../i18n';
import { Button, ErrorBox, Field, Input } from '../ui';

export default function Login() {
  const { login } = useAuth();
  const { t, toggle } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-slate-50 p-4 dark:bg-slate-950 dark:text-slate-100">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 shadow dark:bg-slate-900">
        <h1 className="text-center text-2xl font-bold text-cyan-700 dark:text-cyan-400">{t('app')}</h1>
        <Field label={t('email')}><Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label={t('password')}><Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {error && <ErrorBox message={error} />}
        <Button type="submit" disabled={busy} className="w-full">{busy ? t('loading') : t('login')}</Button>
        <button type="button" onClick={toggle} className="w-full text-sm text-slate-500">{t('lang')}</button>
      </form>
    </div>
  );
}
