const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';
const KEY = 'nq.tokens';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

interface Tokens { accessToken: string; refreshToken: string }

/** "Remember me": keep the session in this browser (default) or only until the tab closes. */
const RKEY = 'nq.remember';
export const getRemember = (): boolean => { try { return localStorage.getItem(RKEY) !== '0'; } catch { return true; } };
export function setRemember(v: boolean): void { try { localStorage.setItem(RKEY, v ? '1' : '0'); } catch { /* ignore */ } }
const store = (): Storage => (getRemember() ? localStorage : sessionStorage);
const getItem = (k: string): string | null => { try { return localStorage.getItem(k) ?? sessionStorage.getItem(k); } catch { return null; } };
const clearItem = (k: string): void => { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch { /* ignore */ } };

function read(): Tokens | null {
  try {
    const v = getItem(KEY);
    return v ? (JSON.parse(v) as Tokens) : null;
  } catch {
    return null;
  }
}
export function saveTokens(t: Tokens | null): void {
  try {
    if (t) { const had = localStorage.getItem(KEY) !== null; (had ? localStorage : store()).setItem(KEY, JSON.stringify(t)); } else clearItem(KEY);
  } catch {
    /* storage unavailable: session lasts until reload */
  }
}
export const hasTokens = (): boolean => read() !== null;

let refreshing: Promise<boolean> | null = null;
function refresh(): Promise<boolean> {
  refreshing ??= (async () => {
    const t = read();
    if (!t) return false;
    const r = await fetch(`${BASE}/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: t.refreshToken }) });
    if (!r.ok) {
      saveTokens(null);
      return false;
    }
    saveTokens((await r.json()) as Tokens);
    return true;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

const CKEY = 'nq.customer';
export const customerToken = (): string | null => getItem(CKEY);
export function saveCustomerToken(t: string | null): void { try { clearItem(CKEY); if (t) store().setItem(CKEY, t); } catch { /* ignore */ } }

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; customer?: boolean } = {}, retry = true): Promise<T> {
  const ct = opts.customer ? customerToken() : null;
  const t = opts.customer ? null : read();
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: opts.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', ...(ct ? { Authorization: `Bearer ${ct}` } : t ? { Authorization: `Bearer ${t.accessToken}` } : {}) },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Network error');
  }
  if (res.status === 401 && retry && t && (await refresh())) return api<T>(path, opts, false);
  if (res.status === 401 && ct) window.dispatchEvent(new Event('nq:customer-logout'));
  if (res.status === 401 && t) window.dispatchEvent(new Event('nq:logout'));
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = (data as { error?: { code?: string; message?: string; details?: unknown } }).error;
    throw new ApiError(res.status, e?.code ?? 'ERROR', e?.message ?? res.statusText, e?.details);
  }
  return data as T;
}

/** Fetch a protected file (needs the bearer token, so it cannot be a plain link) and open it in a new tab. */
export async function openFile(path: string): Promise<void> {
  const t = read();
  const res = await fetch(`${BASE}${path}`, { headers: t ? { Authorization: `Bearer ${t.accessToken}` } : {} });
  if (!res.ok) throw new ApiError(res.status, 'ERROR', res.statusText);
  const url = URL.createObjectURL(await res.blob());
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function fileToBase64(f: File): Promise<string> {
  return new Promise((ok, bad) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1] ?? '');
    r.onerror = () => bad(new Error('read'));
    r.readAsDataURL(f);
  });
}
