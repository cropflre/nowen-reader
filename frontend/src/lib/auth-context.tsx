"use client";

import { apiClient } from "@/lib/apiClient";
import { setUserScope } from "@/hooks/useComicList";
import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

interface AuthUser {
  id: string;
  username: string;
  nickname: string;
  role: string;
  aiEnabled: boolean;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  needsSetup: boolean;
  registrationMode: string;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, nickname?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [registrationMode, setRegistrationMode] = useState("open");

  const refreshUser = useCallback(async () => {
    try {
        const data = await apiClient.get("/api/auth/me");
        const d = data as any;
        const u = d.user || null;
        setUser(u);
        // 同步用户作用域到漫画列表缓存
        if (u) {
          setUserScope(u.id, u.role);
        } else {
          setUserScope("", "");
        }
        setNeedsSetup(d.needsSetup || false);
        if (d.registrationMode) setRegistrationMode(d.registrationMode);
      } catch (err: any) {
        // Only clear user on genuine 401 (session expired / not logged in).
        // Network errors (status=0), timeouts, and 5xx should NOT log the user out,
        // as these are transient and the session cookie is still valid.
        if (err?.status === 401) {
          setUser(null);
          setUserScope("", "");
        } else {
          console.warn("[Auth] /api/auth/me failed with status", err?.status, "— preserving current state");
        }
      } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const login = async (username: string, password: string) => {
    const data = await apiClient.post("/api/auth/login", { username, password }) as any;
    const u = data.user;
    setUser(u);
    if (u) setUserScope(u.id, u.role);
    setNeedsSetup(false);
  };

  const register = async (username: string, password: string, nickname?: string) => {
    const data = await apiClient.post("/api/auth/register", { username, password, nickname }) as any;
    const u = data.user;
    setUser(u);
    if (u) setUserScope(u.id, u.role);
    setNeedsSetup(false);
  };

  const logout = async () => {
    try { await apiClient.post("/api/auth/logout"); } catch { /* ignore */ }
    setUser(null);
    setUserScope("", "");
  };

  return (
    <AuthContext.Provider value={{ user, loading, needsSetup, registrationMode, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
