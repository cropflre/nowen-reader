"use client";

import { useMemo } from "react";
import { Clock } from "lucide-react";
import ContentShelf, { ShelfCard } from "./ContentShelf";
import type { ApiComic } from "@/hooks/useComics";

interface RecentlyAddedProps {
  comics: ApiComic[];
  contentType: string;
}

export default function RecentlyAdded({ comics, contentType }: RecentlyAddedProps) {
  const recent = useMemo(() => {
    return [...comics]
      .filter((c) => c.type !== "dir")
      .sort((a, b) => new Date(b.addedAt || 0).getTime() - new Date(a.addedAt || 0).getTime())
      .slice(0, 12);
  }, [comics]);

  if (recent.length === 0) return null;

  return (
    <ContentShelf
      title="最近入库"
      icon={<Clock className="h-4 w-4 text-sky-500" />}
    >
      {recent.map((comic) => {
        const isFinished = comic.readingStatus === "finished";
        const isReading = comic.readingStatus === "reading";
        const progressPct =
          isReading && comic.pageCount > 0
            ? Math.round((comic.lastReadPage / comic.pageCount) * 100)
            : undefined;

        return (
          <ShelfCard
            key={comic.id}
            href={`/comic/${comic.id}`}
            coverUrl={comic.coverUrl}
            title={comic.title}
            subtitle={comic.author || undefined}
            badge={comic.isFavorite ? "❤️" : undefined}
            badgeType={isFinished ? "completed" : isReading ? "progress" : null}
            progressPercentage={isFinished ? 100 : progressPct}
          />
        );
      })}
    </ContentShelf>
  );
}