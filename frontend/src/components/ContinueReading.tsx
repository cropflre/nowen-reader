"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { BookOpen, ChevronRight, ChevronDown, ChevronUp, Clock, Heart, Star } from "lucide-react";
import { useTranslation } from "@/lib/i18n"
import { calculateReadingProgress, isReadingFinished } from "@/lib/progress";;
import type { ApiComic } from "@/hooks/useComics";

const STORAGE_KEY = "continue-reading-collapsed";

/**
 * 继续阅读横条 — 显示最近阅读的漫画/小说，带阅读进度
 * 类似 Netflix "继续观看" 的体验，支持折叠收起
 */
export function ContinueReading({ contentType }: { contentType?: string }) {
  const t = useTranslation();
  const [recentComics, setRecentComics] = useState<ApiComic[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState<number | undefined>(undefined);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  // 测量内容高度用于平滑折叠动画
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
      // 获取按最近阅读时间排序的漫画，只取有阅读记录的
      const params = new URLSearchParams({
        sortBy: "lastReadAt",
        sortOrder: "desc",
        pageSize: "20",
        page: "1",
      });
      if (contentType) params.set("contentType", contentType);
      const res = await fetch(
        `/api/comics?${params.toString()}`,
        { credentials: "include" }
      );
      if (!res.ok) {
        // 显式打印失败信息，便于定位 500/401 等问题
        console.warn(
          "[ContinueReading] fetch failed",
          res.status,
          await res.text().catch(() => "")
        );
        return;
      }
      const data = await res.json();
      const all: ApiComic[] = data.comics || [];
      // 只展示有阅读进度且未读完的（放宽：lastReadPage < pageCount 即可）
      const comics = all.filter(
        (c: ApiComic) =>
          !!c.lastReadAt &&
          c.lastReadPage > 0 &&
          (c.pageCount === 0 || c.lastReadPage < c.pageCount)
      );
      if (import.meta.env.MODE !== "production") {
        // eslint-disable-next-line no-console
        console.debug(
          "[ContinueReading] fetched",
          all.length,
          "comics, filtered to",
          comics.length
        );
      }
      setRecentComics(comics.slice(0, 8));
    } catch (e) {
      console.warn("[ContinueReading] fetch error", e);
    } finally {
      setLoading(false);
    }
  }, [contentType]);

  useEffect(() => {
    fetchRecent();
  }, [fetchRecent]);

  if (loading) {
    return (
      <section className="mb-8 surface-card rounded-2xl p-4 sm:p-5">
        <div className="mb-3 flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-accent" />
          <h2 className="text-sm font-semibold text-foreground">{t.continueReading?.title || "继续阅读"}</h2>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="w-[140px] shrink-0 space-y-1.5">
              <div className="relative aspect-[5/7] w-full overflow-hidden rounded-lg bg-card skeleton-shimmer" />
              <div className="skeleton-shimmer h-3 w-24 rounded" />
              <div className="skeleton-shimmer h-3 w-16 rounded" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (recentComics.length === 0) return null;

  // 判断是否为小说：优先使用数据库 type 字段，fallback 到文件后缀
  const isNovelByFilename = (filename: string) =>
    /\.(txt|epub|mobi|azw3|html|htm)$/i.test(filename || "");
  const isNovel = (comic: ApiComic) => {
    if (comic.type === "comic") return false;
    if (comic.type === "novel") return true;
    return isNovelByFilename(comic.filename);
  };

  // 格式化阅读时间
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

  const heroComic = recentComics[0];
  const restComics = recentComics.slice(1);
  const heroProgress = heroComic.pageCount > 0
    ? calculateReadingProgress(heroComic.lastReadPage, heroComic.pageCount)
    : 0;
  const heroNovel = isNovel(heroComic);
  const heroHref = heroNovel ? `/novel/${heroComic.id}` : `/reader/${heroComic.id}`;

  return (
    <section className="mb-8">
      {/* 标题栏 — 可点击折叠 */}
      <div className="mb-3 flex items-center justify-between px-1">
        <button
          onClick={toggleCollapsed}
          className="flex items-center gap-2 transition-colors hover:opacity-80"
        >
          <BookOpen className="h-5 w-5 text-accent" />
          <h2 className="text-sm font-semibold text-foreground">
            {t.continueReading?.title || "继续阅读"}
          </h2>
          <span className="text-xs text-muted">
            ({recentComics.length})
          </span>
          {collapsed ? (
            <ChevronDown className="h-4 w-4 text-muted" />
          ) : (
            <ChevronUp className="h-4 w-4 text-muted" />
          )}
        </button>
      </div>

      {/* 折叠动画 */}
      <div
        style={{
          height: collapsed ? 0 : contentHeight ?? "auto",
          overflow: "hidden",
          transition: "height 0.3s ease, opacity 0.3s ease",
          opacity: collapsed ? 0 : 1,
        }}
      >
        <div ref={contentRef}>
          {/* Hero 卡片 — 最近阅读的第一本 */}
          <Link href={heroHref} className="group relative block overflow-hidden rounded-2xl mb-3">
            <div className="relative aspect-[21/9] w-full overflow-hidden bg-card">
              {/* 封面作为背景 */}
              <Image
                src={heroComic.coverUrl}
                alt={heroComic.title}
                fill
                unoptimized
                className="object-cover transition-transform duration-500 group-hover:scale-105"
                sizes="100vw"
              />

              {/* 底部渐变遮罩 */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />

              {/* 收藏心形 */}
              {heroComic.isFavorite && (
                <div className="absolute top-4 right-4 z-10">
                  <Heart className="h-5 w-5 fill-rose-500 text-rose-500 drop-shadow-lg" />
                </div>
              )}

              {/* 右上角评分 */}
              {heroComic.rating && heroComic.rating > 0 && (
                <div className="absolute top-4 left-4 z-10 flex items-center gap-1 rounded-lg bg-black/50 px-2 py-1 backdrop-blur-sm">
                  <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                  <span className="text-sm font-medium text-amber-400">{heroComic.rating}</span>
                </div>
              )}

              {/* 底部文字信息 */}
              <div className="absolute inset-x-0 bottom-0 p-4 sm:p-6">
                <h3 className="mb-1 text-lg sm:text-xl font-bold text-white line-clamp-1 drop-shadow-lg">
                  {heroComic.title}
                </h3>
                {heroComic.author && (
                  <p className="mb-2 text-sm text-white/70 line-clamp-1">{heroComic.author}</p>
                )}

                {/* 进度信息 */}
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5 text-xs text-white/60">
                    <Clock className="h-3.5 w-3.5" />
                    {formatTime(heroComic.lastReadAt!)}
                  </div>
                  <span className="text-xs text-white/40">·</span>
                  <span className="text-xs text-white/60">
                    {heroNovel
                      ? `${t.continueReading?.chapter || "第"}${heroComic.lastReadPage + 1}${t.continueReading?.chapterUnit || "章"}`
                      : `${heroComic.lastReadPage + 1}/${heroComic.pageCount}${t.continueReading?.pageUnit || "页"}`}
                  </span>
                  <span className="text-xs font-semibold text-accent">{heroProgress}%</span>
                </div>

                {/* 进度条 */}
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/20">
                  <div
                    className="h-full rounded-full bg-accent transition-all duration-300"
                    style={{ width: `${Math.max(heroProgress, 2)}%` }}
                  />
                </div>
              </div>

              {/* 悬浮播放按钮 */}
              <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/20">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm opacity-0 transition-all duration-300 group-hover:opacity-100 group-hover:scale-100 scale-75">
                  <ChevronRight className="h-7 w-7 text-white" />
                </div>
              </div>
            </div>
          </Link>

          {/* 其余漫画 — 横向滚动小卡片 */}
          {restComics.length > 0 && (
            <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
              {restComics.map((comic) => {
                const progress =
                  comic.pageCount > 0
                    ? calculateReadingProgress(comic.lastReadPage, comic.pageCount)
                    : 0;
                const novel = isNovel(comic);
                const href = novel ? `/novel/${comic.id}` : `/reader/${comic.id}`;

                return (
                  <Link key={comic.id} href={href} className="group shrink-0">
                    <div className="w-[140px] space-y-1.5">
                      {/* 封面 */}
                      <div className="relative aspect-[5/7] w-full overflow-hidden rounded-lg bg-card motion-cover">
                        <Image
                          src={comic.coverUrl}
                          alt={comic.title}
                          fill
                          unoptimized
                          className="object-cover transition-transform duration-200 group-hover:scale-105"
                          sizes="140px"
                        />

                        {/* 进度条覆盖层 */}
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2 pt-6">
                          <div className="mb-1 flex items-center justify-between text-[10px]">
                            <span className="text-white/70">
                              {novel
                                ? `${t.continueReading?.chapter || "第"}${comic.lastReadPage + 1}${t.continueReading?.chapterUnit || "章"}`
                                : `${comic.lastReadPage + 1}/${comic.pageCount}${t.continueReading?.pageUnit || "页"}`}
                            </span>
                            <span className="font-medium text-accent">{progress}%</span>
                          </div>
                          <div className="h-1 overflow-hidden rounded-full bg-white/20">
                            <div
                              className="h-full rounded-full bg-accent transition-all duration-300"
                              style={{ width: `${Math.max(progress, 2)}%` }}
                            />
                          </div>
                        </div>

                        {/* 悬浮播放按钮 */}
                        <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/30">
                          <ChevronRight className="h-8 w-8 text-white opacity-0 transition-opacity group-hover:opacity-100" />
                        </div>
                      </div>

                      {/* 标题 */}
                      <p className="line-clamp-1 text-xs font-medium text-foreground/80 group-hover:text-foreground">
                        {comic.title}
                      </p>

                      {/* 上次阅读时间 */}
                      <div className="flex items-center gap-1 text-[10px] text-muted">
                        <Clock className="h-3 w-3" />
                        {formatTime(comic.lastReadAt!)}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
