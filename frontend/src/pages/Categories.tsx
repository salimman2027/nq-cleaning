import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { useI18n } from '../i18n';
import { Button, ErrorBox, ImageUpload, Input, Skeleton } from '../ui';

interface Cat { Name: string; ImageUrl: string | null; Services: number }

/** Sections of the storefront: each one has a name and a picture; services are placed in a section from the service form. */
export default function Categories() {
  const { t } = useI18n();
  const { can } = useAuth();
  const [rows, setRows] = useState<Cat[] | null>(null);
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const manage = can('services.manage');
  const load = useCallback(() => { api<{ items: Cat[] }>('/services/categories').then((r) => setRows(r.items)).catch(() => setErr('Error')); }, []);
  useEffect(load, [load]);
  const save = async (n: string, imageUrl: string | null) => {
    setErr('');
    try { await api('/services/categories', { method: 'PUT', body: { name: n, imageUrl: imageUrl || null } }); load(); } catch (e) { setErr(e instanceof ApiError ? t('imgFail') : 'Error'); }
  };
  const remove = async (c: Cat) => {
    if (!window.confirm(`${t('deleteCategoryQ')} ${c.Name}`)) return;
    setErr('');
    try { await api(`/services/categories?name=${encodeURIComponent(c.Name)}`, { method: 'DELETE' }); load(); }
    catch (e) { setErr(e instanceof ApiError && e.code === 'CATEGORY_IN_USE' ? t('categoryInUse') : 'Error'); }
  };
  const rename = async (c: Cat) => {
    const to = window.prompt(t('renameCategory'), c.Name)?.trim();
    if (!to || to === c.Name) return;
    setErr('');
    try { await api('/services/categories', { method: 'PATCH', body: { from: c.Name, to } }); load(); }
    catch (e) { setErr(e instanceof ApiError && e.code === 'CATEGORY_EXISTS' ? t('categoryExists') : 'Error'); }
  };
  const add = async (e: FormEvent) => { e.preventDefault(); if (name.trim().length < 2) { setErr(t('categoryShort')); return; } await save(name.trim(), null); setName(''); };
  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-bold">{t('categories')}</h1><p className="text-sm text-slate-500">{t('categoriesHint')}</p></div>
      {err && <ErrorBox message={err} />}
      {!manage && <p className="text-sm text-amber-600">{t('noManageCat')}</p>}
      {manage && (
        <form onSubmit={add} className="flex max-w-md gap-2">
          <Input placeholder={t('newCategoryPh')} value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit">+ {t('addCategory')}</Button>
        </form>
      )}
      {!rows ? <Skeleton rows={3} /> : rows.length === 0 ? <p className="py-8 text-center text-slate-500">{t('noData')}</p> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((c) => (
            <div key={c.Name} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
              <div className="lattice mb-3 h-32 overflow-hidden rounded-xl bg-cyan-800" style={c.ImageUrl ? { background: `url("${c.ImageUrl}") center/cover` } : undefined} />
              <div className="mb-3 flex items-baseline justify-between"><span className="font-semibold">{c.Name}</span><span className="text-xs text-slate-500">{c.Services} {t('servicesCount')}</span></div>
              {manage && <ImageUpload value={c.ImageUrl ?? ''} onChange={(u) => void save(c.Name, u)} />}
              {manage && <div className="mt-3 flex gap-4 text-sm font-medium"><button type="button" onClick={() => void rename(c)} className="text-cyan-700 hover:underline">{t('renameCategory')}</button><button type="button" onClick={() => void remove(c)} className="text-red-600 hover:underline">{t('deleteCategory')}</button></div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
