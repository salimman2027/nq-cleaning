import { useI18n } from './i18n';

export interface ServiceArea { city: string; districts: string[] }

/** City then district, limited to the areas a company serves. Shows nothing for a company that has not set areas yet. */
export function AreaSelect({ areas, city, district, onChange, className = '' }: { areas: ServiceArea[] | undefined; city: string; district: string; onChange: (city: string, district: string) => void; className?: string }) {
  const { t } = useI18n();
  if (!areas || areas.length === 0) return null;
  const cur = areas.find((a) => a.city === city);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <select required className={className} value={city} onChange={(e) => onChange(e.target.value, '')} aria-label={t('city')}>
        <option value="">{t('pickCity')}</option>
        {areas.map((a) => <option key={a.city} value={a.city}>{a.city}</option>)}
      </select>
      {cur && cur.districts.length > 0 ? (
        <select required className={className} value={district} onChange={(e) => onChange(city, e.target.value)} aria-label={t('district')}>
          <option value="">{t('pickDistrict')}</option>
          {cur.districts.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      ) : <div />}
    </div>
  );
}
