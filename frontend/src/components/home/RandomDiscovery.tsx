"use client";

import { useState, useMemo, useCallback } from "react";
import { Shuffle, Sparkles } from "lucide-react";
import ContentShelf, { ShelfCard } from "./ContentShelf";
import type { ApiComic } from "@/hooks/useComics";
import { calculateReadingProgress } from "@/lib/progress";

interface RandomDiscoveryProps {
  comics: ApiComic[];
  contentType: string;
}

function pickRandom<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

export default function RandomDiscovery({ comics, contentType }: RandomDiscoveryProps) {
  const [key, setKey] = useState(0);

  const randomComics = useMemo(() => {
    const readable = comics.filter((c) => c.type !== "dir");
    if (readable.length <= 8) return readable;
    // Prefer unread for discovery
    const unread = readable.filter((c) => calculateReadingProgress(c.lastReadPage, c.pageCount) === 0);
    const pool = unread.length >= 6 ? unread : readable;
    return pickRandom(pool, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comics, key]);

  const handleShuffle = useCallback(() => {
    setKey((k) => k + 1);
  }, []);

  if (randomComics.length === 0) return null;

  return (
    <ContentShelf
      title="随机发现"
      icon={<Sparkles className="h-4 w-4 text-amber-500" />}
    >
      {randomComics.map((comic) => (
        <ShelfCard
          key={comic.id}
          href={`/comic/${comic.id}`}
          coverUrl={comic.coverUrl}
          title={comic.title}
          subtitle={comic.author || undefined}
          badge={calculateReadingProgress(comic.lastReadPage, comic.pageCount) === 0 ? "未读" : undefined}
          badgeColor="bg-amber-500/10 text-amber-500"
        />
      ))}
      {/* Shuffle button at end */}
      <button
        onClick={handleShuffle}
        className="flex-shrink-0 w-28 sm:w-32 flex flex-col items-center justify-center aspect-[5/7] rounded-xl border-2 border-dashed border-border/40 text-muted hover:text-foreground hover:border-accent/40 hover:bg-accent/5 transition-all duration-200"
      >
        <Shuffle className="h-6 w-6 mb-2" />
        <span className="text-xs font-medium">换一批</span>
      </button>
    </ContentShelf>
  );
}