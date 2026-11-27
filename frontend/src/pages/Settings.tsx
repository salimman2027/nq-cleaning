import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { useI18n } from '../i18n';
import { Button, ErrorBox, Field, Input } from '../ui';

export default function Settings() {
  const { t } = useI18n();
  const { can } = useAuth();
  const [logo, setLogo] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => { api<{ logoUrl: string | null }>('/platform/brand').then((r) => setLogo(r.logoUrl ?? '')).catch(() => setError('Error')); }, []);
  const save = async (value: string | null) => {
    setError(''); setMsg('');
    try { await api('/platform/brand', { method: 'PUT', body: { logoUrl: value } }); if (!value) setLogo(''); setMsg(t('saved')); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Error'); }
  };
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h1 className="text-xl font-bold">{t('settings')}</h1>
      {error && <ErrorBox message={error} />}
      {msg && <p className="text-sm text-green-700">{msg}</p>}
      <div className="space-y-3 rounded-2xl bg-white p-4 shadow dark:bg-slate-900">
        <Field label={t('logoUrl')}><Input dir="ltr" placeholder="https://…" value={logo} onChange={(e) => setLogo(e.target.value)} disabled={!can('platform.brand.manage')} /></Field>
        {logo && <img src={logo} alt="" className="h-12 w-auto" />}
        {can('platform.brand.manage') && (
          <div className="flex gap-2"><Button onClick={() => save(logo.trim() || null)}>{t('save')}</Button><Button variant="ghost" onClick={() => save(null)}>{t('removeLogo')}</Button></div>
        )}
      </div>
    </div>
  );
}
