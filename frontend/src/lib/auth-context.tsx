"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

interface AuthUser {
  id: string;
  username: string;
  nickname: string;
  role: string;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  needsSetup: boolean;
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

  const refreshUser = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me");
      if (!res.ok) {
        // 服务端错误（如数据库临时锁定），保持当前状态，不清空 user
        if (res.status >= 500) {
          console.warn("[Auth] /api/auth/me returned", res.status, "— keeping current state");
          return;
        }
        // 4xx 错误，视为未认证
        setUser(null);
        return;
      }
      const data = await res.json();
      setUser(data.user || null);
      setNeedsSetup(data.needsSetup || false);
    } catch {
      // 网络错误，不清空 user（可能只是暂时连接问题）
      console.warn("[Auth] Failed to reach /api/auth/me — keeping current state");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const login = async (username: string, password: string) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Login failed");
    setUser(data.user);
    setNeedsSetup(false);
  };

  const register = async (username: string, password: string, nickname?: string) => {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, nickname }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Registration failed");
    setUser(data.user);
    setNeedsSetup(false);
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, needsSetup, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
