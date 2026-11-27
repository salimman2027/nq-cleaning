import { useState } from 'react';
import { getRemember, setRemember } from './api';
import { useI18n } from './i18n';

export function Remember() {
  const { t } = useI18n();
  const [v, setV] = useState(getRemember());
  return <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v} onChange={(e) => { setV(e.target.checked); setRemember(e.target.checked); }} />{t('rememberMe')}</label>;
}
