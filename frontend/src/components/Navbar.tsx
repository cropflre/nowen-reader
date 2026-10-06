"use client";

import { useState, useRef, useEffect, useCallback, type ReactNode } from "react";
import {
  Upload,
  BookMarked,
  Loader2,
  Sun,
  Moon,
  Database,
  Layers,
  RefreshCw,
  Tag,
  Settings,
  LogOut,
  Globe,
  Clock,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/lib/theme-context";
import { useAuth } from "@/lib/auth-context";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import UserMenuButton from "@/components/UserMenuButton";
import SearchIconButton from "@/components/SearchIconButton";
import { useScraperStore } from "@/hooks/useScraperStore";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { apiPath } from "@/lib/base-path";

interface NavbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onUpload?: () => void;
  uploading?: boolean;
  aiSearchMode?: boolean;
  onAiSearchModeChange?: (mode: boolean) => void;
  onScanLibrary?: () => void;
  scanning?: boolean;
  withinShell?: boolean;
  secondaryNavigation?: ReactNode;
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
  withinShell = false,
  secondaryNavigation,
}: NavbarProps) {
  const t = useTranslation();
  const { theme, toggleTheme } = useTheme();
  const { user, logout } = useAuth();
  const isAdmin = user?.role === "admin";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scraperT = (t as any).scraper || {};
  const { batchRunning } = useScraperStore();
  const { siteName, siteIcon, scraperEnabled } = useSiteSettings();

  return (
    <nav className={`ambient-topbar fixed top-0 right-0 z-50 border-b border-border/50 ${secondaryNavigation ? "pb-11 lg:pb-0" : ""} ${
      withinShell ? "app-shell-navbar left-0" : "left-0"
    }`}>
      <div className={`mx-auto flex h-14 sm:h-16 max-w-[1760px] items-center justify-between px-6 sm:px-8 ${secondaryNavigation ? "lg:gap-4 lg:px-6" : "lg:px-12"}`}>
        {/* Logo — 点击返回仪表盘 */}
        <Link
          href="/"
          className={`flex min-w-0 items-center gap-2 sm:gap-2.5 shrink-0 rounded-lg transition-opacity hover:opacity-80 ${withinShell ? "lg:hidden" : ""}`}
          title={t.navbar?.backToDashboard || "返回仪表盘"}
        >
          {siteIcon ? (
            <img src={apiPath(`/api/site-settings/icon?t=${Date.now()}`)} alt="Site Icon" className={`h-7 w-7 sm:h-8 sm:w-8 rounded-lg object-contain ${withinShell ? "lg:hidden" : ""}`} />
          ) : (
            <div className={`flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-lg bg-accent shadow-lg shadow-accent/20 ${withinShell ? "lg:hidden" : ""}`}>
              <BookMarked className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-white" />
            </div>
          )}
          <span className="hidden sm:inline min-w-0 truncate text-xs lg:text-sm font-bold text-foreground">
            {siteName}
          </span>
        </Link>

        {secondaryNavigation && <div className="absolute left-0 right-0 top-14 sm:top-16 lg:static lg:w-auto min-w-0 border-t border-border/30 px-6 sm:px-8 lg:border-0 lg:px-0">{secondaryNavigation}</div>}

        <div className="min-w-0 flex-1" />

        {/* Right Actions */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          <SearchIconButton query={searchQuery} onChange={onSearchChange}
            aiSearchMode={aiSearchMode} onAiSearchModeChange={onAiSearchModeChange} />
          {/* Upload */}
          {isAdmin && onUpload && (
          <button
            onClick={onUpload}
            disabled={uploading}
            aria-label={uploading ? t.navbar.uploading : t.navbar.upload}
            title={uploading ? t.navbar.uploading : t.navbar.upload}
            className="shell-icon-button"
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
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
      <UserMenuButton user={user} open={open} onClick={() => setOpen(!open)} />

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

              {/* 阅读历史 */}
              <button
                onClick={() => handleAction(() => router.push("/history"))}
                className="w-full px-3 py-2.5 text-left text-sm text-muted hover:bg-card-hover hover:text-foreground flex items-center gap-2.5"
              >
                <Clock className="h-4 w-4" />
                阅读历史
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
