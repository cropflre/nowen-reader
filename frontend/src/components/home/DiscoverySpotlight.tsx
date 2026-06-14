"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { BookOpen, Play, Eye, Shuffle, ChevronRight, Library, Bookmark } from "lucide-react";
import type { ApiComic } from "@/hooks/useComics";
import { calculateReadingProgress, isReadingFinished } from "@/lib/progress";

// ============================================================
// Types
// ============================================================

interface DiscoverySpotlightProps {
  comics: ApiComic[];
  contentType: string;
  totalItems?: number;
  loading?: boolean;
}

type MoodKey = "picks" | "unread" | "latest" | "short" | "random";

interface MoodOption {
  key: MoodKey;
  label: string;
  icon: string;
}

const MOODS: MoodOption[] = [
  { key: "picks", label: "为你精选", icon: "✨" },
  { key: "unread", label: "未读宝藏", icon: "📚" },
  { key: "latest", label: "最近入库", icon: "🆕" },
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
  if (readable.length === 0) return [];
  switch (mood) {
    case "picks": {
      const picks = readable.filter((c) => {
        const pct = calculateReadingProgress(c.lastReadPage, c.pageCount);
        return c.isFavorite || (pct > 0 && pct < 100);
      });
      return picks.length >= 4 ? pickRandom(picks, 5) : pickRandom(readable, 5);
    }
    case "unread": {
      const unread = readable.filter((c) => calculateReadingProgress(c.lastReadPage, c.pageCount) === 0);
      return unread.length >= 4 ? pickRandom(unread, 5) : pickRandom(readable, 5);
    }
    case "latest": {
      const sorted = [...readable].sort(
        (a, b) => new Date(b.addedAt || 0).getTime() - new Date(a.addedAt || 0).getTime()
      );
      return sorted.slice(0, 5);
    }
    case "short": {
      const short = readable.filter((c) => c.pageCount && c.pageCount > 0 && c.pageCount <= 50);
      return short.length >= 4 ? pickRandom(short, 5) : pickRandom(readable, 5);
    }
    case "random":
      return pickRandom(readable, 5);
    default:
      return pickRandom(readable, 5);
  }
}

