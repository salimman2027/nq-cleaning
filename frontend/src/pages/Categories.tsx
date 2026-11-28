import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { useI18n } from '../i18n';
import { Button, ErrorBox, Field, ImageUpload, Input, Modal, Skeleton } from '../ui';

interface Cat { Name: string; ImageUrl: string | null; Services: number; SectorId: number | null }
interface Sector { Id: number; Name: string }
interface Starter { ar: string; en: string; sections: { ar: string; en: string; services: { ar: string; en: string }[] }[] }

/** Sections of the storefront: each one has a name and a picture; services are placed in a section from the service form. */
export default function Categories() {
  const { t, lang } = useI18n();
  const { can } = useAuth();
  const [rows, setRows] = useState<Cat[] | null>(null);
  const [name, setName] = useState('');
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [starter, setStarter] = useState<Starter[]>([]);
  const [secName, setSecName] = useState('');
  const [sug, setSug] = useState<{ cat: string; name: string } | null>(null);
  const [price, setPrice] = useState('');
  const [err, setErr] = useState('');
  const manage = can('services.manage');
  const load = useCallback(() => { api<{ items: Cat[] }>('/services/categories').then((r) => setRows(r.items)).catch(() => setErr('Error')); }, []);
  const loadSectors = useCallback(() => { api<{ items: Sector[]; starter: Starter[] }>('/services/sectors').then((r) => { setSectors(r.items); setStarter(r.starter); }).catch(() => setErr('Error')); }, []);
  useEffect(load, [load]);
  useEffect(loadSectors, [loadSectors]);
  const both = () => { load(); loadSectors(); };
  const addSector = async (e: FormEvent) => {
    e.preventDefault(); if (secName.trim().length < 2) { setErr(t('categoryShort')); return; }
    setErr(''); try { await api('/services/sectors', { method: 'POST', body: { name: secName.trim() } }); setSecName(''); both(); } catch (x) { setErr(x instanceof ApiError && x.code === 'SECTOR_EXISTS' ? t('categoryExists') : 'Error'); }
  };
  const renameSector = async (s: Sector) => {
    const to = window.prompt(t('renameSector'), s.Name)?.trim(); if (!to || to === s.Name) return;
    setErr(''); try { await api(`/services/sectors/${s.Id}`, { method: 'PATCH', body: { name: to } }); both(); } catch (x) { setErr(x instanceof ApiError && x.code === 'SECTOR_EXISTS' ? t('categoryExists') : 'Error'); }
  };
  const removeSector = async (s: Sector) => {
    if (!window.confirm(`${t('deleteSectorQ')} ${s.Name}`)) return;
    setErr(''); try { await api(`/services/sectors/${s.Id}`, { method: 'DELETE' }); both(); } catch { setErr('Error'); }
  };
  const moveTo = async (c: Cat, v: string) => { setErr(''); try { await api('/services/categories/sector', { method: 'PUT', body: { name: c.Name, sectorId: v ? Number(v) : null } }); load(); } catch { setErr('Error'); } };
  const applyStarter = async () => { setErr(''); try { await api('/services/sectors/starter', { method: 'POST' }); both(); } catch { setErr('Error'); } };
  const addSuggested = async (e: FormEvent) => {
    e.preventDefault(); if (!sug) return; const p = Number(price);
    if (!Number.isFinite(p) || p <= 0) { setErr(t('needAmount')); return; }
    setErr(''); try { await api('/services', { method: 'POST', body: { name: sug.name, pricingMethod: 'fixed', defaultMinutes: 60, defaultTechnicians: 1, price: p, unit: 'unit', category: sug.cat } }); setSug(null); setPrice(''); load(); } catch { setErr('Error'); }
  };
  const suggestionsFor = (cat: string) => starter.flatMap((x) => x.sections).find((x) => x.ar === cat)?.services ?? [];
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
      {manage && (
        <div className="space-y-2 rounded-2xl bg-white p-4 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{t('sectorsTitle')}</h2>{sectors.length === 0 && <Button variant="ghost" onClick={() => void applyStarter()}>{t('applyStarter')}</Button>}</div>
          <p className="text-xs text-slate-500">{t('sectorsHint')}</p>
          <form onSubmit={addSector} className="flex max-w-md gap-2"><Input placeholder={t('newSectorPh')} value={secName} onChange={(e) => setSecName(e.target.value)} /><Button type="submit">+ {t('addSector')}</Button></form>
        </div>
      )}
      {!rows ? <Skeleton rows={3} /> : rows.length === 0 ? <p className="py-8 text-center text-slate-500">{t('noData')}</p> : (
        <div className="space-y-6">
          {[...sectors.map((x) => ({ sector: x as Sector | null, list: rows.filter((c) => c.SectorId === x.Id) })), { sector: null as Sector | null, list: rows.filter((c) => !c.SectorId || !sectors.some((x) => x.Id === c.SectorId)) }]
            .filter((g) => g.sector || g.list.length > 0).map((g) => (
            <section key={g.sector?.Id ?? 'none'} className="space-y-3">
              <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-2 dark:border-slate-700">
                <h2 className="text-lg font-bold">{g.sector ? g.sector.Name : t('noSector')} <span className="text-xs font-normal text-slate-500">({g.list.length})</span></h2>
                {manage && g.sector && <div className="flex gap-4 text-sm font-medium"><button type="button" onClick={() => void renameSector(g.sector!)} className="text-cyan-700 hover:underline">{t('renameCategory')}</button><button type="button" onClick={() => void removeSector(g.sector!)} className="text-red-600 hover:underline">{t('deleteCategory')}</button></div>}
              </div>
              {g.list.length === 0 && <p className="text-sm text-slate-500">{t('sectorEmpty')}</p>}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {g.list.map((c) => {
                  const sugg = suggestionsFor(c.Name);
                  return (
                    <div key={c.Name} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
                      <div className="lattice mb-3 h-32 overflow-hidden rounded-xl bg-cyan-800" style={c.ImageUrl ? { background: `url("${c.ImageUrl}") center/cover` } : undefined} />
                      <div className="mb-3 flex items-baseline justify-between"><span className="font-semibold">{c.Name}</span><span className="text-xs text-slate-500">{c.Services} {t('servicesCount')}</span></div>
                      {manage && <ImageUpload value={c.ImageUrl ?? ''} onChange={(u) => void save(c.Name, u)} />}
                      {manage && sectors.length > 0 && (
                        <label className="mt-3 block text-xs text-slate-500">{t('sector')}
                          <select value={c.SectorId ?? ''} onChange={(e) => void moveTo(c, e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                            <option value="">{t('noSector')}</option>
                            {sectors.map((x) => <option key={x.Id} value={x.Id}>{x.Name}</option>)}
                          </select>
                        </label>
                      )}
                      {manage && sugg.length > 0 && (
                        <div className="mt-3"><div className="mb-1 text-xs text-slate-500">{t('suggestedServices')}</div>
                          <div className="flex flex-wrap gap-1.5">{sugg.map((x) => <button key={x.ar} type="button" onClick={() => { setSug({ cat: c.Name, name: lang === 'ar' ? x.ar : x.en }); setPrice(''); }} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs hover:bg-cyan-50 hover:text-cyan-800 dark:bg-slate-800">+ {lang === 'ar' ? x.ar : x.en}</button>)}</div></div>
                      )}
                      {manage && <div className="mt-3 flex gap-4 text-sm font-medium"><button type="button" onClick={() => void rename(c)} className="text-cyan-700 hover:underline">{t('renameCategory')}</button><button type="button" onClick={() => void remove(c)} className="text-red-600 hover:underline">{t('deleteCategory')}</button></div>}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
      {sug && (
        <Modal onClose={() => setSug(null)} title={sug.name}>
          <form onSubmit={addSuggested} className="space-y-3">
            <p className="text-sm text-slate-500">{t('suggestedAddHint')}</p>
            <Field label={t('price')}><Input type="number" min={1} dir="ltr" autoFocus value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
            <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setSug(null)}>{t('cancel')}</Button><Button type="submit">{t('add')}</Button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}
