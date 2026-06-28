"use client";

import { useState, useRef, useEffect } from "react";
import {
  Search,
  Bell,
  Upload,
  Loader2,
  Sun,
  Moon,
  Settings,
  LogOut,
  RefreshCw,
  BookMarked,
  MoreVertical,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n";
import { useTheme } from "@/lib/theme-context";
import { useAuth } from "@/lib/auth-context";
import { useSiteSettings } from "@/hooks/useSiteSettings";

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
  const menuRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭菜单
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <header className="sticky top-0 z-30 h-16 flex items-center justify-between px-6 lg:px-8 border-b border-border/50 bg-surface/60 backdrop-blur-xl">
      {/* 左侧：标题 */}
      <div className="flex items-center gap-3">
        {/* 移动端 Logo */}
        <div className="flex lg:hidden items-center gap-2">
          {siteName ? (
            <span className="text-sm font-bold text-foreground">{siteName}</span>
          ) : (
            <BookMarked className="h-5 w-5 text-accent" />
          )}
        </div>
        <h1 className="hidden lg:block text-lg font-semibold text-foreground">
          {t.dashboard?.title || "Dashboard"}
        </h1>
      </div>

      {/* 右侧：操作按钮 */}
      <div className="flex items-center gap-2">
        {/* 扫描 */}
        {isAdmin && onScanLibrary && (
          <button
            onClick={onScanLibrary}
            disabled={scanning}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-muted hover:text-foreground hover:bg-card-hover transition-all disabled:opacity-50"
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
            className="hidden sm:flex h-9 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-medium text-white transition-all hover:bg-accent-hover hover:shadow-lg hover:shadow-accent/30 disabled:opacity-50"
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            <span className="hidden md:inline">{uploading ? "上传中..." : "上传"}</span>
          </button>
        )}

        {/* 更多菜单 */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-muted hover:text-foreground hover:bg-card-hover transition-all"
          >
            <MoreVertical className="h-4 w-4" />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full mt-2 w-48 rounded-xl border border-border bg-elevated/95 backdrop-blur-xl shadow-2xl py-1.5 animate-modal-in">
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
