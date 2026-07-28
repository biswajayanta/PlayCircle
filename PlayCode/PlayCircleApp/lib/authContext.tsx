import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';

import { api, setApiToken, setUnauthorizedHandler } from './api';
import { clearStoredToken, getStoredToken, setStoredToken } from './tokenStore';
import { UserMe } from './types';

interface TokenResponse {
  access_token: string;
  token_type: string;
  user: UserMe;
}

interface AuthContextValue {
  user: UserMe | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (
    email: string,
    password: string,
    displayName: string,
    city?: string
  ) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserMe | null>(null);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(async () => {
    await clearStoredToken();
    setApiToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      logout();
    });
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  useEffect(() => {
    (async () => {
      const token = await getStoredToken();
      if (token) {
        setApiToken(token);
        try {
          const me = await api.get<UserMe>('/me');
          setUser(me);
        } catch {
          // Token is invalid/expired — clear it and fall through to logged-out state.
          await clearStoredToken();
          setApiToken(null);
        }
      }
      setLoading(false);
    })();
  }, []);

  async function login(email: string, password: string) {
    const result = await api.post<TokenResponse>('/auth/login', { email, password });
    await setStoredToken(result.access_token);
    setApiToken(result.access_token);
    setUser(result.user);
  }

  async function signup(email: string, password: string, displayName: string, city?: string) {
    const result = await api.post<TokenResponse>('/auth/signup', {
      email,
      password,
      display_name: displayName,
      city,
    });
    await setStoredToken(result.access_token);
    setApiToken(result.access_token);
    setUser(result.user);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
