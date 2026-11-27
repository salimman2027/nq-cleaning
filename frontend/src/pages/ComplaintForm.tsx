import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';
import { useI18n } from '../i18n';
import { Button, ErrorBox, Field, Input, Modal } from '../ui';

/** Complaint dialog. With `orderId` it goes through the signed-in customer's own order; otherwise it is a public form. */
export default function ComplaintForm({ slug, orderId, onClose }: { slug: string; orderId?: number; onClose: () => void }) {
  const { t } = useI18n();
  const [f, setF] = useState({ customerName: '', phone: '', message: '' });
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      if (orderId) await api(`/shop/orders/${orderId}/complaints`, { method: 'POST', customer: true, body: { message: f.message } });
      else await api(`/market/companies/${slug}/complaints`, { method: 'POST', body: f });
      setDone(true);
    } catch (ex) { setErr(ex instanceof ApiError ? t('err_VALIDATION_ERROR') : 'Error'); } finally { setBusy(false); }
  };
  return (
    <Modal title={t('complaintTitle')} onClose={onClose}>
      {done ? <div className="space-y-3 text-center"><p>{t('complaintSent')}</p><Button onClick={onClose}>{t('closeLbl')}</Button></div> : (
        <form onSubmit={submit} className="space-y-3">
          <p className="text-sm text-slate-500">{t('complaintHint')}</p>
          {err && <ErrorBox message={err} />}
          {!orderId && <>
            <Field label={t('yourName')}><Input required minLength={2} value={f.customerName} onChange={(e) => setF({ ...f, customerName: e.target.value })} /></Field>
            <Field label={t('yourPhone')}><Input required dir="ltr" inputMode="numeric" pattern="05[0-9]{8}" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          </>}
          <Field label={t('yourMessage')}><textarea required minLength={10} maxLength={1000} rows={4} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800" value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></Field>
          <Button type="submit" disabled={busy}>{t('send')}</Button>
        </form>
      )}
    </Modal>
  );
}
