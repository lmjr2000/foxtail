import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { canManage, isCorporate, type Role } from '@foxtail/shared';
import { apiFetch, apiPost, getToken, setToken, setUnauthorizedHandler, type SessionUser } from './api';

const DEMO_KEY = 'foxtail_demo';
function getDemoFlag(): boolean { try { return localStorage.getItem(DEMO_KEY) === '1'; } catch { return false; } }
function setDemoFlag(v: boolean): void { try { if (v) localStorage.setItem(DEMO_KEY, '1'); else localStorage.removeItem(DEMO_KEY); } catch { /* blocked */ } }

interface AuthState {
  user: SessionUser | null;
  ready: boolean;
  isDemo: boolean;
  isCorporate: boolean;
  canManage: boolean;
  signIn: (token: string, user: SessionUser, demo?: boolean) => void;
  signOut: () => void;
  login: (email: string, password: string) => Promise<SessionUser>;
  demoLogin: (role: Role) => Promise<SessionUser>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);
  const [isDemo, setIsDemo] = useState(false);

  const signOut = useCallback(() => { setToken(null); setDemoFlag(false); setUser(null); setIsDemo(false); }, []);
  const signIn = useCallback((token: string, u: SessionUser, demo = false) => { setToken(token); setDemoFlag(demo); setUser(u); setIsDemo(demo); }, []);

  useEffect(() => {
    setUnauthorizedHandler(signOut);
    if (!getToken()) { setReady(true); return; }
    const wasDemo = getDemoFlag();
    apiFetch<SessionUser>('/auth/me')
      .then(r => { setUser(r); setIsDemo(wasDemo); })
      .catch(() => { setToken(null); setDemoFlag(false); })
      .finally(() => setReady(true));
  }, [signOut]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await apiPost<{ token: string; user: SessionUser }>('/auth/login', { email, password });
    signIn(r.token, r.user, false);
    return r.user;
  }, [signIn]);

  const demoLogin = useCallback(async (role: Role) => {
    const r = await apiPost<{ token: string; user: SessionUser }>('/foxtail/auth/demo', { role });
    signIn(r.token, r.user, true);
    return r.user;
  }, [signIn]);

  const value = useMemo<AuthState>(() => ({
    user, ready, isDemo, signIn, signOut, login, demoLogin,
    isCorporate: !!user && isCorporate(user.role),
    canManage: !!user && canManage(user.role),
  }), [user, ready, isDemo, signIn, signOut, login, demoLogin]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
