import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, tokens } from '../api/client';
import { registerForPush, unregisterPush } from '../services/push';

export interface Me {
  id: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
  avatarFallback: string | null;
  /** RN-01 — decide entre vitrine do clube e redirecionamento ao site. */
  isSubscriber: boolean;
  storeUrl: string;
  subscription: {
    planName: string;
    rebatePercent: number;
    rebateMode: 'CREDIT_NEXT_INVOICE' | 'IMMEDIATE_DISCOUNT';
    currentPeriodEnd: string;
  } | null;
}

interface AuthState {
  user: Me | null;
  loading: boolean;
  signIn: (identifier: string, password: string) => Promise<void>;
  signUp: (payload: Record<string, unknown>) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await api.get<Me>('/users/me');
      setUser(me);
      // Registra o aparelho a cada sessão: o token do Expo pode mudar e é assim
      // que ele volta a ficar ativo depois de um logout.
      void registerForPush();
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const { accessToken } = await tokens.get();
      if (accessToken) await refresh();
      setLoading(false);
    })();
  }, [refresh]);

  const signIn = useCallback(
    async (identifier: string, password: string) => {
      const session = await api.post<{ accessToken: string; refreshToken: string }>('/auth/signin', {
        identifier,
        password,
      });
      await tokens.save(session.accessToken, session.refreshToken);
      await refresh();
    },
    [refresh],
  );

  const signUp = useCallback(
    async (payload: Record<string, unknown>) => {
      const session = await api.post<{ accessToken: string; refreshToken: string }>(
        '/auth/signup',
        payload,
      );
      await tokens.save(session.accessToken, session.refreshToken);
      await refresh();
    },
    [refresh],
  );

  const signOut = useCallback(async () => {
    // Desliga o push ANTES de derrubar o token: a chamada precisa ir autenticada.
    await unregisterPush();
    await api.post('/auth/signout').catch(() => undefined);
    await tokens.clear();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, signIn, signUp, signOut, refresh }),
    [user, loading, signIn, signUp, signOut, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth precisa estar dentro de AuthProvider');
  return context;
}
