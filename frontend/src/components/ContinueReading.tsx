"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  BookOpen,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  Clock,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { calculateReadingProgress } from "@/lib/progress";
import type { ApiComic } from "@/hooks/useComics";

const STORAGE_KEY = "continue-reading-collapsed";

/* ──────────────────────────────────────────────────────────
 * SVG Circular Progress Ring (32x32)
 * ────────────────────────────────────────────────────────── */
function ProgressRing({ percent }: { percent: number }) {
  const r = 13;
  const circ = 2 * Math.PI * r;
  const offset = circ - (percent / 100) * circ;

  return (
    <svg
      width={32}
      height={32}
      viewBox="0 0 32 32"
      className="absolute right-2 top-2 z-10 drop-shadow-[0_0_6px_rgba(99,102,241,0.6)]"
    >
      {/* Track */}
      <circle
        cx={16}
        cy={16}
        r={r}
        fill="none"
        stroke="rgba(255,255,255,0.15)"
        strokeWidth={3}
      />
      {/* Progress arc */}
      <circle
        cx={16}
        cy={16}
        r={r}
        fill="none"
        stroke="url(#ring-gradient)"
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        transform="rotate(-90 16 16)"
        style={{ transition: "stroke-dashoffset 0.5s ease" }}
      />
      {/* Gradient definition */}
      <defs>
        <linearGradient id="ring-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#a78bfa" />
        </linearGradient>
      </defs>
      {/* Percent text */}
      <text
        x={16}
        y={16}
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-white text-[9px] font-bold"
      >
        {percent}
      </text>
    </svg>
  );
}

/* ──────────────────────────────────────────────────────────
 * Cover Card — shared between mobile & desktop layouts
 * ────────────────────────────────────────────────────────── */
function CoverCard({
  comic,
  isActive,
  onClick,
}: {
  comic: ApiComic;
  isActive: boolean;
  onClick?: () => void;
}) {
  const t = useTranslation();

  const isNovelByFilename = (filename: string) =>
    /\.(txt|epub|mobi|azw3|html|htm)$/i.test(filename || "");
  const novel =
    comic.type === "comic"
      ? false
      : comic.type === "novel"
        ? true
        : isNovelByFilename(comic.filename);

  const progress =
    comic.pageCount > 0
      ? calculateReadingProgress(comic.lastReadPage, comic.pageCount)
      : 0;
  const href = novel ? `/novel/${comic.id}` : `/reader/${comic.id}`;

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);
    if (diffMin < 1) return t.continueReading?.justNow || "刚刚";
    if (diffMin < 60)
      return `${diffMin}${t.continueReading?.minutesAgo || "分钟前"}`;
    if (diffHour < 24)
      return `${diffHour}${t.continueReading?.hoursAgo || "小时前"}`;
    if (diffDay < 7)
      return `${diffDay}${t.continueReading?.daysAgo || "天前"}`;
    return date.toLocaleDateString();
  };

  return (
    <Link
      href={href}
      className="group block shrink-0 cursor-pointer"
      onClick={onClick}
    >
      <div
        className="relative w-[140px] sm:w-[160px] space-y-1.5"
        style={
          isActive
            ? {
                filter:
                  "drop-shadow(0 0 14px rgba(99,102,241,0.45)) drop-shadow(0 0 28px rgba(167,139,250,0.25))",
              }
            : undefined
        }
      >
        {/* Cover image */}
        <div
          className={`relative aspect-[5/7] w-full overflow-hidden rounded-lg bg-card transition-all duration-300 ${
            isActive
              ? "ring-2 ring-purple-500/60 ring-offset-1 ring-offset-transparent"
              : ""
          }`}
        >
          <Image
            src={comic.coverUrl}
            alt={comic.title}
            fill
            unoptimized
            className="object-cover transition-transform duration-200 group-hover:scale-105"
            sizes="160px"
          />

          {/* Circular progress ring (top-right) on active card */}
          {isActive && <ProgressRing percent={progress} />}

          {/* Bottom gradient overlay with linear progress bar */}
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

          {/* Hover play icon */}
          <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/30">
            <ChevronRight className="h-8 w-8 text-white opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
        </div>

        {/* Title */}
        <p className="line-clamp-1 text-xs font-medium text-foreground/80 group-hover:text-foreground">
          {comic.title}
        </p>

        {/* Last read time */}
        <div className="flex items-center gap-1 text-[10px] text-muted">
          <Clock className="h-3 w-3" />
          {formatTime(comic.lastReadAt!)}
        </div>
      </div>
    </Link>
  );
}

