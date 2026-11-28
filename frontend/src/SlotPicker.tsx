import { useEffect, useState } from 'react';
import { api } from './api';
import { useI18n } from './i18n';

export interface Slot { time: string; end: string; available: boolean }

/** Time slots the company offers on the chosen day; full ones are shown but cannot be picked. */
export function SlotPicker({ slug, date, value, onChange, serviceIds = [] }: { slug: string; date: string; value: string; onChange: (time: string) => void; serviceIds?: number[] }) {
  const { t } = useI18n();
  const [slots, setSlots] = useState<Slot[] | null>(null);
  useEffect(() => {
    setSlots(null);
    if (!slug || !date) return;
    api<{ slots: Slot[] }>(`/market/companies/${slug}/slots?date=${date}${serviceIds.length ? `&services=${serviceIds.join(',')}` : ''}`).then((r) => { setSlots(r.slots); if (!r.slots.some((s) => s.time === value && s.available)) onChange(''); }).catch(() => setSlots([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, date, serviceIds.join(',')]);
  if (!date) return <p className="text-sm text-slate-500">{t('pickDateFirst')}</p>;
  if (!slots) return <p className="text-sm text-slate-500">{t('loading')}</p>;
  if (slots.length === 0) return <p className="text-sm text-amber-600">{t('noSlotsDay')}</p>;
  return (
    <div role="radiogroup" aria-label={t('period')} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {slots.map((s) => (
        <button key={s.time} type="button" role="radio" aria-checked={value === s.time} disabled={!s.available} onClick={() => onChange(s.time)}
          className={`rounded-xl border px-2 py-2 text-sm tabular-nums ${value === s.time ? 'border-cyan-700 bg-cyan-700 text-white' : 'border-slate-300 dark:border-slate-600'} disabled:cursor-not-allowed disabled:opacity-40 disabled:line-through`}>
          <span dir="ltr">{s.time} – {s.end}</span>{!s.available && <span className="block text-[10px] no-underline">{t('slotFull')}</span>}
        </button>
      ))}
    </div>
  );
}
