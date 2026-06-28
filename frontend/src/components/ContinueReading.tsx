"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import { BookOpen, ChevronRight, ChevronDown, ChevronUp, Clock, ChevronLeft } from "lucide-react";
import NSFWCoverGuard from "@/components/NSFWCoverGuard";
import { usePrivacyMode } from "@/hooks/usePrivacyMode";
import { isNSFW } from "@/lib/nsfw";
import { useTranslation } from "@/lib/i18n";
import { calculateReadingProgress, isReadingFinished } from "@/lib/progress";
import type { ApiComic } from "@/hooks/useComics";

const STORAGE_KEY = "continue-reading-collapsed";

/**
 * 圆形阅读进度环
 */
function ReadingProgressRing({
  progress,
  size = 36,
  strokeWidth = 3,
}: {
  progress: number;
  size?: number;
  strokeWidth?: number;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - progress / 100);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="rotate-[-90deg]">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.15)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#3B82F6"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="progress-ring-animate"
          style={{
            "--circumference": circumference,
            "--target-offset": offset,
            filter: "drop-shadow(0 0 4px rgba(59,130,246,0.5))",
          } as React.CSSProperties}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[9px] font-bold text-white tabular-nums">{progress}%</span>
      </div>
    </div>
  );
}

/**
 * 继续阅读 3D Coverflow 横条
 * 中间卡片突出，左右卡片有 rotateY / scale / opacity 差异
 * 支持键盘左右箭头、鼠标滚轮、触摸滑动
 * @param showTitle 是否显示内部标题（Dashboard 模式下由外部控制标题）
 */
