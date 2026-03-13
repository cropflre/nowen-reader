"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { Sparkles, ChevronRight, ChevronUp, ChevronDown, RefreshCw } from "lucide-react";
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

export function RecommendationStrip() {
  const t = useTranslation();
  const [recommendations, setRecommendations] = useState<RecommendedComic[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState<number | undefined>(undefined);

  const fetchRecommendations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/recommendations?limit=8&excludeRead=false");
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

  // Measure content height for smooth animation
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
  }, [recommendations]);

  if (loading && recommendations.length === 0) return null;
  if (recommendations.length === 0) return null;

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
    semantic_match: t.recommend?.semanticMatch || "AI semantic match",
  };

  return (
    <div className="mb-8">
      <div className="mb-4 flex items-center justify-between">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-2 transition-colors hover:opacity-80"
        >
          <Sparkles className="h-5 w-5 text-amber-400" />
          <h2 className="text-sm font-semibold text-foreground">
            {t.recommend?.title || "Recommended for You"}
          </h2>
          {collapsed ? (
            <ChevronDown className="h-4 w-4 text-muted" />
          ) : (
            <ChevronUp className="h-4 w-4 text-muted" />
          )}
        </button>
        <div className="flex items-center gap-2">
          {!collapsed && (
            <button
              onClick={fetchRecommendations}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted transition-colors hover:text-foreground"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              {t.recommend?.refresh || "Refresh"}
            </button>
          )}
        </div>
      </div>

      <div
        style={{
          height: collapsed ? 0 : contentHeight ?? "auto",
          overflow: "hidden",
          transition: "height 0.3s ease, opacity 0.3s ease",
          opacity: collapsed ? 0 : 1,
        }}
      >
        <div ref={contentRef}>
          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
            {recommendations.map((comic) => (
              <Link
                key={comic.id}
                href={`/comic/${comic.id}`}
                className="group shrink-0"
              >
                <div className="w-[130px] space-y-2">
                  <div className="relative aspect-[5/7] w-full overflow-hidden rounded-lg bg-card transition-transform group-hover:scale-105">
                    <Image
                      src={comic.coverUrl}
                      alt={comic.title}
                      fill
                      unoptimized
                      className="object-cover"
                      sizes="130px"
                    />
                    {/* Reason badge */}
                    {(comic.reasons || []).length > 0 && (
                      <div className="absolute bottom-1 left-1 right-1">
                        <span className="inline-block rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white/80 backdrop-blur-sm">
                          {reasonLabels[(comic.reasons || [])[0]] || (comic.reasons || [])[0]}
                        </span>
                      </div>
                    )}
                  </div>
                  <p className="line-clamp-2 text-xs font-medium text-foreground/80 group-hover:text-foreground">
                    {comic.title}
                  </p>
                </div>
              </Link>
            ))}

            {/* See more */}
            <Link
              href="/recommendations"
              className="flex w-[130px] shrink-0 items-center justify-center rounded-lg border border-border/40 bg-card/30 transition-colors hover:bg-card"
            >
              <div className="flex flex-col items-center gap-1 text-muted">
                <ChevronRight className="h-5 w-5" />
                <span className="text-xs">{t.recommend?.seeMore || "See more"}</span>
              </div>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Similar comics component for comic detail page
 */
export function SimilarComics({ comicId }: { comicId: string }) {
  const t = useTranslation();
  const [similar, setSimilar] = useState<RecommendedComic[]>([]);

  useEffect(() => {
    fetch(`/api/recommendations/similar/${comicId}?limit=5`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data?.similar) setSimilar(data.similar);
      })
      .catch(() => {});
  }, [comicId]);

  if (similar.length === 0) return null;

  return (
    <div>
      <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
        {t.recommend?.similar || "Similar Comics"}
      </h3>
      <div className="grid grid-cols-5 gap-3">
        {similar.map((comic) => (
          <Link key={comic.id} href={`/comic/${comic.id}`} className="group">
            <div className="relative aspect-[5/7] overflow-hidden rounded-lg bg-card transition-transform group-hover:scale-105">
              <Image
                src={comic.coverUrl}
                alt={comic.title}
                fill
                unoptimized
                className="object-cover"
                sizes="120px"
              />
            </div>
            <p className="mt-1 line-clamp-1 text-xs text-foreground/70 group-hover:text-foreground">
              {comic.title}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
