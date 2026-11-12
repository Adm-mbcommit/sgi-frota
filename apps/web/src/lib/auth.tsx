import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, tokenStore } from './api';

export type Role = 'ADMIN' | 'GESTOR' | 'MOTORISTA' | 'LEITOR';
export interface Me { user: { id: string; name: string; email: string; role: Role }; organization: { id: string; name: string } }

interface Ctx { me: Me | null; loading: boolean; login: (email: string, password: string) => Promise<void>; logout: () => void; can: (...r: Role[]) => boolean }
const AuthCtx = createContext<Ctx>(null as never);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(!!tokenStore.get());
  const load = () => api<Me>('/auth/me').then(setMe).catch(() => setMe(null)).finally(() => setLoading(false));
  useEffect(() => {
    if (tokenStore.get()) load();
    const out = () => setMe(null);
    window.addEventListener('sgi:logout', out);
    return () => window.removeEventListener('sgi:logout', out);
  }, []);
  const value: Ctx = {
    me, loading,
    login: async (email, password) => {
      const r = await api<{ token: string }>('/auth/login', { method: 'POST', json: { email, password } });
      tokenStore.set(r.token); setLoading(true); await load();
    },
    logout: () => { tokenStore.set(null); setMe(null); },
    can: (...r) => !!me && r.includes(me.user.role),
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
export const useAuth = () => useContext(AuthCtx);
/** Perfis que alteram cadastros e registros de gestão. */
export const WRITE: Role[] = ['ADMIN', 'GESTOR'];