export function ContinueReading({ contentType, showTitle = true }: { contentType?: string; showTitle?: boolean }) {
  const t = useTranslation();
  const { enabled: privacyEnabled, blurNSFW } = usePrivacyMode();
  const [recentComics, setRecentComics] = useState<ApiComic[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState<number | undefined>(undefined);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  // 测量内容高度
  useEffect(() => {
    if (contentRef.current) {
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          setContentHeight(entry.contentRect.height);
        }
      });
      observer.observe(contentRef.current);
      return () => observer.disconnect();
    }
  }, [recentComics]);

  const fetchRecent = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        sortBy: "lastReadAt",
        sortOrder: "desc",
        pageSize: "20",
        page: "1",
      });
      if (contentType) params.set("contentType", contentType);
      const res = await fetch(`/api/comics?${params.toString()}`, { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      const all: ApiComic[] = data.comics || [];
      const comics = all.filter(
        (c: ApiComic) =>
          !!c.lastReadAt &&
          (c.pageCount === 0 || c.lastReadPage < c.pageCount)
      );
      setRecentComics(comics.slice(0, 8));
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [contentType]);

  useEffect(() => {
    fetchRecent();
  }, [fetchRecent]);

  // 从阅读器返回时刷新
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        fetchRecent();
      }
    };
    window.addEventListener("focus", fetchRecent);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("focus", fetchRecent);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [fetchRecent]);

  // 键盘导航（仅在 coverflow 可见时响应）
  useEffect(() => {
    if (collapsed || recentComics.length === 0) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      // 不在输入框中时才响应
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowLeft") { e.preventDefault(); setActiveIndex((i) => Math.max(0, i - 1)); }
      if (e.key === "ArrowRight") { e.preventDefault(); setActiveIndex((i) => Math.min(recentComics.length - 1, i + 1)); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [recentComics.length, collapsed]);

  const isNovelByFilename = (filename: string) =>
    /\.(txt|epub|mobi|azw3|html|htm)$/i.test(filename || "");
  const isNovel = (comic: ApiComic) => {
    if (comic.type === "comic") return false;
    if (comic.type === "novel") return true;
    return isNovelByFilename(comic.filename);
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffMin < 1) return t.continueReading?.justNow || "刚刚";
    if (diffMin < 60) return `${diffMin}${t.continueReading?.minutesAgo || "分钟前"}`;
    if (diffHour < 24) return `${diffHour}${t.continueReading?.hoursAgo || "小时前"}`;
    if (diffDay < 7) return `${diffDay}${t.continueReading?.daysAgo || "天前"}`;
    return date.toLocaleDateString();
  };

  if (loading) {
    return (
      <section className="dashboard-glass p-4 sm:p-5">
        {showTitle && (
          <div className="mb-3 flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-accent" />
            <h2 className="text-sm font-semibold text-foreground">{t.continueReading?.title || "继续阅读"}</h2>
          </div>
        )}
        <div className="flex gap-4 overflow-hidden pb-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="w-[180px] shrink-0 space-y-2">
              <div className="relative aspect-[5/7] w-full overflow-hidden rounded-2xl bg-card skeleton-shimmer" />
              <div className="skeleton-shimmer h-3 w-28 rounded" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (recentComics.length === 0) return null;

  return (
    <section className="dashboard-glass p-4 sm:p-5">
      {/* 标题栏 — 仅在 showTitle 模式下显示 */}
      {showTitle && (
      <div className="mb-3 flex items-center justify-between">
        <button
          onClick={toggleCollapsed}
          className="flex items-center gap-2 transition-colors hover:opacity-80"
        >
          <BookOpen className="h-4 w-4 text-accent" />
          <h2 className="text-sm font-semibold text-foreground">
            {t.continueReading?.title || "继续阅读"}
          </h2>
          <span className="text-xs text-muted">({recentComics.length})</span>
          {collapsed ? (
            <ChevronDown className="h-4 w-4 text-muted" />
          ) : (
            <ChevronUp className="h-4 w-4 text-muted" />
          )}
        </button>

        {/* 导航箭头 — 桌面端 */}
        {!collapsed && recentComics.length > 3 && (
          <div className="hidden sm:flex items-center gap-1">
            <button
              onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
              disabled={activeIndex === 0}
              className="flex h-7 w-7 items-center justify-center rounded-lg bg-background/40 text-muted hover:text-foreground hover:bg-background/60 transition-all disabled:opacity-30 disabled:pointer-events-none"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => setActiveIndex((i) => Math.min(recentComics.length - 1, i + 1))}
              disabled={activeIndex === recentComics.length - 1}
              className="flex h-7 w-7 items-center justify-center rounded-lg bg-background/40 text-muted hover:text-foreground hover:bg-background/60 transition-all disabled:opacity-30 disabled:pointer-events-none"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
      )}

      {/* Coverflow 内容区 */}
      <div
        style={{
          height: collapsed ? 0 : contentHeight ?? "auto",
          overflow: collapsed ? "hidden" : "visible",
          transition: "height 0.3s ease, opacity 0.3s ease",
          opacity: collapsed ? 0 : 1,
        }}
      >
        <div ref={contentRef}>
          {/* 桌面端：主卡 + 左右书架布局 */}
          <div className="hidden sm:block">
            <div className="flex items-center justify-center gap-3 lg:gap-4 px-4">
              {/* 左侧书架 */}
              <div className="flex items-end gap-2">
                {[-3, -2, -1].map((offset) => {
                  const n = recentComics.length;
                  if (n < Math.abs(offset) + 1) return null;
                  const index = ((activeIndex + offset) % n + n) % n;
                  const comic = recentComics[index];
                  const dist = Math.abs(offset);
                  const w = dist === 1 ? 130 : dist === 2 ? 115 : 100;
                  const op = dist === 1 ? 0.9 : dist === 2 ? 0.72 : 0.5;

                  return (
                    <Link
                      key={`l${offset}-${comic.id}`}
                      href={isNovel(comic) ? `/novel/${comic.id}` : `/reader/${comic.id}`}
                      onClick={() => setActiveIndex(index)}
                      className="group cursor-pointer"
                      style={{ opacity: op, transform: `perspective(600px) rotateY(8deg)` }}
                    >
                      <div style={{ width: w }} className="relative">
                        <div className="relative aspect-[5/7] w-full overflow-hidden rounded-xl bg-card shadow-md transition-all duration-300 group-hover:scale-105 group-hover:opacity-100">
                          <NSFWCoverGuard
                            src={comic.coverUrl}
                            alt={comic.title}
                            isNSFW={isNSFW(comic)}
                            blurEnabled={privacyEnabled && blurNSFW}
                            fill
                            unoptimized
                            className="object-cover"
                            sizes={`${w}px`}
                          />
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>

              {/* 中心主卡 */}
              {(() => {
                const n = recentComics.length;
                if (n === 0) return null;
                const comic = recentComics[activeIndex];
                const progress = comic.pageCount > 0
                  ? calculateReadingProgress(comic.lastReadPage, comic.pageCount)
                  : 0;
                const href = isNovel(comic) ? `/novel/${comic.id}` : `/reader/${comic.id}`;

                return (
                  <Link key={`active-${comic.id}`} href={href} className="group cursor-pointer relative z-10">
                    <div style={{ width: 230 }} className="relative">
                      <div
                        className="relative aspect-[5/7] w-full overflow-hidden rounded-2xl bg-card"
                        style={{
                          boxShadow: [
                            "0 0 0 1px rgba(96,165,250,0.25)",
                            "0 18px 50px rgba(37,99,235,0.28)",
                            "0 0 42px rgba(59,130,246,0.22)",
                            "0 8px 20px rgba(0,0,0,0.35)",
                          ].join(", "),
                        }}
                      >
                        <NSFWCoverGuard
                          src={comic.coverUrl}
                          alt={comic.title}
                          isNSFW={isNSFW(comic)}
                          blurEnabled={privacyEnabled && blurNSFW}
                          fill
                          unoptimized
                          className="object-cover transition-transform duration-500 group-hover:scale-105"
                          sizes="230px"
                        />

                        {/* 进度环 */}
                        <div className="absolute top-3 right-3 z-20">
                          <ReadingProgressRing progress={progress} size={36} strokeWidth={2.5} />
                        </div>

                        {/* 底部信息 */}
                        <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-4 pt-12">
                          <p className="text-sm font-semibold text-white line-clamp-1 drop-shadow-lg">
                            {comic.title}
                          </p>
                          <div className="mt-1.5 flex items-center gap-2 text-[11px] text-white/60">
                            <Clock className="h-3 w-3" />
                            <span>{formatTime(comic.lastReadAt!)}</span>
                            {comic.pageCount > 0 && (
                              <span className="ml-auto">{comic.lastReadPage + 1}/{comic.pageCount} {t.dashboard?.pages || "页"}</span>
                            )}
                          </div>
                          <div className="mt-3 flex items-center gap-2 text-xs font-medium text-accent">
                            <span>{t.dashboard?.continueAction || "Continue"}</span>
                            <ChevronRight className="h-3.5 w-3.5" />
                          </div>
                        </div>

                        {/* 双层边框 — 内蓝主边 + 白色高光 + 外轮廓 */}
                        <div
                          className="pointer-events-none absolute inset-0 z-40 rounded-2xl"
                          style={{
                            boxShadow: [
                              "inset 0 0 0 2px rgba(96,165,250,0.95)",
                              "inset 0 0 0 3px rgba(255,255,255,0.16)",
                              "0 0 0 1px rgba(96,165,250,0.35)",
                            ].join(", "),
                          }}
                        />
                      </div>
                    </div>
                  </Link>
                );
              })()}

              {/* 右侧书架 */}
              <div className="flex items-end gap-2">
                {[1, 2, 3].map((offset) => {
                  const n = recentComics.length;
                  if (n < offset + 1) return null;
                  const index = ((activeIndex + offset) % n + n) % n;
                  const comic = recentComics[index];
                  const w = offset === 1 ? 130 : offset === 2 ? 115 : 100;
                  const op = offset === 1 ? 0.9 : offset === 2 ? 0.72 : 0.5;

                  return (
                    <Link
                      key={`r${offset}-${comic.id}`}
                      href={isNovel(comic) ? `/novel/${comic.id}` : `/reader/${comic.id}`}
                      onClick={() => setActiveIndex(index)}
                      className="group cursor-pointer"
                      style={{ opacity: op, transform: `perspective(600px) rotateY(-8deg)` }}
                    >
                      <div style={{ width: w }} className="relative">
                        <div className="relative aspect-[5/7] w-full overflow-hidden rounded-xl bg-card shadow-md transition-all duration-300 group-hover:scale-105 group-hover:opacity-100">
                          <NSFWCoverGuard
                            src={comic.coverUrl}
                            alt={comic.title}
                            isNSFW={isNSFW(comic)}
                            blurEnabled={privacyEnabled && blurNSFW}
                            fill
                            unoptimized
                            className="object-cover"
                            sizes={`${w}px`}
                          />
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>

            {/* 页码指示器 */}
            {recentComics.length > 1 && (
              <div className="mt-2 flex items-center justify-center gap-1.5">
                {recentComics.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveIndex(i)}
                    className={`rounded-full transition-all duration-300 ${
                      i === activeIndex
                        ? "h-1.5 w-6 bg-accent shadow-sm shadow-accent/50"
                        : "h-1.5 w-1.5 bg-muted/30 hover:bg-muted/50"
                    }`}
                  />
                ))}
              </div>
            )}
          </div>

          {/* 移动端：简单横向滚动 */}
          <div className="sm:hidden">
            <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide snap-x snap-mandatory" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
              {recentComics.map((comic) => {
                const progress =
                  comic.pageCount > 0
                    ? calculateReadingProgress(comic.lastReadPage, comic.pageCount)
                    : 0;
                const novel = isNovel(comic);
                const href = novel ? `/novel/${comic.id}` : `/reader/${comic.id}`;

                return (
                  <Link key={comic.id} href={href} className="group shrink-0 snap-center">
                    <div className="w-[140px] space-y-2">
                      <div className="relative aspect-[5/7] w-full overflow-hidden rounded-2xl bg-card/60 backdrop-blur-sm border border-border/30 cover-glow">
                        <NSFWCoverGuard
                          src={comic.coverUrl}
                          alt={comic.title}
                          isNSFW={isNSFW(comic)}
                          blurEnabled={privacyEnabled && blurNSFW}
                          fill
                          unoptimized
                          className="object-cover transition-transform duration-200 group-hover:scale-105"
                          sizes="140px"
                        />
                        <div className="absolute top-2 right-2">
                          <ReadingProgressRing progress={progress} size={28} strokeWidth={2} />
                        </div>
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2.5 pt-8">
                          <p className="text-[11px] font-medium text-white/90 line-clamp-1">{comic.title}</p>
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