/* ──────────────────────────────────────────────────────────
 * Hero Card — expanded view of the active (center) item
 * ────────────────────────────────────────────────────────── */
function HeroCard({ comic }: { comic: ApiComic }) {
  const t = useTranslation();

  const isNovelByFilename = (filename: string) =>
    /\.(txt|epub|mobi|azw3|html|htm)$/i.test(filename || "");
  const novel =
    comic.type === "comic"
      ? false
      : comic.type === "novel"
        ? true
        : isNovelByFilename(comic.filename);

  const progress =
    comic.pageCount > 0
      ? calculateReadingProgress(comic.lastReadPage, comic.pageCount)
      : 0;
  const href = novel ? `/novel/${comic.id}` : `/reader/${comic.id}`;

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);
    if (diffMin < 1) return t.continueReading?.justNow || "刚刚";
    if (diffMin < 60)
      return `${diffMin}${t.continueReading?.minutesAgo || "分钟前"}`;
    if (diffHour < 24)
      return `${diffHour}${t.continueReading?.hoursAgo || "小时前"}`;
    if (diffDay < 7)
      return `${diffDay}${t.continueReading?.daysAgo || "天前"}`;
    return date.toLocaleDateString();
  };

  return (
    <Link href={href} className="group block">
      <div className="flex items-center gap-5 rounded-2xl border border-purple-500/20 bg-gradient-to-br from-purple-950/30 via-card to-indigo-950/20 p-4 shadow-[0_0_30px_rgba(99,102,241,0.15)] transition-all duration-300 hover:shadow-[0_0_40px_rgba(99,102,241,0.25)]">
        {/* Cover thumbnail */}
        <div className="relative h-[100px] w-[72px] shrink-0 overflow-hidden rounded-lg ring-2 ring-purple-500/40">
          <Image
            src={comic.coverUrl}
            alt={comic.title}
            fill
            unoptimized
            className="object-cover"
            sizes="72px"
          />
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1 space-y-1.5">
          <h3 className="truncate text-sm font-semibold text-foreground">
            {comic.title}
          </h3>
          <p className="text-xs text-muted">
            {novel
              ? `${t.continueReading?.chapter || "第"}${comic.lastReadPage + 1}${t.continueReading?.chapterUnit || "章"}`
              : `${comic.lastReadPage + 1}/${comic.pageCount}${t.continueReading?.pageUnit || "页"}`}
          </p>

          {/* Progress bar */}
          <div className="flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-500"
                style={{ width: `${Math.max(progress, 2)}%` }}
              />
            </div>
            <span className="text-[10px] font-medium text-accent">
              {progress}%
            </span>
          </div>

          {/* Time */}
          <div className="flex items-center gap-1 text-[10px] text-muted">
            <Clock className="h-3 w-3" />
            {formatTime(comic.lastReadAt!)}
          </div>
        </div>

        {/* Play button */}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/20 text-accent transition-colors group-hover:bg-accent/30">
          <ChevronRight className="h-5 w-5" />
        </div>
      </div>
    </Link>
  );
}

/* ──────────────────────────────────────────────────────────
 * ContinueReading — main export
 * ────────────────────────────────────────────────────────── */
