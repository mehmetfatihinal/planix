import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { login as loginRequest, me, refreshAuth, register as registerRequest } from "@/lib/api";
import { getToken, removeToken, setToken } from "@/lib/storage";
import type { AuthUser } from "@/types/business";

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setTokenState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    getToken()
      .then(async (storedToken) => {
        if (!storedToken) {
          return;
        }

        const currentUser = await me(storedToken);
        if (mounted) {
          setTokenState(storedToken);
          setUser(currentUser);
        }
      })
      .catch(async () => {
        await removeToken();
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const response = await refreshAuth(token);
      await setToken(response.token);
      setTokenState(response.token);
      setUser(response.user);
    } catch {
      try {
        const fresh = await me(token);
        setUser(fresh);
      } catch {
        // ignore — next 401 will trigger logout elsewhere
      }
    }
  }, [token]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      loading,
      login: async (email, password) => {
        const response = await loginRequest(email, password);
        await setToken(response.token);
        setTokenState(response.token);
        setUser(response.user);
      },
      register: async (name, email, password) => {
        const response = await registerRequest(name, email, password);
        await setToken(response.token);
        setTokenState(response.token);
        setUser(response.user);
      },
      logout: async () => {
        await removeToken();
        setTokenState(null);
        setUser(null);
      },
      refresh
    }),
    [loading, refresh, token, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
