"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, Cloud, Smartphone, Info, Brain, Globe, BookOpen } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { clearServiceWorkerCache } from "@/lib/pwa";
import dynamic from "next/dynamic";

const LoadingSkeleton = () => (
  <div className="p-6 text-muted-foreground animate-pulse">Loading...</div>
);

const SiteSettingsPanel = dynamic(
  () => import("@/components/SiteSettingsPanel").then((mod) => mod.SiteSettingsPanel),
  { loading: LoadingSkeleton }
);
const CloudSyncPanel = dynamic(
  () => import("@/components/CloudSync").then((mod) => mod.CloudSyncPanel),
  { loading: LoadingSkeleton }
);
const AISettingsPanel = dynamic(
  () => import("@/components/AISettingsPanel").then((mod) => mod.AISettingsPanel),
  { loading: LoadingSkeleton }
);
const EHentaiSettingsPanel = dynamic(
  () => import("@/components/EHentaiSettingsPanel").then((mod) => mod.EHentaiSettingsPanel),
  { loading: LoadingSkeleton }
);

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

type SettingsTab = "site" | "sync" | "ai" | "ehentai" | "pwa" | "about";

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const t = useTranslation();
  const [activeTab, setActiveTab] = useState<SettingsTab>("site");
  const tabsRef = useRef<HTMLDivElement>(null);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [canScrollLeft, setCanScrollLeft] = useState(false);

  const checkScroll = useCallback(() => {
    const el = tabsRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    const el = tabsRef.current;
    if (!el) return;
    checkScroll();
    el.addEventListener("scroll", checkScroll, { passive: true });
    return () => el.removeEventListener("scroll", checkScroll);
  }, [open, checkScroll]);

  // auto-scroll active tab into view
  useEffect(() => {
    const el = tabsRef.current;
    if (!el) return;
    const activeBtn = el.querySelector<HTMLElement>("[data-active='true']");
    if (activeBtn) {
      activeBtn.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
  }, [activeTab]);

  if (!open) return null;

  const tabs: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { id: "site", label: t.siteSettings?.tab || "站点", icon: <Globe className="h-4 w-4" /> },
    { id: "sync", label: t.settings?.sync || "Sync", icon: <Cloud className="h-4 w-4" /> },
    { id: "ai", label: t.ai?.title || "AI", icon: <Brain className="h-4 w-4" /> },
    { id: "ehentai", label: "E-Hentai", icon: <BookOpen className="h-4 w-4" /> },
    { id: "pwa", label: t.settings?.pwa || "App", icon: <Smartphone className="h-4 w-4" /> },
    { id: "about", label: t.settings?.about || "About", icon: <Info className="h-4 w-4" /> },
  ];

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Modal — mobile: full-screen, desktop: centered card */}
      <div className="relative w-full h-full sm:w-[600px] sm:max-w-[90vw] sm:h-auto sm:max-h-[85vh] overflow-hidden sm:rounded-2xl bg-card border-0 sm:border sm:border-border shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/50 px-4 sm:px-6 py-3 sm:py-4">
          <h2 className="text-base sm:text-lg font-semibold text-foreground">
            {t.settings?.title || "Settings"}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted transition-colors hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Mobile: horizontal scrollable tabs at top */}
        <div className="sm:hidden border-b border-border/50 relative">
          {/* Left fade hint */}
          {canScrollLeft && (
            <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-6 z-10 bg-linear-to-r from-card to-transparent" />
          )}
          {/* Right fade hint */}
          {canScrollRight && (
            <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-6 z-10 bg-linear-to-l from-card to-transparent" />
          )}
          <div
            ref={tabsRef}
            className="flex p-1.5 gap-1 overflow-x-auto"
            style={{ scrollbarWidth: "none", msOverflowStyle: "none", WebkitOverflowScrolling: "touch" }}
          >
            {tabs.map((tab) => (
              <button
                key={tab.id}
                data-active={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors ${
                  activeTab === tab.id
                    ? "bg-accent/15 text-accent"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex h-[calc(100vh-120px)] sm:h-[calc(85vh-72px)] sm:max-h-[500px]">
          {/* Desktop Sidebar — hidden on mobile */}
          <div className="hidden sm:block w-40 flex-shrink-0 border-r border-border/50 p-2">
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
          <div className="flex-1 overflow-y-auto p-4 sm:p-6">
            {activeTab === "site" && <SiteSettingsPanel />}
            {activeTab === "sync" && <CloudSyncPanel />}
            {activeTab === "ai" && <AISettingsPanel />}
            {activeTab === "ehentai" && <EHentaiSettingsPanel />}
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
          <span className="text-muted">Backend</span>
          <span className="text-foreground">Go (Gin)</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted">Frontend</span>
          <span className="text-foreground">Vite + React 19</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted">Database</span>
          <span className="text-foreground">SQLite</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted">Comics</span>
          <span className="text-foreground">ZIP/CBZ/RAR/CBR/7Z/CB7/PDF</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted">Novels</span>
          <span className="text-foreground">TXT/EPUB/MOBI/AZW3</span>
        </div>
      </div>
    </div>
  );
}
