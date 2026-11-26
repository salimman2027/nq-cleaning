const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';
const KEY = 'nq.tokens';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

interface Tokens { accessToken: string; refreshToken: string }

function read(): Tokens | null {
  try {
    const v = localStorage.getItem(KEY);
    return v ? (JSON.parse(v) as Tokens) : null;
  } catch {
    return null;
  }
}
export function saveTokens(t: Tokens | null): void {
  try {
    if (t) localStorage.setItem(KEY, JSON.stringify(t));
    else localStorage.removeItem(KEY);
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

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}, retry = true): Promise<T> {
  const t = read();
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: opts.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t.accessToken}` } : {}) },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Network error');
  }
  if (res.status === 401 && retry && t && (await refresh())) return api<T>(path, opts, false);
  if (res.status === 401 && t) window.dispatchEvent(new Event('nq:logout'));
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = (data as { error?: { code?: string; message?: string; details?: unknown } }).error;
    throw new ApiError(res.status, e?.code ?? 'ERROR', e?.message ?? res.statusText, e?.details);
  }
  return data as T;
}
