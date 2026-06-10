"use client";

import { useState, useRef, useEffect, useCallback } from "react";
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
  Tag,
  MoreVertical,
  Settings,
  LogOut,
  Globe,
  HardDrive,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/lib/theme-context";
import { useAuth } from "@/lib/auth-context";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { useScraperStore } from "@/hooks/useScraperStore";
import { useSiteSettings } from "@/hooks/useSiteSettings";

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
  const { user, logout } = useAuth();
  const isAdmin = user?.role === "admin";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scraperT = (t as any).scraper || {};
  const { batchRunning } = useScraperStore();
  const { siteName, siteIcon, scraperEnabled } = useSiteSettings();

  // Update favicon dynamically
  useEffect(() => {
    const link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
    if (!link) return;

    if (siteIcon) {
      link.href = `/api/site-settings/icon?t=${Date.now()}`;
    } else {
      link.href = "/icons/icon-192.png";
    }
  }, [siteIcon]);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-background/70 backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex h-12 sm:h-14 max-w-[1800px] items-center justify-between px-3 sm:px-6">
        {/* Logo */}
        <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
          {siteIcon ? (
            <img src={`/api/site-settings/icon?t=${Date.now()}`} alt="Site Icon" className="h-6 w-6 sm:h-7 sm:w-7 rounded-lg object-contain" />
          ) : (
            <div className="flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded-lg bg-accent">
              <BookMarked className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-white" />
            </div>
          )}
          <span className="hidden sm:inline text-xs font-bold tracking-tight text-foreground">
            {siteName}
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
          {/* Upload — 仅管理员可见（桌面端保留主按钮，移动端收入菜单） */}
          {isAdmin && (
          <button
            onClick={onUpload}
            disabled={uploading}
            className="hidden sm:flex h-8 sm:h-9 items-center gap-1.5 sm:gap-2 rounded-xl bg-accent px-2.5 sm:px-4 text-sm font-medium text-white transition-all duration-200 hover:bg-accent-hover hover:shadow-lg hover:shadow-accent/25 disabled:opacity-50"
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            <span className="hidden sm:inline">{uploading ? t.navbar.uploading : t.navbar.upload}</span>
          </button>
          )}

          {/* More Menu */}
          <MoreMenu
            isAdmin={isAdmin}
            onUpload={onUpload}
            uploading={uploading}
            onScanLibrary={onScanLibrary}
            scanning={scanning}
            batchRunning={batchRunning}
            scraperEnabled={scraperEnabled}
            theme={theme}
            toggleTheme={toggleTheme}
            t={t}
            scraperT={scraperT}
            user={user}
            logout={logout}
          />
        </div>
      </div>
    </nav>
  );
}

// ============================================================
// MoreMenu — 右侧下拉菜单
// ============================================================

interface MoreMenuProps {
  isAdmin: boolean;
  onUpload?: () => void;
  uploading?: boolean;
  onScanLibrary?: () => void;
  scanning?: boolean;
  batchRunning: boolean;
  scraperEnabled: boolean;
  theme: string;
  toggleTheme: () => void;
  t: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  scraperT: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  user: { username: string; nickname?: string; role?: string } | null;
  logout: () => void;
}

