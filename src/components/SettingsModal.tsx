"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { X, Cloud, Puzzle, Smartphone, Info } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { CloudSyncPanel } from "@/components/CloudSync";
import { PluginManagerPanel } from "@/components/PluginManager";
import { clearServiceWorkerCache } from "@/lib/pwa";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

type SettingsTab = "sync" | "plugins" | "pwa" | "about";

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const t = useTranslation();
  const [activeTab, setActiveTab] = useState<SettingsTab>("sync");

  if (!open) return null;

  const tabs: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { id: "sync", label: t.settings?.sync || "Sync", icon: <Cloud className="h-4 w-4" /> },
    { id: "plugins", label: t.settings?.plugins || "Plugins", icon: <Puzzle className="h-4 w-4" /> },
    { id: "pwa", label: t.settings?.pwa || "App", icon: <Smartphone className="h-4 w-4" /> },
    { id: "about", label: t.settings?.about || "About", icon: <Info className="h-4 w-4" /> },
  ];

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-[600px] max-w-[90vw] max-h-[85vh] overflow-hidden rounded-2xl bg-card border border-border shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/50 px-6 py-4">
          <h2 className="text-lg font-semibold text-foreground">
            {t.settings?.title || "Settings"}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted transition-colors hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex h-[calc(85vh-72px)] max-h-[500px]">
          {/* Sidebar */}
          <div className="w-40 flex-shrink-0 border-r border-border/50 p-2">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                  activeTab === tab.id
                    ? "bg-accent/15 text-accent font-medium"
                    : "text-muted hover:bg-card-hover hover:text-foreground"
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {activeTab === "sync" && <CloudSyncPanel />}
            {activeTab === "plugins" && <PluginManagerPanel />}
            {activeTab === "pwa" && <PWASettings />}
            {activeTab === "about" && <AboutPanel />}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function PWASettings() {
  const t = useTranslation();
  const [isStandalone] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(display-mode: standalone)").matches;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Smartphone className="h-5 w-5 text-accent" />
        <h3 className="text-sm font-medium text-foreground">
          {t.pwa?.appSettings || "App Settings"}
        </h3>
      </div>

      <div className="space-y-3 rounded-xl bg-background p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted">{t.pwa?.installStatus || "Install Status"}</span>
          <span className={isStandalone ? "text-green-400" : "text-muted"}>
            {isStandalone
              ? (t.pwa?.installed || "Installed")
              : (t.pwa?.notInstalled || "Not installed")}
          </span>
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className="text-muted">{t.pwa?.offlineSupport || "Offline Support"}</span>
          <span className="text-green-400">{t.pwa?.enabled || "Enabled"}</span>
        </div>
      </div>

      <button
        onClick={() => {
          clearServiceWorkerCache();
          alert(t.pwa?.cacheCleared || "Cache cleared");
        }}
        className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-xs font-medium text-foreground transition-colors hover:bg-card-hover"
      >
        {t.pwa?.clearCache || "Clear Offline Cache"}
      </button>
    </div>
  );
}

function AboutPanel() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Info className="h-5 w-5 text-accent" />
        <h3 className="text-sm font-medium text-foreground">About</h3>
      </div>

      <div className="space-y-3 rounded-xl bg-background p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted">App</span>
          <span className="text-foreground font-medium">NowenReader</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted">Version</span>
          <span className="text-foreground">0.1.0</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted">Framework</span>
          <span className="text-foreground">Next.js 16 + React 19</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted">Database</span>
          <span className="text-foreground">SQLite (Prisma)</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted">Formats</span>
          <span className="text-foreground">ZIP/CBZ/RAR/CBR/7Z/CB7/PDF</span>
        </div>
      </div>
    </div>
  );
}
