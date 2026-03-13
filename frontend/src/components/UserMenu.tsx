"use client";

import React, { useState, useRef, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/lib/i18n";
import { User, LogOut, Settings, Shield } from "lucide-react";
import { SettingsModal } from "@/components/SettingsModal";

export function UserMenu() {
  const { user, logout } = useAuth();
  const t = useTranslation();
  const [open, setOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!user) return null;

  return (
    <>
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-card text-muted transition-colors"
          title={user.nickname || user.username}
        >
          <User className="w-4 h-4" />
          <span className="text-sm max-w-[80px] truncate hidden sm:inline">
            {user.nickname || user.username}
          </span>
          {user.role === "admin" && (
            <Shield className="w-3 h-3 text-yellow-500" />
          )}
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-1 w-48 bg-card border border-border rounded-lg shadow-lg z-50 overflow-hidden">
            <div className="px-3 py-2 border-b border-border">
              <div className="text-sm font-medium text-foreground">
                {user.nickname || user.username}
              </div>
              <div className="text-xs text-muted">
                @{user.username} · {user.role}
              </div>
            </div>

            <div className="py-1">
              <button
                onClick={() => {
                  setOpen(false);
                  setShowSettings(true);
                }}
                className="w-full px-3 py-2 text-left text-sm text-muted hover:bg-card-hover hover:text-foreground flex items-center gap-2"
              >
                <Settings className="w-4 h-4" />
                {t.auth?.settings || "Settings"}
              </button>
              <button
                onClick={async () => {
                  setOpen(false);
                  await logout();
                }}
                className="w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-card-hover flex items-center gap-2"
              >
                <LogOut className="w-4 h-4" />
                {t.auth?.logout || "Logout"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Settings Modal */}
      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />
    </>
  );
}
