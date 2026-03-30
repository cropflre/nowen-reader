"use client";

import { useState } from "react";
import {
  Search,
  Upload,
  BookMarked,
  Loader2,
  Sun,
  Moon,
  Brain,
  Database,
  Layers,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/lib/theme-context";
import { useAuth } from "@/lib/auth-context";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { UserMenu } from "@/components/UserMenu";
import { useScraperStore } from "@/hooks/useScraperStore";

interface NavbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onUpload?: () => void;
  uploading?: boolean;
  aiSearchMode?: boolean;
  onAiSearchModeChange?: (mode: boolean) => void;
  onScanLibrary?: () => void;
  scanning?: boolean;
}

export default function Navbar({
  searchQuery,
  onSearchChange,
  onUpload,
  uploading,
  aiSearchMode = false,
  onAiSearchModeChange,
  onScanLibrary,
  scanning,
}: NavbarProps) {
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const t = useTranslation();
  const { theme, toggleTheme } = useTheme();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scraperT = (t as any).scraper || {};
  const { batchRunning } = useScraperStore();

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-background/70 backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex h-14 sm:h-16 max-w-[1800px] items-center justify-between px-3 sm:px-6">
        {/* Logo */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <div className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg bg-accent">
            <BookMarked className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
          </div>
          <span className="hidden sm:inline text-lg font-bold tracking-tight text-foreground">
            NowenReader
          </span>
        </div>

        {/* Search Bar */}
        <div className="flex flex-1 items-center justify-center px-2 sm:px-8">
          <div
            className={`relative flex w-full max-w-md items-center transition-all duration-300 ${
              isSearchFocused ? "max-w-lg" : ""
            }`}
          >
            {/* AI Search Toggle */}
            {onAiSearchModeChange && (
              <button
                type="button"
                onClick={() => onAiSearchModeChange(!aiSearchMode)}
                className={`absolute left-2 z-10 flex h-6 items-center gap-1 rounded-md px-1.5 text-[10px] font-medium transition-all ${
                  aiSearchMode
                    ? "bg-purple-500/20 text-purple-400"
                    : "text-muted hover:text-foreground"
                }`}
                title={aiSearchMode ? "AI 语义搜索" : "普通搜索"}
              >
                <Brain className="h-3 w-3" />
              </button>
            )}
            <Search className={`absolute ${onAiSearchModeChange ? "left-10" : "left-3"} h-4 w-4 text-muted`} />
            <input
              type="text"
              placeholder={aiSearchMode
                ? (t.navbar?.aiSearchPlaceholder || "用自然语言搜索，如「关于巨人的漫画」")
                : t.navbar.searchPlaceholder
              }
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              onFocus={() => setIsSearchFocused(true)}
              onBlur={() => setIsSearchFocused(false)}
              className={`h-9 sm:h-10 w-full rounded-xl border bg-card/50 ${onAiSearchModeChange ? "pl-16" : "pl-10"} pr-4 text-sm text-foreground placeholder:text-muted/60 outline-none transition-all duration-300 focus:bg-card focus:ring-2 ${
                aiSearchMode
                  ? "border-purple-500/40 focus:border-purple-500/60 focus:ring-purple-500/20"
                  : "border-border/60 focus:border-accent/50 focus:ring-accent/20"
              }`}
            />
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          {/* Upload — 仅管理员可见 */}
          {isAdmin && (
          <button
            onClick={onUpload}
            disabled={uploading}
            className="flex h-8 sm:h-9 items-center gap-1.5 sm:gap-2 rounded-xl bg-accent px-2.5 sm:px-4 text-sm font-medium text-white transition-all duration-200 hover:bg-accent-hover hover:shadow-lg hover:shadow-accent/25 disabled:opacity-50"
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            <span className="hidden sm:inline">{uploading ? t.navbar.uploading : t.navbar.upload}</span>
          </button>
          )}

          {/* Scan Library — 手动扫描文库（仅管理员可见） */}
          {isAdmin && onScanLibrary && (
            <button
              onClick={onScanLibrary}
              disabled={scanning}
              className="flex h-8 sm:h-9 w-8 sm:w-9 items-center justify-center rounded-xl border border-border/60 text-muted transition-colors duration-200 hover:border-accent/40 hover:text-accent hover:bg-accent/5 disabled:opacity-50"
              title={t.navbar?.scanLibrary || "扫描文库"}
            >
              <RefreshCw className={`h-4 w-4 ${scanning ? "animate-spin" : ""}`} />
            </button>
          )}

          {/* Collections — 合集管理（仅管理员可见） */}
          {isAdmin && (
          <Link
            href="/collections"
            className="hidden sm:flex h-9 w-9 items-center justify-center rounded-xl border border-border/60 text-muted transition-colors duration-200 hover:border-accent/40 hover:text-accent hover:bg-accent/5"
            title={((t as any).collections?.title) || "合集管理"}
          >
            <Layers className="h-4 w-4" />
          </Link>
          )}

          {/* Metadata Scraper — 仅管理员可见 */}
          {isAdmin && (
            <Link
              href="/scraper"
              className={`relative hidden sm:flex h-9 w-9 items-center justify-center rounded-xl border transition-colors duration-200 ${
                batchRunning
                  ? "border-purple-500/50 text-purple-500 bg-purple-500/5"
                  : "border-border/60 text-muted hover:border-purple-500/40 hover:text-purple-500 hover:bg-purple-500/5"
              }`}
              title={scraperT.navEntry || "元数据刮削"}
            >
              <Database className={`h-4 w-4 ${batchRunning ? "animate-pulse" : ""}`} />
              {batchRunning && (
                <span className="absolute -top-1 -right-1 flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-purple-500" />
                </span>
              )}
            </Link>
          )}

          {/* Theme Toggle */}
          <button
            onClick={toggleTheme}
            className="hidden sm:flex h-9 w-9 items-center justify-center rounded-xl border border-border/60 text-muted transition-colors duration-200 hover:border-border hover:text-foreground"
            title={theme === "dark" ? (t.readerToolbar?.dayMode || "Day") : (t.readerToolbar?.nightMode || "Night")}
          >
            {theme === "dark" ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </button>

          {/* Language Switcher */}
          <div className="hidden sm:block">
            <LanguageSwitcher />
          </div>

          {/* User Menu */}
          <UserMenu />
        </div>
      </div>
    </nav>
  );
}
