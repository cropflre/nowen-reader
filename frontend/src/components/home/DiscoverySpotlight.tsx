"use client";

import { useState, useMemo, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { BookOpen, Play, RefreshCw, Eye, Shuffle, ChevronRight } from "lucide-react";
import type { ApiComic } from "@/hooks/useComics";
import { calculateReadingProgress, isReadingFinished } from "@/lib/progress";

// ============================================================
// Types
// ============================================================

interface DiscoverySpotlightProps {
  comics: ApiComic[];
  contentType: string;
  loading?: boolean;
}

type MoodKey = "picks" | "latest" | "unread" | "short" | "random";

interface MoodOption {
  key: MoodKey;
  label: string;
  icon: string;
}

const MOODS: MoodOption[] = [
  { key: "picks", label: "为你精选", icon: "✨" },
  { key: "latest", label: "最近入库", icon: "🆕" },
  { key: "unread", label: "未读宝藏", icon: "📚" },
  { key: "short", label: "短篇速读", icon: "⚡" },
  { key: "random", label: "随机盲盒", icon: "🎲" },
];

// ============================================================
// Helpers
// ============================================================

function pickRandom<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function filterByMood(comics: ApiComic[], mood: MoodKey): ApiComic[] {
  const readable = comics.filter((c) => c.type !== "dir");
  switch (mood) {
    case "picks": {
      // Favorited + high progress + recently read
      const picks = readable.filter((c) => {
        const pct = calculateReadingProgress(c.lastReadPage, c.pageCount);
        return c.isFavorite || (pct > 30 && pct < 100);
      });
      return picks.length >= 4 ? pickRandom(picks, 6) : pickRandom(readable, 6);
    }
    case "latest": {
      const sorted = [...readable].sort(
        (a, b) => new Date(b.addedAt || 0).getTime() - new Date(a.addedAt || 0).getTime()
      );
      return sorted.slice(0, 6);
    }
    case "unread": {
      const unread = readable.filter((c) => calculateReadingProgress(c.lastReadPage, c.pageCount) === 0);
      return unread.length >= 4 ? pickRandom(unread, 6) : pickRandom(readable, 6);
    }
    case "short": {
      const short = readable.filter(
        (c) => c.pageCount && c.pageCount > 0 && c.pageCount <= 50
      );
      return short.length >= 4 ? pickRandom(short, 6) : pickRandom(readable, 6);
    }
    case "random":
      return pickRandom(readable, 6);
    default:
      return pickRandom(readable, 6);
  }
}

function getMoodDescription(mood: MoodKey): string {
  switch (mood) {
    case "picks": return "根据你的阅读偏好和收藏，为你挑选的作品";
    case "latest": return "最近添加到书库的新内容";
    case "unread": return "还没翻过的书，试试看有没有惊喜";
    case "short": return "50 页以内的短篇，适合快速阅读";
    case "random": return "从书库中随机抽取，看看命运安排";
    default: return "";
  }
}

function getStatusLabel(comic: ApiComic): string {
  const pct = calculateReadingProgress(comic.lastReadPage, comic.pageCount);
  if (comic.readingStatus === "finished" || isReadingFinished(comic.lastReadPage, comic.pageCount)) return "已读完";
  if (pct > 0) return `读到 ${pct}%`;
  return "未读";
}

// ============================================================
// Component
// ============================================================

export default function DiscoverySpotlight({ comics, contentType, loading }: DiscoverySpotlightProps) {
  const [mood, setMood] = useState<MoodKey>("picks");
  const [shuffleKey, setShuffleKey] = useState(0);

  const filtered = useMemo(() => {
    return filterByMood(comics, mood);
    // shuffleKey triggers recalculation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comics, mood, shuffleKey]);

  const spotlight = filtered[0];
  const sideComics = filtered.slice(1, 5);

  const handleShuffle = useCallback(() => {
    setShuffleKey((k) => k + 1);
  }, []);

  const handleNextMood = useCallback(() => {
    setMood((prev) => {
      const idx = MOODS.findIndex((m) => m.key === prev);
      return MOODS[(idx + 1) % MOODS.length].key;
    });
  }, []);

  if (loading || comics.length === 0) return null;

  return (
    <section className="mb-6 space-y-4">
      {/* Personal greeting */}
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground sm:text-xl">
            今天想看点什么？
          </h2>
          <p className="mt-0.5 text-xs text-muted sm:text-sm">
            {getMoodDescription(mood)}
          </p>
        </div>
      </div>

      {/* Mood chips */}
      <div className="flex flex-wrap gap-2">
        {MOODS.map((m) => (
          <button
            key={m.key}
            onClick={() => setMood(m.key)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
              mood === m.key
                ? "bg-accent text-white shadow-sm shadow-accent/25"
                : "bg-card border border-border/40 text-muted hover:text-foreground hover:border-border/60"
            }`}
          >
            <span>{m.icon}</span>
            {m.label}
          </button>
        ))}
        <button
          onClick={handleShuffle}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium bg-card border border-border/40 text-muted hover:text-foreground hover:border-border/60 transition-all duration-200"
          title="换一批"
        >
          <Shuffle className="h-3 w-3" />
          换一批
        </button>
      </div>

      {/* Spotlight + side covers */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
        {/* Main spotlight */}
        {spotlight && (
          <Link
            href={`/comic/${spotlight.id}`}
            className="group relative overflow-hidden rounded-2xl sm:col-span-8 transition-all duration-300 hover:shadow-xl"
          >
            {/* Background gradient from cover */}
            <div className="absolute inset-0 bg-gradient-to-br from-accent/10 via-card to-card" />
            <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-transparent to-transparent" />

            <div className="relative flex flex-col sm:flex-row gap-4 p-4 sm:p-6">
              {/* Cover */}
              <div className="relative mx-auto sm:mx-0 w-32 sm:w-40 flex-shrink-0 overflow-hidden rounded-xl shadow-lg transition-transform duration-300 group-hover:scale-[1.02]">
                <div className="aspect-[5/7] relative bg-muted">
                  <Image
                    src={spotlight.coverUrl || "/api/placeholder/320/448"}
                    alt={spotlight.title}
                    fill
                    className="object-cover"
                    sizes="160px"
                  />
                </div>
              </div>

              {/* Info */}
              <div className="flex flex-1 flex-col justify-center min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="inline-flex items-center rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
                    {contentType === "novel" ? "小说" : "漫画"}
                  </span>
                  <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-500">
                    {getStatusLabel(spotlight)}
                  </span>
                  {spotlight.isFavorite && (
                    <span className="text-xs">❤️</span>
                  )}
                </div>
                <h3 className="text-lg font-bold text-foreground line-clamp-2 sm:text-xl">
                  {spotlight.title}
                </h3>
                {spotlight.author && (
                  <p className="mt-1 text-sm text-muted">{spotlight.author}</p>
                )}
                {spotlight.tags && spotlight.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {spotlight.tags.slice(0, 4).map((tag) => (
                      <span
                        key={tag.name}
                        className="rounded-full bg-background/50 px-2 py-0.5 text-[10px] text-muted"
                      >
                        {tag.name}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-3 flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover">
                    <Play className="h-4 w-4" />
                    {calculateReadingProgress(spotlight.lastReadPage, spotlight.pageCount) > 0 ? "继续阅读" : "开始阅读"}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-xl border border-border/40 px-4 py-2 text-sm text-muted hover:text-foreground transition-colors">
                    <Eye className="h-4 w-4" />
                    详情
                  </span>
                </div>
              </div>
            </div>
          </Link>
        )}

        {/* Side covers */}
        {sideComics.length > 0 && (
          <div className="sm:col-span-4 grid grid-cols-2 sm:grid-cols-2 gap-2">
            {sideComics.map((comic) => (
              <Link
                key={comic.id}
                href={`/comic/${comic.id}`}
                className="group relative overflow-hidden rounded-xl transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5"
              >
                <div className="aspect-[5/7] relative bg-muted">
                  <Image
                    src={comic.coverUrl || "/api/placeholder/160/224"}
                    alt={comic.title}
                    fill
                    className="object-cover transition-transform duration-300 group-hover:scale-105"
                    sizes="120px"
                  />
                  {/* Gradient overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-2">
                    <p className="text-xs font-medium text-white line-clamp-2">
                      {comic.title}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}