"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, Sparkles, RefreshCw } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

interface RecommendedComic {
  id: string;
  title: string;
  score: number;
  reasons: string[];
  coverUrl: string;
  author: string;
  genre: string;
  tags: { name: string; color: string }[];
}

export default function RecommendationsPage() {
  const t = useTranslation();
  const [recommendations, setRecommendations] = useState<RecommendedComic[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRecommendations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/recommendations?limit=30&excludeRead=false");
      if (res.ok) {
        const data = await res.json();
        setRecommendations(data.recommendations || []);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchRecommendations();
  }, [fetchRecommendations]);

  const reasonLabels: Record<string, string> = {
    tag_match: t.recommend?.tagMatch || "Similar tags",
    genre_match: t.recommend?.genreMatch || "Similar genre",
    same_author: t.recommend?.sameAuthor || "Same author",
    series_continuation: t.recommend?.seriesContinuation || "Series continuation",
    series_in_progress: t.recommend?.seriesInProgress || "Continue series",
    highly_rated: t.recommend?.highlyRated || "Highly rated",
    unread: t.recommend?.unread || "Unread",
    similar_tags: t.recommend?.similarTags || "Similar tags",
    similar_genre: t.recommend?.similarGenre || "Similar genre",
    same_series: t.recommend?.sameSeries || "Same series",
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-50 border-b border-border/50 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-4 px-6">
          <Link
            href="/"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 text-muted transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-amber-400" />
            <h1 className="text-lg font-bold text-foreground">
              {t.recommend?.title || "Recommended for You"}
            </h1>
          </div>
          <div className="flex-1" />
          <button
            onClick={fetchRecommendations}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-muted transition-colors hover:text-foreground"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {t.recommend?.refresh || "Refresh"}
          </button>
        </div>
      </div>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {loading && recommendations.length === 0 && (
          <div className="flex items-center justify-center py-32">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-accent" />
          </div>
        )}

        {!loading && recommendations.length === 0 && (
          <div className="flex flex-col items-center justify-center py-32 text-center">
            <Sparkles className="mb-4 h-12 w-12 text-muted/30" />
            <p className="text-lg font-medium text-foreground/80">
              {t.common?.noData || "No data"}
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {recommendations.map((comic) => (
            <Link key={comic.id} href={`/comic/${comic.id}`} className="group">
              <div className="space-y-2">
                <div className="relative aspect-[5/7] w-full overflow-hidden rounded-xl bg-card transition-transform group-hover:scale-[1.03]">
                  <Image
                    src={comic.coverUrl}
                    alt={comic.title}
                    fill
                    unoptimized
                    className="object-cover"
                    sizes="200px"
                  />
                  {/* Score badge */}
                  <div className="absolute top-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-amber-400 backdrop-blur-sm">
                    {Math.round(comic.score)}
                  </div>
                  {/* Reason badges */}
                  {comic.reasons.length > 0 && (
                    <div className="absolute bottom-2 left-2 right-2 flex flex-wrap gap-1">
                      {comic.reasons.slice(0, 2).map((reason) => (
                        <span
                          key={reason}
                          className="rounded bg-accent/80 px-1.5 py-0.5 text-[9px] font-medium text-white"
                        >
                          {reasonLabels[reason] || reason}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <p className="line-clamp-2 text-sm font-medium text-foreground/80 group-hover:text-foreground">
                    {comic.title}
                  </p>
                  {comic.author && (
                    <p className="mt-0.5 line-clamp-1 text-xs text-muted">
                      {comic.author}
                    </p>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
