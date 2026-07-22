"use client";

import { useState, useMemo, useCallback } from "react";
import { Clock, BookOpen, Sparkles, Zap, Shuffle } from "lucide-react";
import ContentShelf, { ShelfCard } from "./ContentShelf";
import type { ApiComic } from "@/hooks/useComics";
import { calculateStoredReadingProgress } from "@/lib/progress";

// ============================================================
// Types
// ============================================================

interface ExploreChannelProps {
  comics: ApiComic[];
  contentType?: string;
}

type ExploreTab = "latest" | "unread" | "random" | "short";

interface TabDef {
  key: ExploreTab;
  label: string;
  mobileLabel: string;
  icon: React.ReactNode;
}

const TABS: TabDef[] = [
  { key: "latest", label: "最近入库", mobileLabel: "入库", icon: <Clock className="h-3 w-3" /> },
  { key: "unread", label: "未读宝藏", mobileLabel: "未读", icon: <BookOpen className="h-3 w-3" /> },
  { key: "random", label: "随机发现", mobileLabel: "随机", icon: <Sparkles className="h-3 w-3" /> },
  { key: "short", label: "短篇速读", mobileLabel: "短篇", icon: <Zap className="h-3 w-3" /> },
];

// ============================================================
// Helpers
// ============================================================

function pickRandom<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function storedProgress(comic: ApiComic): number {
  return calculateStoredReadingProgress(comic.lastReadPage, comic.pageCount, comic.lastReadAt, comic.readingStatus);
}

// ============================================================
// Component
// ============================================================

export default function ExploreChannel({ comics, contentType }: ExploreChannelProps) {
  const [activeTab, setActiveTab] = useState<ExploreTab>("latest");
  const [shuffleKey, setShuffleKey] = useState(0);

  const handleShuffle = useCallback(() => {
    setShuffleKey((k) => k + 1);
  }, []);

  const shelfComics = useMemo(() => {
    const readable = comics.filter((c) => c.type !== "dir");
    if (readable.length === 0) return [];
    switch (activeTab) {
      case "latest": {
        return [...readable]
          .sort((a, b) => new Date(b.addedAt || 0).getTime() - new Date(a.addedAt || 0).getTime())
          .slice(0, 16);
      }
      case "unread": {
        const unread = readable.filter((c) => storedProgress(c) === 0);
        return unread.length >= 6 ? pickRandom(unread, 16) : pickRandom(readable, 16);
      }
      case "random":
        return pickRandom(readable, 16);
      case "short": {
        const short = readable.filter((c) => c.pageCount && c.pageCount > 0 && c.pageCount <= 50);
        return short.length >= 6 ? pickRandom(short, 16) : pickRandom(readable, 16);
      }
      default:
        return pickRandom(readable, 16);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comics, activeTab, shuffleKey]);

  if (comics.length === 0) return null;

  return (
    <section className="mb-4">
      {/* Tab header */}
      <div className="mb-2">
        {/* Title + shuffle row */}
        <div className="flex items-center justify-between mb-2 sm:mb-0">
          <h3 className="text-sm font-semibold text-foreground sm:text-base">
            探索频道
          </h3>
          <button
            onClick={handleShuffle}
            className="inline-flex items-center gap-1 text-xs text-muted hover:text-accent transition-colors shrink-0"
          >
            <Shuffle className="h-3 w-3" />
            <span className="hidden sm:inline">换一批</span>
            <span className="sm:hidden">换</span>
          </button>
        </div>
        {/* Tabs — horizontal scroll on mobile */}
        <div className="-mx-4 overflow-x-auto px-4 scrollbar-hide sm:mx-0 sm:px-0" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
          <div className="flex items-center gap-1.5 sm:gap-1 min-w-max">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`inline-flex items-center gap-1 shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
                  activeTab === tab.key
                    ? "bg-accent/10 text-accent"
                    : "text-muted hover:text-foreground hover:bg-card-hover"
                }`}
              >
                {tab.icon}
                <span className="sm:hidden">{tab.mobileLabel}</span>
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>


      {/* Horizontal shelf */}
      <ContentShelf title="" className="mb-0">
        {shelfComics.map((comic) => {
          const pct = storedProgress(comic);
          return (
            <ShelfCard
              key={comic.id}
              href={`/comic/${comic.id}`}
              coverUrl={comic.coverUrl}
              title={comic.title}
              subtitle={comic.author || undefined}
              badge={
                activeTab === "unread" && pct === 0 ? "未读" :
                activeTab === "short" && comic.pageCount ? `${comic.pageCount}p` :
                comic.isFavorite ? "❤️" : undefined
              }
              badgeColor={
                activeTab === "unread" ? "bg-amber-500/10 text-amber-500" :
                activeTab === "short" ? "bg-sky-500/10 text-sky-500" :
                "bg-accent/10 text-accent"
              }
              progress={pct > 0 && pct < 100 ? pct : undefined}
            />
          );
        })}
      </ContentShelf>
    </section>
  );
}
