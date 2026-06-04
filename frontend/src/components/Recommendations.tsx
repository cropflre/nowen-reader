"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import { Sparkles, ChevronRight, ChevronUp, ChevronDown, RefreshCw } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { fetchGroupedComicMap, fetchGroups } from "@/api/groups";
import type { ComicGroup } from "@/hooks/useComicTypes";

interface RecommendedComic {
  id: string;
  title: string;
  score: number;
  reasons: string[];
  coverUrl: string;
  author: string;
  genre: string;
  filename: string;
  tags: { name: string; color: string }[];
}

export function RecommendationStrip({ contentType }: { contentType?: string }) {
  const t = useTranslation();
  const [recommendations, setRecommendations] = useState<RecommendedComic[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState<number | undefined>(undefined);
  const [groupedComicMap, setGroupedComicMap] = useState<Record<string, number[]>>({});
  const [groupsMap, setGroupsMap] = useState<Record<number, ComicGroup>>({});

  const fetchRecommendations = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "8", excludeRead: "false", shuffle: "true" });
      if (contentType) params.set("contentType", contentType);
      const res = await fetch(`/api/recommendations?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setRecommendations(data.recommendations || []);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [contentType]);

  // 加载合集映射和合集信息，用于判断推荐漫画是否在合集内
  useEffect(() => {
    Promise.all([
      fetchGroupedComicMap(),
      fetchGroups(contentType || undefined),
    ]).then(([comicMap, groups]) => {
      setGroupedComicMap(comicMap);
      const map: Record<number, ComicGroup> = {};
      for (const g of groups) map[g.id] = g;
      setGroupsMap(map);
    }).catch(() => { /* ignore fetch errors */ });
  }, [contentType]);

  useEffect(() => {
    fetchRecommendations();
  }, [fetchRecommendations]);

  // 去重：同一合集只显示一次，合集内的漫画替换为合集
  const displayItems = useMemo(() => {
    const seenGroups = new Set<number>();
    const items: { key: string; href: string; title: string; coverUrl: string; reasons: string[] }[] = [];
    for (const comic of recommendations) {
      const groupIds = groupedComicMap[comic.id];
      const group = groupIds && groupIds.length > 0 ? groupsMap[groupIds[0]] : null;
      if (group) {
        if (seenGroups.has(group.id)) continue; // 同一合集已添加，跳过
        seenGroups.add(group.id);
        items.push({
          key: `group-${group.id}`,
          href: `/group/${group.id}${contentType ? `?contentType=${contentType}` : ""}`,
          title: group.name,
          coverUrl: group.coverUrl,
          reasons: comic.reasons,
        });
      } else {
        items.push({
          key: comic.id,
          href: `/comic/${comic.id}`,
          title: comic.title,
          coverUrl: comic.coverUrl,
          reasons: comic.reasons,
        });
      }
    }
    return items;
  }, [recommendations, groupedComicMap, groupsMap, contentType]);

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
    highly_rated: t.recommend?.highlyRated || "Highly rated",
    unread: t.recommend?.unread || "Unread",
    similar_tags: t.recommend?.similarTags || "Similar tags",
    similar_genre: t.recommend?.similarGenre || "Similar genre",
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
            {displayItems.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                className="group shrink-0"
              >
                <div className="w-[130px] space-y-2">
                  <div className="relative aspect-[5/7] w-full overflow-hidden rounded-lg bg-card transition-transform group-hover:scale-105">
                    <Image
                      src={item.coverUrl}
                      alt={item.title}
                      fill
                      unoptimized
                      className="object-cover"
                      sizes="130px"
                    />
                    {/* Reason badge */}
                    {item.reasons.length > 0 && (
                      <div className="absolute bottom-1 left-1 right-1">
                        <span className="inline-block rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white/80 backdrop-blur-sm">
                          {reasonLabels[item.reasons[0]] || item.reasons[0]}
                        </span>
                      </div>
                    )}
                  </div>
                  <p className="line-clamp-2 text-xs font-medium text-foreground/80 group-hover:text-foreground">
                    {item.title}
                  </p>
                </div>
              </Link>
            ))}

            {/* See more */}
            <Link
              href={`/recommendations${contentType ? `?contentType=${contentType}` : ""}`}
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
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 sm:gap-3">
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