function getMoodHint(mood: MoodKey): string {
  switch (mood) {
    case "picks": return "从你的书库里挑了几本值得打开的作品";
    case "unread": return "还没翻过的书，试试看有没有惊喜";
    case "latest": return "刚到书库的新鲜内容";
    case "short": return "50 页以内，适合快速阅读";
    case "random": return "看看命运给你安排了什么";
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

export default function DiscoverySpotlight({ comics, contentType, totalItems, loading }: DiscoverySpotlightProps) {
  const [mood, setMood] = useState<MoodKey>("picks");
  const [shuffleKey, setShuffleKey] = useState(0);

  const filtered = useMemo(() => {
    return filterByMood(comics, mood);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comics, mood, shuffleKey]);

  const spotlight = filtered[0];
  const sideComics = filtered.slice(1, 5);

  const handleShuffle = useCallback(() => {
    setShuffleKey((k) => k + 1);
  }, []);

  const handleRandomOne = useCallback(() => {
    setMood("random");
    setShuffleKey((k) => k + 1);
  }, []);

  // Subtle animation on spotlight change
  const [animClass, setAnimClass] = useState("opacity-100 translate-y-0");
  useEffect(() => {
    setAnimClass("opacity-0 translate-y-2");
    const t = setTimeout(() => setAnimClass("opacity-100 translate-y-0"), 50);
    return () => clearTimeout(t);
  }, [spotlight?.id]);

  if (loading || comics.length === 0) return null;

  // Bento data
  const unreadCount = comics.filter(c => c.type !== 'dir' && calculateReadingProgress(c.lastReadPage, c.pageCount) === 0).length;
  const latestComics = [...comics.filter(c => c.type !== 'dir')].sort((a, b) => new Date(b.addedAt || 0).getTime() - new Date(a.addedAt || 0).getTime()).slice(0, 4);
  const randomPool = comics.filter(c => c.type !== 'dir');
  const randomComics = randomPool.sort(() => Math.random() - 0.5).slice(0, 4);

  return (
    <section className="relative mb-6 overflow-hidden rounded-3xl border border-border/30 bg-card/70 backdrop-blur-xl shadow-lg">
      {/* Background: blurred cover */}
      {spotlight?.coverUrl && (
        <div className="absolute inset-0 z-0 overflow-hidden" aria-hidden="true">
          <img
            src={spotlight.coverUrl}
            alt=""
            className="absolute inset-0 h-full w-full scale-150 object-cover opacity-[0.08] blur-3xl dark:opacity-[0.06]"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-card/80 via-card/90 to-card" />
        </div>
      )}

      <div className="relative z-10 p-4 sm:p-5 lg:p-6">
        {/* Spotlight — full width */}
        <div className={`transition-all duration-300 ease-out ${animClass}`}>

          {/* Main Spotlight Card: full width */}
          {spotlight && (
            <Link
              href={`/comic/${spotlight.id}`}
              className="group relative block overflow-hidden rounded-2xl bg-background/40 backdrop-blur-sm border border-border/20 transition-all duration-300 hover:shadow-xl hover:border-border/40"
            >
              <div className="flex flex-col sm:flex-row gap-4 p-4 sm:p-5 lg:p-6">
                {/* Cover - big */}
                <div className="relative mx-auto sm:mx-0 w-40 sm:w-52 lg:w-60 flex-shrink-0 overflow-hidden rounded-xl shadow-lg transition-transform duration-300 group-hover:scale-[1.03]">
                  <div className="aspect-[5/7] relative bg-gradient-to-br from-muted/30 to-card dark:from-muted/20">
                    <Image
                      src={spotlight.coverUrl || '/api/placeholder/288/403'}
                      alt={spotlight.title}
                      fill
                      className="object-contain p-0.5 drop-shadow-lg"
                      sizes="240px"
                    />
                  </div>
                </div>

                {/* Info panel */}
                <div className="flex flex-1 flex-col justify-center min-w-0">
                  <p className="text-xs text-muted mb-1">今天想看点什么？</p>

                  <div className="flex flex-wrap items-center gap-1.5 mb-2">
                    <span className="inline-flex items-center rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">
                      {contentType === 'novel' ? '小说' : '漫画'}
                    </span>
                    <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                      {getStatusLabel(spotlight)}
                    </span>
                    {spotlight.isFavorite && <span className="text-xs">❤️</span>}
                    {spotlight.pageCount > 0 && <span className="text-[10px] text-muted">{spotlight.pageCount} 页</span>}
                  </div>

                  <h3 className="text-lg font-bold text-foreground line-clamp-2 sm:text-xl lg:text-2xl">
                    {spotlight.title}
                  </h3>
                  {spotlight.author && <p className="mt-1 text-sm text-muted">{spotlight.author}</p>}

                  {spotlight.tags && spotlight.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {spotlight.tags.slice(0, 5).map((tag) => (
                        <span key={tag.name} className="rounded-full bg-background/60 px-2 py-0.5 text-[10px] text-muted">{tag.name}</span>
                      ))}
                    </div>
                  )}

                  <div className="mt-2 flex items-center gap-3 text-[11px] text-muted">
                    {totalItems ? <span>{totalItems} 项内容</span> : null}
                    {unreadCount > 0 ? <span>· {unreadCount} 本未读</span> : null}
                    <span>· {getMoodHint(mood)}</span>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover">
                      <Play className="h-4 w-4" />
                      {calculateReadingProgress(spotlight.lastReadPage, spotlight.pageCount) > 0 ? '继续阅读' : '开始阅读'}
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-xl border border-border/40 px-5 py-2.5 text-sm text-muted hover:text-foreground transition-colors">
                      <Eye className="h-4 w-4" /> 详情
                    </span>
                    <button
                      onClick={(e) => { e.preventDefault(); handleRandomOne(); }}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-border/40 px-5 py-2.5 text-sm text-muted hover:text-foreground transition-colors"
                    >
                      <Shuffle className="h-4 w-4" /> 随机一本
                    </button>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {MOODS.map((m) => (
                      <button
                        key={m.key}
                        onClick={(e) => { e.preventDefault(); setMood(m.key); }}
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-all duration-200 ${
                          mood === m.key
                            ? 'bg-accent text-white shadow-sm shadow-accent/25'
                            : 'bg-background/50 border border-border/30 text-muted hover:text-foreground hover:border-border/50'
                        }`}
                      >
                        <span className="text-[10px]">{m.icon}</span>
                        {m.label}
                      </button>
                    ))}
                    <button
                      onClick={(e) => { e.preventDefault(); handleShuffle(); }}
                      className="inline-flex items-center gap-1 rounded-full border border-border/40 px-2.5 py-1 text-[11px] font-medium text-muted hover:text-foreground transition-colors"
                    >
                      <Shuffle className="h-3 w-3" /> 换一批
                    </button>
                  </div>
                </div>
              </div>
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}