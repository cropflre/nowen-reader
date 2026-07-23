"use client";

import Link from "next/link";
import { useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  BookMarked,
  Layers,
  Clock,
  Settings,
  Tag,
  BarChart3,
  Database,
  Globe,
  Wrench,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useSiteSettings } from "@/hooks/useSiteSettings";

/**
 * 桌面端左侧固定导航栏 — 私人媒体库 App 风格
 */
import { apiPath } from "@/lib/base-path";

export default function DesktopSidebar() {
  const location = useLocation();
  const pathname = location.pathname;
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const { siteName, siteIcon } = useSiteSettings();

  const navItems = [
    { href: "/", icon: LayoutDashboard, label: "Dashboard", exact: true },
    { href: "/books", icon: BookMarked, label: "书库" },
    { href: "/collections", icon: Layers, label: "合集", adminOnly: true },
    { href: "/recommendations", icon: Globe, label: "推荐" },
    { href: "/history", icon: Clock, label: "阅读历史" },
    { divider: true } as const,
    { href: "/tag-manager", icon: Tag, label: "标签管理", adminOnly: true },
    { href: "/stats", icon: BarChart3, label: "统计", adminOnly: true },
    { href: "/data-admin", icon: Database, label: "数据管理", adminOnly: true },
    { href: "/scraper", icon: Wrench, label: "元数据抓取", adminOnly: true },
  ];

  const filteredItems = navItems.filter(
    (item) => !("adminOnly" in item && item.adminOnly) || isAdmin
  );

  return (
    <aside className="hidden lg:flex fixed left-0 top-0 bottom-0 z-40 w-[220px] xl:w-[240px] flex-col border-r border-border/50 bg-surface/85 backdrop-blur-2xl">
      {/* Logo 区 */}
      <div className="flex items-center gap-3 px-5 h-[72px] shrink-0">
        {siteIcon ? (
          <img
            src={apiPath(`/api/site-settings/icon?t=${Date.now()}`)}
            alt="Site Icon"
            className="h-9 w-9 rounded-xl object-contain shadow-lg shadow-accent/20"
          />
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent-purple shadow-lg shadow-accent/25">
            <BookMarked className="h-5 w-5 text-white" />
          </div>
        )}
        <div className="min-w-0">
          <span className="text-sm font-bold tracking-tight text-foreground truncate block">
            {siteName}
          </span>
          <span className="text-[10px] text-muted">Manga Library</span>
        </div>
      </div>

      {/* 分割线 */}
      <div className="mx-4 border-t border-border/30" />

      {/* 导航 */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1 scrollbar-hide" style={{ scrollbarWidth: "none" }}>
        {filteredItems.map((item, i) => {
          if ("divider" in item && item.divider) {
            return <div key={`div-${i}`} className="my-3 mx-2 border-t border-border/30" />;
          }
          if (!("href" in item)) return null;
          const Icon = item.icon;
          const isActive = item.exact
            ? pathname === "/"
            : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-xl px-3 py-[11px] text-[13px] font-medium transition-all duration-200 group relative ${
                isActive
                  ? "text-accent"
                  : "text-muted hover:text-foreground hover:bg-white/[0.04]"
              }`}
            >
              {/* 选中态背景 */}
              {isActive && (
                <div className="absolute inset-0 rounded-xl bg-accent/10 border border-accent/15 shadow-sm shadow-accent/5" />
              )}
              <Icon
                className={`h-[18px] w-[18px] shrink-0 relative z-10 transition-colors ${
                  isActive ? "text-accent" : "text-muted group-hover:text-foreground"
                }`}
              />
              <span className="relative z-10 truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* 用户卡片 */}
      {user && (
        <div className="shrink-0 px-4 py-4 border-t border-border/30">
          <div className="flex items-center gap-3 rounded-xl bg-card/50 px-3 py-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-accent/30 to-accent-purple/30 text-accent text-xs font-bold border border-accent/20">
              {(user.nickname || user.username || "U")[0].toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-foreground truncate">
                {user.nickname || user.username}
              </p>
              <p className="text-[10px] text-muted">
                {user.role === "admin" ? "管理员" : "用户"}
              </p>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
