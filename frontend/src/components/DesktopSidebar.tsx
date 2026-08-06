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
  AlertTriangle,
  ShieldCheck,
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

  const primaryItems = [
    { href: "/", icon: LayoutDashboard, label: "首页" },
    { href: "/books", icon: BookMarked, label: "书库" },
    { href: "/collections", icon: Layers, label: "合集", adminOnly: true },
    { href: "/recommendations", icon: Globe, label: "推荐" },
    { href: "/history", icon: Clock, label: "阅读历史" },
    { href: "/stats", icon: BarChart3, label: "阅读统计" },
  ];

  const adminItems = [
    { href: "/tag-manager", icon: Tag, label: "标签与分类", adminOnly: true },
    { href: "/scraper", icon: Wrench, label: "元数据抓取", adminOnly: true },
    { href: "/logs", icon: AlertTriangle, label: "错误日志", adminOnly: true },
    { href: "/data-admin", icon: Database, label: "数据管理", adminOnly: true },
    { href: "/data-qa", icon: ShieldCheck, label: "数据巡检", adminOnly: true },
  ];

  const visiblePrimaryItems = primaryItems.filter(
    (item) => !item.adminOnly || isAdmin
  );
  const visibleAdminItems = adminItems.filter(
    (item) => !("adminOnly" in item && item.adminOnly) || isAdmin
  );

  const renderItem = (item: (typeof primaryItems)[number] | (typeof adminItems)[number]) => {
    const Icon = item.icon;
    const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={isActive ? "page" : undefined}
        className={`relative flex min-h-10 items-center gap-3 rounded-lg px-3 text-[13px] font-medium transition-colors ${
          isActive
            ? "bg-accent/10 text-accent"
            : "text-muted hover:bg-card-hover hover:text-foreground"
        }`}
      >
        <Icon className="h-[18px] w-[18px] shrink-0" />
        <span className="truncate">{item.label}</span>
      </Link>
    );
  };

  return (
    <aside className="hidden lg:flex fixed left-0 top-0 bottom-0 z-40 w-[220px] xl:w-[240px] flex-col border-r border-border/50 bg-surface/85 backdrop-blur-2xl">
      {/* Logo 区 */}
      <div className="flex items-center gap-3 px-5 h-[72px] shrink-0">
        {siteIcon ? (
          <img
            src={apiPath(`/api/site-settings/icon?t=${Date.now()}`)}
            alt={`${siteName} 图标`}
            className="h-9 w-9 rounded-lg object-contain"
          />
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent">
            <BookMarked className="h-5 w-5 text-white" />
          </div>
        )}
        <div className="min-w-0">
          <span className="text-sm font-bold tracking-tight text-foreground truncate block">
            {siteName}
          </span>
          <span className="text-xs text-muted">数字阅读库</span>
        </div>
      </div>

      {/* 分割线 */}
      <div className="mx-4 border-t border-border/30" />

      {/* 导航 */}
      <nav aria-label="主导航" className="flex-1 overflow-y-auto px-3 py-4 scrollbar-hide" style={{ scrollbarWidth: "none" }}>
        <div className="space-y-1">{visiblePrimaryItems.map(renderItem)}</div>
        {visibleAdminItems.length > 0 && (
          <div className="mt-5">
            <p className="mb-2 px-3 text-xs font-medium text-muted">管理工具</p>
            <div className="space-y-1">{visibleAdminItems.map(renderItem)}</div>
          </div>
        )}
      </nav>

      <div className="shrink-0 border-t border-border/30 px-3 py-3">
        {renderItem({ href: "/settings", icon: Settings, label: "设置" })}
      </div>

      {user && (
        <div className="shrink-0 border-t border-border/30 px-4 py-4">
          <div className="flex items-center gap-3 rounded-lg bg-card/50 px-3 py-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/15 text-xs font-bold text-accent">
              {(user.nickname || user.username || "U")[0].toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-foreground truncate">
                {user.nickname || user.username}
              </p>
              <p className="text-xs text-muted">
                {user.role === "admin" ? "管理员" : "用户"}
              </p>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
