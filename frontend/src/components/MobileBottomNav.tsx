"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { useLocation } from "react-router-dom";
import { BookMarked, Settings, BarChart3, Layers } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";

/**
 * 移动端底部导航栏
 * 仅在屏幕宽度 < 640px 时显示
 */
export default function MobileBottomNav() {
  const location = useLocation();
  const pathname = location.pathname;
  const searchParams = new URLSearchParams(location.search);
  const t = useTranslation();
  const { user } = useAuth();
  const [isMobile, setIsMobile] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);
  const [indicatorStyle, setIndicatorStyle] = useState<{ left: number; width: number }>({ left: 0, width: 0 });

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // 在阅读器页面、漫画详情页以及未登录时不显示底部导航
  const isReaderPage = pathname?.startsWith("/reader/") || pathname?.startsWith("/novel/");
  const isComicDetailPage = pathname?.startsWith("/comic/");

  const currentTab = searchParams.get("tab");

  const shouldHide = !isMobile || isReaderPage || isComicDetailPage || !user;

  const navItems = [
    {
      href: "/",
      icon: BookMarked,
      label: t.mobileNav?.library || "书库",
      active: pathname === "/",
    },
    {
      href: "/collections",
      icon: Layers,
      label: (t as any).collections?.navTitle || "合集",
      active: pathname === "/collections",
    },
    {
      href: "/settings?tab=stats",
      icon: BarChart3,
      label: t.mobileNav?.stats || "统计",
      active: pathname === "/settings" && currentTab === "stats",
    },
    {
      href: "/settings",
      icon: Settings,
      label: t.settings?.title || "设置",
      active: pathname === "/settings" && !currentTab,
    },
  ];

  const activeIndex = navItems.findIndex((item) => item.active);

  // 计算指示器位置
  const updateIndicator = useCallback(() => {
    if (!navRef.current || activeIndex < 0) return;
    const buttons = navRef.current.querySelectorAll<HTMLElement>("[data-nav-item]");
    const activeBtn = buttons[activeIndex];
    if (activeBtn) {
      const containerRect = navRef.current.getBoundingClientRect();
      const btnRect = activeBtn.getBoundingClientRect();
      setIndicatorStyle({
        left: btnRect.left - containerRect.left + btnRect.width / 2 - 12,
        width: 24,
      });
    }
  }, [activeIndex]);

  useEffect(() => {
    updateIndicator();
  }, [updateIndicator, pathname, currentTab]);

  // resize 时重新计算
  useEffect(() => {
    window.addEventListener("resize", updateIndicator);
    return () => window.removeEventListener("resize", updateIndicator);
  }, [updateIndicator]);

  if (shouldHide) return null;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/50 bg-background/95 backdrop-blur-lg sm:hidden safe-bottom overflow-hidden">
      <div ref={navRef} className="relative flex h-14 items-center justify-around px-2">
        {/* 滑动指示器 */}
        <div
          className="nav-indicator absolute top-0 h-[2px] rounded-full bg-accent"
          style={{
            transform: `translateX(${indicatorStyle.left}px)`,
            width: `${indicatorStyle.width}px`,
          }}
        />

        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              data-nav-item
              className={`flex flex-1 flex-col items-center gap-0.5 py-1 transition-all duration-200 ${
                item.active
                  ? "text-accent -translate-y-0.5"
                  : "text-muted hover:text-foreground translate-y-0"
              }`}
            >
              <Icon className={`h-5 w-5 transition-transform duration-200 ${item.active ? "scale-110" : "scale-100"}`} />
              <span className={`text-[10px] font-medium transition-opacity duration-200 ${item.active ? "opacity-100" : "opacity-70"}`}>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
