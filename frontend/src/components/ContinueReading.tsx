"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { BookOpen, ChevronRight, ChevronDown, ChevronUp, Clock } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
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
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(STORAGE_KEY) === "true";
    }
    return false;
  });

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  const fetchRecent = useCallback(async () => {
    try {
      // 获取按最近阅读时间排序的漫画，只取有阅读记录的
      const params = new URLSearchParams({
        sortBy: "lastReadAt",
        sortOrder: "desc",
        pageSize: "10",
        page: "1",
      });
      if (contentType) params.set("contentType", contentType);
      const res = await fetch(
        `/api/comics?${params.toString()}`
      );
      if (res.ok) {
        const data = await res.json();
        // 只展示有阅读进度且未读完的
        const comics = (data.comics || []).filter(
          (c: ApiComic) =>
            c.lastReadAt &&
            c.lastReadPage > 0 &&
            (c.pageCount === 0 || c.lastReadPage < c.pageCount - 1)
        );
        setRecentComics(comics.slice(0, 8));
      }
    } catch {
      // 静默失败
    } finally {
      setLoading(false);
    }
  }, [contentType]);

  useEffect(() => {
    fetchRecent();
  }, [fetchRecent]);

  if (loading || recentComics.length === 0) return null;

  // 判断小说文件扩展名
  const isNovel = (filename: string) =>
    /\.(txt|epub|mobi|azw3|html|htm)$/i.test(filename || "");

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

  return (
    <div className="mb-6">
      {/* 标题栏 — 可点击折叠 */}
      <button
        onClick={toggleCollapsed}
        className="mb-3 flex w-full items-center gap-2 group cursor-pointer select-none"
      >
        <BookOpen className="h-4 w-4 text-accent" />
        <h2 className="text-sm font-semibold text-foreground">
          {t.continueReading?.title || "继续阅读"}
        </h2>
        <span className="text-xs text-muted">
          ({recentComics.length})
        </span>
        {/* 折叠/展开图标 */}
        <span className="ml-auto flex items-center gap-1 text-xs text-muted group-hover:text-foreground transition-colors">
          <span className="hidden sm:inline">
            {collapsed
              ? (t.continueReading?.expand || "展开")
              : (t.continueReading?.collapse || "收起")}
          </span>
          {collapsed ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronUp className="h-3.5 w-3.5" />
          )}
        </span>
      </button>

      {/* 横向滚动条 — 折叠动画 */}
      <div
        className={`grid transition-all duration-300 ease-in-out ${
          collapsed
            ? "grid-rows-[0fr] opacity-0"
            : "grid-rows-[1fr] opacity-100"
        }`}
      >
        <div className="overflow-hidden">
          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
            {recentComics.map((comic) => {
              const progress =
                comic.pageCount > 0
                  ? Math.round((comic.lastReadPage / comic.pageCount) * 100)
                  : 0;
              const novel = isNovel(comic.filename);
              const href = novel ? `/novel/${comic.id}` : `/reader/${comic.id}`;

              return (
                <Link key={comic.id} href={href} className="group shrink-0">
                  <div className="w-[140px] space-y-1.5">
                    {/* 封面 */}
                    <div className="relative aspect-[5/7] w-full overflow-hidden rounded-lg bg-card">
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
                        {/* 进度百分比 */}
                        <div className="mb-1 flex items-center justify-between text-[10px]">
                          <span className="text-white/70">
                            {novel
                              ? `${t.continueReading?.chapter || "第"}${comic.lastReadPage + 1}${t.continueReading?.chapterUnit || "章"}`
                              : `${comic.lastReadPage + 1}/${comic.pageCount}${t.continueReading?.pageUnit || "页"}`}
                          </span>
                          <span className="font-medium text-accent">
                            {progress}%
                          </span>
                        </div>
                        {/* 进度条 */}
                        <div className="h-1 overflow-hidden rounded-full bg-white/20">
                          <div
                            className="h-full rounded-full bg-accent transition-all duration-300"
                            style={{ width: `${Math.max(progress, 2)}%` }}
                          />
                        </div>
                      </div>

                      {/* 播放按钮悬浮效果 */}
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
        </div>
      </div>
    </div>
  );
}
