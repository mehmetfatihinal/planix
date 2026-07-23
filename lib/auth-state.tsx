"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiRequest, type AuthResponse, type AuthUser } from "@/lib/api-client";

const TOKEN_KEY = "arx-task:auth-token";

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  /**
   * Fetches a fresh JWT — used after a promote/demote so the new is_admin claim
   * lands on the next request without forcing the user to log out.
   */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const storedToken = localStorage.getItem(TOKEN_KEY);
    if (!storedToken) {
      setLoading(false);
      return;
    }

    setToken(storedToken);
    apiRequest<AuthUser>("/auth/me", {}, storedToken)
      .then(setUser)
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const applyAuth = useCallback((response: AuthResponse) => {
    localStorage.setItem(TOKEN_KEY, response.token);
    setToken(response.token);
    setUser(response.user);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const response = await apiRequest<AuthResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password })
      });
      applyAuth(response);
    },
    [applyAuth]
  );

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      const response = await apiRequest<AuthResponse>("/auth/register", {
        method: "POST",
        body: JSON.stringify({ name, email, password })
      });
      applyAuth(response);
    },
    [applyAuth]
  );

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const response = await apiRequest<AuthResponse>("/auth/refresh", { method: "POST" }, token);
      applyAuth(response);
    } catch {
      // If refresh fails, fall back to /auth/me so at least the user object stays current
      try {
        const me = await apiRequest<AuthUser>("/auth/me", {}, token);
        setUser(me);
      } catch {
        // ignore — let the next 401 trigger logout elsewhere
      }
    }
  }, [applyAuth, token]);

  const value = useMemo(
    () => ({ user, token, loading, login, register, logout, refresh }),
    [loading, login, logout, refresh, register, token, user]
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
