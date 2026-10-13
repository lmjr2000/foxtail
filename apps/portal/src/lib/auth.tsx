import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { canManage, isCorporate } from '@foxtail/shared';
import { apiFetch, apiPost, getToken, setToken, setUnauthorizedHandler, type SessionUser } from './api';

interface AuthState {
  user: SessionUser | null;
  ready: boolean;
  isCorporate: boolean;
  canManage: boolean;
  signIn: (token: string, user: SessionUser) => void;
  signOut: () => void;
  login: (email: string, password: string) => Promise<SessionUser>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

  const signOut = useCallback(() => { setToken(null); setUser(null); }, []);
  const signIn = useCallback((token: string, u: SessionUser) => { setToken(token); setUser(u); }, []);

  useEffect(() => {
    setUnauthorizedHandler(signOut);
    if (!getToken()) { setReady(true); return; }
    apiFetch<{ user: SessionUser }>('/auth/me')
      .then(r => setUser(r.user))
      .catch(() => setToken(null))
      .finally(() => setReady(true));
  }, [signOut]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await apiPost<{ token: string; user: SessionUser }>('/auth/login', { email, password });
    signIn(r.token, r.user);
    return r.user;
  }, [signIn]);

  const value = useMemo<AuthState>(() => ({
    user, ready, signIn, signOut, login,
    isCorporate: !!user && isCorporate(user.role),
    canManage: !!user && canManage(user.role),
  }), [user, ready, signIn, signOut, login]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