export function ContinueReading({ contentType }: { contentType?: string }) {
  const t = useTranslation();
  const [recentComics, setRecentComics] = useState<ApiComic[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState<number | undefined>(
    undefined,
  );

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  // Measure content height for smooth collapse animation
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
      const res = await fetch(`/api/comics?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) {
        console.warn(
          "[ContinueReading] fetch failed",
          res.status,
          await res.text().catch(() => ""),
        );
        return;
      }
      const data = await res.json();
      const all: ApiComic[] = data.comics || [];
      const comics = all.filter(
        (c: ApiComic) =>
          !!c.lastReadAt &&
          c.lastReadPage > 0 &&
          (c.pageCount === 0 || c.lastReadPage < c.pageCount),
      );
      if (import.meta.env.MODE !== "production") {
        // eslint-disable-next-line no-console
        console.debug(
          "[ContinueReading] fetched",
          all.length,
          "comics, filtered to",
          comics.length,
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

  // Clamp activeIndex when comics list changes
  useEffect(() => {
    setActiveIndex((prev) =>
      recentComics.length === 0
        ? 0
        : Math.min(prev, recentComics.length - 1),
    );
  }, [recentComics]);

  /* ── Navigation helpers ── */
  const goLeft = useCallback(() => {
    setActiveIndex((i) => Math.max(0, i - 1));
  }, []);

  const goRight = useCallback(() => {
    setActiveIndex((i) =>
      recentComics.length === 0 ? 0 : Math.min(recentComics.length - 1, i + 1),
    );
  }, [recentComics.length]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (collapsed) return;
      if (e.key === "ArrowLeft") goLeft();
      if (e.key === "ArrowRight") goRight();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [collapsed, goLeft, goRight]);

  /* ── Loading skeleton ── */
  if (loading) {
    return (
      <section className="mb-8 surface-card rounded-2xl p-4 sm:p-5">
        <div className="mb-3 flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-accent" />
          <h2 className="text-sm font-semibold text-foreground">
            {t.continueReading?.title || "继续阅读"}
          </h2>
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

  const activeComic = recentComics[activeIndex];

  return (
    <section className="mb-8 surface-card rounded-2xl p-4 sm:p-5">
      {/* ── Collapsible header ── */}
      <div className="mb-3 flex items-center justify-between">
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

      {/* ── Collapsible content ── */}
      <div
        style={{
          height: collapsed ? 0 : contentHeight ?? "auto",
          overflow: "hidden",
          transition: "height 0.3s ease, opacity 0.3s ease",
          opacity: collapsed ? 0 : 1,
        }}
      >
        <div ref={contentRef} className="space-y-4">
          {/* ── Hero card for active item (desktop only) ── */}
          <div className="hidden sm:block">
            {activeComic && <HeroCard comic={activeComic} />}
          </div>

          {/* ── 3D Cover Flow (desktop) ── */}
          <div className="hidden sm:block">
            <div className="relative flex items-center justify-center">
              {/* Left arrow */}
              <button
                onClick={goLeft}
                disabled={activeIndex === 0}
                className="absolute left-0 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-foreground/60 backdrop-blur-sm transition-all hover:bg-white/10 hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Previous"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>

              {/* 3D scene container */}
              <div
                className="mx-12 flex items-center justify-center overflow-visible"
                style={{
                  perspective: "1000px",
                  perspectiveOrigin: "50% 50%",
                  minHeight: "240px",
                }}
              >
                <div
                  className="flex items-center justify-center"
                  style={{ transformStyle: "preserve-3d" }}
                >
                  {recentComics.map((comic, idx) => {
                    const offset = idx - activeIndex;
                    const absOffset = Math.abs(offset);

                    // Hide cards more than 2 positions away
                    if (absOffset > 2) return null;

                    const isActive = offset === 0;
                    const isLeft = offset < 0;
                    const isRight = offset > 0;

                    // 3D transform per card
                    const translateX = offset * 130; // px horizontal shift
                    const rotateY = isActive
                      ? 0
                      : isLeft
                        ? 25
                        : -25;
                    const scale = isActive ? 1 : 0.85;
                    const opacity = isActive ? 1 : 0.7;
                    const zIndex = 10 - absOffset;
                    const translateZ = isActive ? 40 : -20 * absOffset;

                    return (
                      <div
                        key={comic.id}
                        className="absolute cursor-pointer"
                        style={{
                          transform: `translateX(${translateX}px) translateZ(${translateZ}px) rotateY(${rotateY}deg) scale(${scale})`,
                          opacity,
                          zIndex,
                          transition:
                            "transform 0.45s cubic-bezier(0.22,1,0.36,1), opacity 0.45s cubic-bezier(0.22,1,0.36,1)",
                          transformStyle: "preserve-3d",
                          backfaceVisibility: "hidden",
                        }}
                        onClick={() => setActiveIndex(idx)}
                      >
                        <CoverCard
                          comic={comic}
                          isActive={isActive}
                          onClick={() => setActiveIndex(idx)}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Right arrow */}
              <button
                onClick={goRight}
                disabled={activeIndex === recentComics.length - 1}
                className="absolute right-0 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-foreground/60 backdrop-blur-sm transition-all hover:bg-white/10 hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Next"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* ── Mobile horizontal scroll (no 3D) ── */}
          <div className="sm:hidden">
            <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
              {recentComics.map((comic, idx) => (
                <div
                  key={comic.id}
                  onClick={() => setActiveIndex(idx)}
                >
                  <CoverCard
                    comic={comic}
                    isActive={idx === activeIndex}
                    onClick={() => setActiveIndex(idx)}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
