"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookMarked, BarChart3, User, Settings, BookOpen } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

/**
 * 移动端底部导航栏
 * 仅在屏幕宽度 < 640px 时显示
 */
export default function MobileBottomNav() {
  const pathname = usePathname();
  const t = useTranslation();
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // 在阅读器页面不显示底部导航
  const isReaderPage = pathname?.startsWith("/reader/") || pathname?.startsWith("/novel/");
  if (!isMobile || isReaderPage) return null;

  const navItems = [
    {
      href: "/",
      icon: BookMarked,
      label: t.mobileNav?.library || "书库",
      active: pathname === "/",
    },
    {
      href: "/stats",
      icon: BarChart3,
      label: t.mobileNav?.stats || "统计",
      active: pathname === "/stats",
    },
    {
      href: "/ehentai",
      icon: BookOpen,
      label: "E-H",
      active: pathname === "/ehentai",
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
