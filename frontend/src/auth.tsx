import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, hasTokens, saveTokens } from './api';

export interface Me { Id: number; FullName: string; Email: string; BranchId: number | null; perms: string[] }
interface Ctx { me: Me | null; ready: boolean; login: (email: string, password: string) => Promise<void>; logout: () => Promise<void>; can: (p: string) => boolean }
const AuthCtx = createContext<Ctx>(null as unknown as Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (hasTokens()) {
        try { const m = await api<Me>('/auth/me'); if (alive) setMe(m); } catch { saveTokens(null); }
      }
      if (alive) setReady(true);
    })();
    const onOut = () => { saveTokens(null); setMe(null); };
    window.addEventListener('nq:logout', onOut);
    return () => { alive = false; window.removeEventListener('nq:logout', onOut); };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api<{ accessToken: string; refreshToken: string }>('/auth/login', { method: 'POST', body: { email, password } });
    saveTokens({ accessToken: r.accessToken, refreshToken: r.refreshToken });
    setMe(await api<Me>('/auth/me'));
  }, []);

  const logout = useCallback(async () => {
    try {
      const raw = localStorage.getItem('nq.tokens');
      if (raw) await api('/auth/logout', { method: 'POST', body: { refreshToken: (JSON.parse(raw) as { refreshToken: string }).refreshToken } });
    } catch { /* best effort */ }
    saveTokens(null);
    setMe(null);
  }, []);

  const value = useMemo<Ctx>(() => ({ me, ready, login, logout, can: (p) => !!me?.perms.includes(p) }), [me, ready, login, logout]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = (): Ctx => useContext(AuthCtx);
