"use client";

import { useState, useRef, useEffect } from "react";
import {
  Upload,
  Loader2,
  Sun,
  Moon,
  Settings,
  LogOut,
  RefreshCw,
  BookMarked,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/lib/theme-context";
import { useAuth } from "@/lib/auth-context";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import UserMenuButton from "@/components/UserMenuButton";
import SearchIconButton from "@/components/SearchIconButton";

interface DashboardTopBarProps {
  onUpload?: () => void;
  uploading?: boolean;
  onScanLibrary?: () => void;
  scanning?: boolean;
}

/**
 * Dashboard 轻量顶部操作栏
 * 配合左侧 Sidebar 使用，只保留搜索、通知、操作按钮
 */
export default function DashboardTopBar({
  onUpload,
  uploading,
  onScanLibrary,
  scanning,
}: DashboardTopBarProps) {
  const t = useTranslation();
  const { theme, toggleTheme } = useTheme();
  const { user, logout } = useAuth();
  const isAdmin = user?.role === "admin";
  const router = useRouter();
  const { siteName } = useSiteSettings();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭菜单
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <header className="dashboard-topbar ambient-topbar sticky top-0 z-30 h-16 flex items-center justify-between px-4 sm:px-6 lg:px-8 border-b">
      {/* 左侧：标题 */}
      <div className="flex min-w-0 items-center gap-3 pr-2">
        {/* 移动端 Logo */}
        <div className="flex min-w-0 lg:hidden items-center gap-2">
          {siteName ? (
            <span className="truncate text-sm font-bold text-foreground">{siteName}</span>
          ) : (
            <BookMarked className="h-5 w-5 text-accent" />
          )}
        </div>
        <h1 className="hidden lg:block text-sm font-medium text-muted">
          {t.dashboard.readingOverview}
        </h1>
      </div>

      {/* 右侧：操作按钮 */}
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <SearchIconButton query={searchQuery} onChange={setSearchQuery}
          onSubmit={() => router.push(`/books?search=${encodeURIComponent(searchQuery.trim())}`)} />
        {/* 扫描 */}
        {isAdmin && onScanLibrary && (
          <button
            onClick={onScanLibrary}
            disabled={scanning}
            aria-label={scanning ? "正在扫描书库" : "扫描书库"}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-muted transition-colors hover:bg-card-hover hover:text-foreground disabled:opacity-50"
            title="扫描文库"
          >
            <RefreshCw className={`h-4 w-4 ${scanning ? "animate-spin" : ""}`} />
          </button>
        )}

        {/* 上传 */}
        {isAdmin && onUpload && (
          <button
            onClick={onUpload}
            disabled={uploading}
            aria-label={uploading ? "上传中" : "上传"}
            title={uploading ? "上传中" : "上传"}
            className="shell-icon-button"
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          </button>
        )}

        {/* 用户菜单 */}
        <div className="dashboard-user-menu relative" ref={menuRef}>
          <UserMenuButton user={user} open={menuOpen} onClick={() => setMenuOpen(!menuOpen)} />

          {menuOpen && (
            <div className="absolute right-0 top-full mt-2 w-48 rounded-lg border border-border bg-elevated/95 py-1.5 shadow-xl backdrop-blur-xl animate-modal-in">
              <button
                onClick={() => { toggleTheme(); setMenuOpen(false); }}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-card-hover transition-colors"
              >
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                {theme === "dark" ? "浅色模式" : "深色模式"}
              </button>
              <button
                onClick={() => { router.push("/settings"); setMenuOpen(false); }}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-card-hover transition-colors"
              >
                <Settings className="h-4 w-4" />
                设置
              </button>
              <div className="my-1 border-t border-white/[0.06]" />
              <button
                onClick={() => { logout(); setMenuOpen(false); }}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <LogOut className="h-4 w-4" />
                退出登录
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
