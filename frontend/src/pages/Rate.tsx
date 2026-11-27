import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useI18n } from '../i18n';
import { Button, ErrorBox } from '../ui';
import { PublicShell } from './Home';

interface Info { company: string; services: string | null; rated: boolean; stars: number | null }

export default function Rate() {
  const { t } = useI18n();
  const { token } = useParams();
  const [info, setInfo] = useState<Info | null>(null);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { api<Info>(`/market/ratings/${token}`).then(setInfo).catch(() => setError(t('rateInvalid'))); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = async () => {
    setError('');
    try { await api(`/market/ratings/${token}`, { method: 'POST', body: { stars, comment: comment.trim() || undefined } }); setDone(true); }
    catch (e) { if (e instanceof ApiError && e.status === 409) setDone(true); else setError(e instanceof ApiError ? e.message : 'Error'); }
  };
  return (
    <PublicShell>
      <div className="mx-auto max-w-md space-y-4 px-4 py-10 text-center">
        {error && <ErrorBox message={error} />}
        {info && (done || info.rated ? <p className="text-lg font-semibold">{info.rated && !done ? t('rateAlready') : t('rateThanks')}</p> : (
          <>
            <h1 className="text-xl font-bold">{t('rateTitle')}</h1>
            <p className="text-slate-600 dark:text-slate-300">{info.company}{info.services ? ` - ${info.services}` : ''}</p>
            <div className="flex justify-center gap-1" dir="ltr">{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" aria-label={`${n}`} onClick={() => setStars(n)} className={`text-4xl ${n <= stars ? 'text-amber-500' : 'text-slate-300'}`}>★</button>)}</div>
            <textarea rows={3} maxLength={500} placeholder={t('rateComment')} className="w-full rounded-xl border border-slate-300 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-900" value={comment} onChange={(e) => setComment(e.target.value)} />
            <Button disabled={stars === 0} onClick={send} className="w-full">{t('rateSubmit')}</Button>
          </>
        ))}
      </div>
    </PublicShell>
  );
}