function MoreMenu({
  isAdmin,
  onUpload,
  uploading,
  onScanLibrary,
  scanning,
  batchRunning,
  scraperEnabled,
  theme,
  toggleTheme,
  t,
  scraperT,
  user,
  logout,
}: MoreMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // 点击外部关闭 & ESC 键关闭
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const handleAction = useCallback((fn?: () => void) => {
    setOpen(false);
    fn?.();
  }, []);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-xl border border-border/60 text-muted transition-colors duration-200 hover:border-border hover:text-foreground"
        title="Menu"
        aria-expanded={open}
        aria-haspopup="true"
      >
        <MoreVertical className="h-4 w-4" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-56 bg-card border border-border rounded-xl shadow-xl shadow-black/20 z-50 overflow-hidden backdrop-blur-xl" role="menu">
          {/* 管理员操作 */}
          {isAdmin && (
            <>
              {/* 上传 — 移动端显示 */}
              <button
                onClick={() => handleAction(onUpload)}
                disabled={uploading}
                className="sm:hidden w-full px-3 py-2.5 text-left text-sm text-muted hover:bg-card-hover hover:text-foreground flex items-center gap-2.5 disabled:opacity-50"
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {uploading ? t.navbar.uploading : t.navbar.upload}
              </button>

              {/* 扫描文库 */}
              {onScanLibrary && (
                <button
                  onClick={() => handleAction(onScanLibrary)}
                  disabled={scanning}
                  className="w-full px-3 py-2.5 text-left text-sm text-muted hover:bg-card-hover hover:text-foreground flex items-center gap-2.5 disabled:opacity-50"
                >
                  <RefreshCw className={`h-4 w-4 ${scanning ? "animate-spin" : ""}`} />
                  {t.navbar?.scanLibrary || "扫描文库"}
                </button>
              )}

              {/* 合集管理 */}
              <button
                onClick={() => handleAction(() => router.push("/collections"))}
                className="w-full px-3 py-2.5 text-left text-sm text-muted hover:bg-card-hover hover:text-foreground flex items-center gap-2.5"
              >
                <Layers className="h-4 w-4" />
                {((t as any).collections?.title) || "合集管理"}
              </button>

              {/* 标签与分类管理 */}
              <button
                onClick={() => handleAction(() => router.push("/tag-manager"))}
                className="w-full px-3 py-2.5 text-left text-sm text-muted hover:bg-card-hover hover:text-foreground flex items-center gap-2.5"
              >
                <Tag className="h-4 w-4" />
                {((t as any).tagManager?.title) || "标签与分类管理"}
              </button>

              {/* 数据管理 */}
              <button
                onClick={() => handleAction(() => router.push("/data-admin"))}
                className="w-full px-3 py-2.5 text-left text-sm text-muted hover:bg-card-hover hover:text-foreground flex items-center gap-2.5"
              >
                <HardDrive className="h-4 w-4" />
                {((t as any).dataAdmin?.title) || "数据管理"}
              </button>

              {/* 元数据刮削 — 启用时正常显示；未启用时灰显并跳转到设置 */}
              {scraperEnabled ? (
                <button
                  onClick={() => handleAction(() => router.push("/scraper"))}
                  className={`w-full px-3 py-2.5 text-left text-sm flex items-center gap-2.5 ${
                    batchRunning
                      ? "text-purple-500 bg-purple-500/5 hover:bg-purple-500/10"
                      : "text-muted hover:bg-card-hover hover:text-foreground"
                  }`}
                >
                  <Database className={`h-4 w-4 ${batchRunning ? "animate-pulse" : ""}`} />
                  {scraperT.navEntry || "元数据刮削"}
                  {batchRunning && (
                    <span className="ml-auto relative flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-2.5 w-2.5 rounded-full bg-purple-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-purple-500" />
                    </span>
                  )}
                </button>
              ) : (
                <button
                  onClick={() =>
                    handleAction(() =>
                      router.push("/settings?tab=site&highlight=scraperEnabled#scraperEnabled")
                    )
                  }
                  title={
                    scraperT.navDisabledTip ||
                    "内容刮削功能当前已关闭，点击前往设置开启"
                  }
                  className="w-full px-3 py-2.5 text-left text-sm flex items-center gap-2.5 text-muted/50 hover:bg-card-hover hover:text-muted cursor-pointer"
                >
                  <Database className="h-4 w-4 opacity-60" />
                  <span className="flex-1 truncate">
                    {scraperT.navEntry || "元数据刮削"}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/10 text-muted/70 shrink-0">
                    {scraperT.navDisabledBadge || "未启用"}
                  </span>
                </button>
              )}

              {/* 分隔线 */}
              <div className="my-1 border-t border-border/50" />
            </>
          )}

          {/* 主题切换 */}
          <button
            onClick={() => handleAction(toggleTheme)}
            className="w-full px-3 py-2.5 text-left text-sm text-muted hover:bg-card-hover hover:text-foreground flex items-center gap-2.5"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            {theme === "dark" ? (t.readerToolbar?.dayMode || "日间模式") : (t.readerToolbar?.nightMode || "夜间模式")}
          </button>

          {/* 语言切换 */}
          <div className="w-full px-3 py-2.5 flex items-center gap-2.5 text-sm text-muted">
            <Globe className="h-4 w-4 shrink-0" />
            <LanguageSwitcher variant="inline" />
          </div>

          {/* 分隔线 */}
          <div className="my-1 border-t border-border/50" />

          {/* 用户信息 & 操作 */}
          {user && (
            <>
              <div className="px-3 py-2 flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/10 text-accent">
                  <span className="text-xs font-bold">{(user.nickname || user.username)[0]?.toUpperCase()}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground truncate">{user.nickname || user.username}</div>
                  <div className="text-[10px] text-muted">@{user.username}</div>
                </div>
                {user.role === "admin" && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-500 font-medium">admin</span>
                )}
              </div>
              <button
                onClick={() => handleAction(() => router.push("/settings"))}
                className="w-full px-3 py-2.5 text-left text-sm text-muted hover:bg-card-hover hover:text-foreground flex items-center gap-2.5"
              >
                <Settings className="h-4 w-4" />
                {t.auth?.settings || "设置"}
              </button>
              {isAdmin && (
                <button
                  onClick={() => handleAction(() => router.push("/data-admin"))}
                  className="w-full px-3 py-2.5 text-left text-sm text-muted hover:bg-card-hover hover:text-foreground flex items-center gap-2.5"
                >
                  <Database className="h-4 w-4" />
                  数据管理
                </button>
              )}
              <button
                onClick={() => { setOpen(false); logout(); }}
                className="w-full px-3 py-2.5 text-left text-sm text-red-400 hover:bg-red-500/5 flex items-center gap-2.5"
              >
                <LogOut className="h-4 w-4" />
                {t.auth?.logout || "退出登录"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
