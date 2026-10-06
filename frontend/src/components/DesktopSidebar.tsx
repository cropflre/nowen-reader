"use client";

import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import Link from "next/link";
import { useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  BookMarked,
  Heart,
  Layers,
  Clock,
  Settings,
  BarChart3,
  Globe,
  Wrench,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useSiteSettings } from "@/hooks/useSiteSettings";

import { apiPath } from "@/lib/base-path";
import { isManagementPath } from "@/lib/management-navigation";
import "./desktop-dock.css";

export default function DesktopSidebar() {
  const location = useLocation();
  const pathname = location.pathname;
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const { siteName, siteIcon } = useSiteSettings();
  const siteIconSrc = useMemo(() => apiPath(`/api/site-settings/icon?t=${Date.now()}`), [siteIcon]);
  const [tooltip, setTooltip] = useState<{ label: string; top: number } | null>(null);
  const dockRef = useRef<HTMLElement>(null);
  const isActive = (href: string) => pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));

  useEffect(() => {
    setTooltip(null);
  }, [pathname, isAdmin]);

  const tooltipEvents = (label: string) => {
    const show = (event: SyntheticEvent<HTMLElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const dockTop = dockRef.current?.getBoundingClientRect().top || 0;
      setTooltip({ label, top: rect.top + rect.height / 2 - dockTop });
    };
    return { onMouseEnter: show, onFocus: show, onMouseLeave: () => setTooltip(null), onBlur: () => setTooltip(null) };
  };

  const primaryItems = [
    { href: "/", icon: LayoutDashboard, label: "首页" },
    { href: "/books", icon: BookMarked, label: "书库" },
    { href: "/favorites", icon: Heart, label: "收藏" },
    { href: "/collections", icon: Layers, label: "合集", adminOnly: true },
    { href: "/recommendations", icon: Globe, label: "推荐" },
    { href: "/history", icon: Clock, label: "阅读历史" },
    { href: "/stats", icon: BarChart3, label: "阅读统计" },
  ];

  const visiblePrimaryItems = primaryItems.filter(
    (item) => !item.adminOnly || isAdmin
  );
  const renderItem = (item: (typeof primaryItems)[number]) => {
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-label={item.label}
        aria-current={isActive(item.href) ? "page" : undefined}
        className="dock-control"
        {...tooltipEvents(item.label)}
        onClick={() => setTooltip(null)}
      >
        <Icon aria-hidden="true" />
        <span className="dock-label" aria-hidden="true">{item.label}</span>
      </Link>
    );
  };

  return (
    <>
      <Link href="/" className="desktop-brand" aria-label={`${siteName || "NowenReader"} 首页`}
        title={siteName || "NowenReader"}
        onClick={() => setTooltip(null)}>
        <span className={`desktop-brand-icon${siteIcon ? " has-custom-icon" : ""}`}>
          {siteIcon ? <img src={siteIconSrc} alt="" /> : <BookMarked aria-hidden="true" />}
        </span>
        <span className="desktop-brand-name">{siteName || "NowenReader"}</span>
      </Link>
    <aside ref={dockRef} className="desktop-dock" aria-label="桌面导航">
      <nav aria-label="主导航" className="dock-primary" onScroll={() => setTooltip(null)}>
        {visiblePrimaryItems.map(renderItem)}
      </nav>
      <div className="dock-footer">
        <div className="dock-divider" />
        {isAdmin && (
          <Link href="/tag-manager" className="dock-control"
            aria-label="管理工具" aria-current={isManagementPath(pathname) ? "page" : undefined}
            {...tooltipEvents("管理工具")}
            onClick={() => setTooltip(null)}>
            <Wrench aria-hidden="true" />
            <span className="dock-label" aria-hidden="true">管理工具</span>
          </Link>
        )}
        {renderItem({ href: "/settings", icon: Settings, label: "设置" })}
      </div>
      {tooltip && <span role="tooltip" className="dock-tooltip" style={{ top: tooltip.top }}>{tooltip.label}</span>}
    </aside>
    </>
  );
}
