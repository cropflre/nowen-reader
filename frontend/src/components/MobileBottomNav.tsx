"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { BookMarked, Settings, BarChart3 } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";

/**
 * 移动端底部导航栏
 * 仅在屏幕宽度 < 640px 时显示
 */
export default function MobileBottomNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslation();
  const { user } = useAuth();
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // 在阅读器页面、漫画详情页以及未登录时不显示底部导航
  const isReaderPage = pathname?.startsWith("/reader/") || pathname?.startsWith("/novel/");
  const isComicDetailPage = pathname?.startsWith("/comic/");
  if (!isMobile || isReaderPage || isComicDetailPage || !user) return null;

  const currentTab = searchParams.get("tab");

  const navItems = [
    {
      href: "/",
      icon: BookMarked,
      label: t.mobileNav?.library || "书库",
      active: pathname === "/",
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

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/50 bg-background/95 backdrop-blur-lg sm:hidden safe-bottom">
      <div className="flex h-14 items-center justify-around px-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-1 flex-col items-center gap-0.5 py-1 transition-colors ${
                item.active
                  ? "text-accent"
                  : "text-muted hover:text-foreground"
              }`}
            >
              <Icon className="h-5 w-5" />
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
