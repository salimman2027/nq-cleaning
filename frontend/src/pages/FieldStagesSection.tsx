import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { useI18n, type Key } from '../i18n';
import { Button, ErrorBox } from '../ui';

interface Rule { stage: string; noteReq: boolean; photoReq: boolean; videoReq: boolean }

/** What the supervisor must provide at each stage of a job: note, photo, video. Everything else stays optional. */
export default function FieldStagesSection() {
  const { t } = useI18n();
  const { can } = useAuth();
  const [rows, setRows] = useState<Rule[] | null>(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const edit = can('technicians.manage');
  useEffect(() => { if (edit) api<{ items: Rule[] }>('/company/field-stages').then((r) => setRows(r.items)).catch(() => setErr('Error')); }, [edit]);
  if (!edit || !rows) return null;
  const flip = (stage: string, k: 'noteReq' | 'photoReq' | 'videoReq') => setRows(rows.map((r) => (r.stage === stage ? { ...r, [k]: !r[k] } : r)));
  const save = async () => { setErr(''); setMsg(''); try { setRows((await api<{ items: Rule[] }>('/company/field-stages', { method: 'PUT', body: { items: rows } })).items); setMsg(t('saved')); } catch { setErr('Error'); } };
  return (
    <section className="space-y-3 rounded-2xl bg-white p-4 shadow dark:bg-slate-900">
      <div><h2 className="font-semibold">{t('fieldStages')}</h2><p className="text-xs text-slate-500">{t('fieldStagesHint')}</p></div>
      {err && <ErrorBox message={err} />}
      {msg && <p className="text-sm text-green-700">{msg}</p>}
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead className="text-slate-500"><tr><th className="p-2 text-start" /><th className="p-2">{t('reqNote')}</th><th className="p-2">{t('reqPhoto')}</th><th className="p-2">{t('reqVideo')}</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.stage} className="border-t border-slate-100 dark:border-slate-800">
            <td className="p-2">{t(`st_${r.stage}` as Key)}</td>
            {(['noteReq', 'photoReq', 'videoReq'] as const).map((k) => <td key={k} className="p-2 text-center"><input type="checkbox" checked={r[k]} onChange={() => flip(r.stage, k)} aria-label={`${r.stage} ${k}`} /></td>)}
          </tr>))}</tbody>
      </table></div>
      <Button onClick={() => void save()}>{t('save')}</Button>
    </section>
  );
}
