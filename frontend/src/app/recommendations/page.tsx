"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Sparkles, RefreshCw, Brain, Loader2 } from "lucide-react";
import { useTranslation, useLocale } from "@/lib/i18n";
import { useAIStatus } from "@/hooks/useAIStatus";
import { fetchGroupedComicMap, fetchGroups } from "@/api/groups";
import type { ComicGroup } from "@/hooks/useComicTypes";

interface RecommendedComic {
  id: string;
  title: string;
  score: number;
  reasons: string[];
  aiReason?: string;
  coverUrl: string;
  author: string;
  genre: string;
  tags: { name: string; color: string }[];
}

export default function RecommendationsPage() {
  const t = useTranslation();
  const { locale } = useLocale();
  const { aiConfigured } = useAIStatus();
  const searchParams = useSearchParams();
  const contentType = searchParams.get("contentType") || "";
  const [recommendations, setRecommendations] = useState<RecommendedComic[]>([]);
  const [loading, setLoading] = useState(true);
  const [aiReasonsLoading, setAiReasonsLoading] = useState(false);
  const [groupedComicMap, setGroupedComicMap] = useState<Record<string, number[]>>({});
  const [groupsMap, setGroupsMap] = useState<Record<number, ComicGroup>>({});

  // 加载合集映射和合集信息
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

  const fetchRecommendations = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "30", excludeRead: "false" });
      if (contentType) params.set("contentType", contentType);
      const res = await fetch(`/api/recommendations?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setRecommendations((data.recommendations || []).map((c: RecommendedComic) => ({ ...c, aiReason: undefined })));
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [contentType]);

  useEffect(() => {
    fetchRecommendations();
  }, [fetchRecommendations]);

  // 去重：同一合集只显示一次，合集内的漫画替换为合集
  const displayItems = useMemo(() => {
    const seenGroups = new Set<number>();
    const items: { key: string; href: string; title: string; coverUrl: string; reasons: string[]; aiReason?: string; score: number; author?: string }[] = [];
    for (const comic of recommendations) {
      const groupIds = groupedComicMap[comic.id];
      const group = groupIds && groupIds.length > 0 ? groupsMap[groupIds[0]] : null;
      if (group) {
        if (seenGroups.has(group.id)) continue;
        seenGroups.add(group.id);
        items.push({
          key: `group-${group.id}`,
          href: `/group/${group.id}${contentType ? `?contentType=${contentType}` : ""}`,
          title: group.name,
          coverUrl: group.coverUrl,
          reasons: comic.reasons,
          aiReason: comic.aiReason,
          score: comic.score,
        });
      } else {
        items.push({
          key: comic.id,
          href: `/comic/${comic.id}`,
          title: comic.title,
          coverUrl: comic.coverUrl,
          reasons: comic.reasons,
          aiReason: comic.aiReason,
          score: comic.score,
          author: comic.author,
        });
      }
    }
    return items;
  }, [recommendations, groupedComicMap, groupsMap, contentType]);

  // AI 推荐理由生成
  const fetchAiReasons = useCallback(async () => {
    if (aiReasonsLoading || recommendations.length === 0) return;
    setAiReasonsLoading(true);
    try {
      const items = recommendations.slice(0, 10).map((c) => ({
        id: c.id,
        title: c.title,
        reasons: c.reasons,
        genre: c.genre,
        author: c.author,
      }));
      const res = await fetch("/api/recommendations/ai-reasons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetLang: locale, items }),
      });
      if (res.ok) {
        const data = await res.json();
        const reasonsMap: Record<string, string> = data.reasons || {};
        // 将 AI 理由直接合并到 recommendations state 中
        setRecommendations((prev) =>
          prev.map((c) => ({
            ...c,
            aiReason: reasonsMap[c.id] || c.aiReason,
          }))
        );
      }
    } catch { /* ignore */ }
    finally { setAiReasonsLoading(false); }
  }, [aiReasonsLoading, recommendations, locale]);

  const reasonLabels: Record<string, string> = {
    tag_match: t.recommend?.tagMatch || "Similar tags",
    genre_match: t.recommend?.genreMatch || "Similar genre",
    same_author: t.recommend?.sameAuthor || "Same author",
    highly_rated: t.recommend?.highlyRated || "Highly rated",
    unread: t.recommend?.unread || "Unread",
    similar_tags: t.recommend?.similarTags || "Similar tags",
    similar_genre: t.recommend?.similarGenre || "Similar genre",
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-50 border-b border-border/50 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex h-14 sm:h-16 max-w-5xl items-center gap-2 sm:gap-4 px-3 sm:px-6">
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
          {aiConfigured && (
            <button
              onClick={fetchAiReasons}
              disabled={aiReasonsLoading || recommendations.length === 0}
              className="flex items-center gap-1.5 rounded-lg bg-purple-500/10 px-3 py-1.5 text-sm text-purple-400 transition-colors hover:bg-purple-500/20 disabled:opacity-50"
            >
              {aiReasonsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
              <span className="hidden sm:inline">{t.recommend?.aiReasonGenerate || "AI Reasons"}</span>
            </button>
          )}
          <button
            onClick={fetchRecommendations}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-muted transition-colors hover:text-foreground"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">{t.recommend?.refresh || "Refresh"}</span>
          </button>
        </div>
      </div>

      <main className="mx-auto max-w-5xl px-3 sm:px-6 py-6 sm:py-8 pb-24 sm:pb-8">
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

        <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {displayItems.map((item) => (
            <Link key={item.key} href={item.href} className="group">
              <div className="space-y-2">
                <div className="relative aspect-[5/7] w-full overflow-hidden rounded-xl bg-card transition-transform group-hover:scale-[1.03]">
                  <Image
                    src={item.coverUrl}
                    alt={item.title}
                    fill
                    unoptimized
                    className="object-cover"
                    sizes="200px"
                  />
                  {/* Score badge */}
                  <div className="absolute top-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-amber-400 backdrop-blur-sm">
                    {Math.round(item.score)}
                  </div>
                  {/* Reason badges */}
                  {item.reasons.length > 0 && (
                    <div className="absolute bottom-2 left-2 right-2 flex flex-wrap gap-1">
                      {item.reasons.slice(0, 2).map((reason) => (
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
                    {item.title}
                  </p>
                  {item.author && (
                    <p className="mt-0.5 line-clamp-1 text-xs text-muted">
                      {item.author}
                    </p>
                  )}
                  {/* AI 推荐理由 */}
                  {item.aiReason && (
                    <p className="mt-1 line-clamp-2 text-xs leading-snug text-purple-400">
                      <Brain className="mr-1 inline h-3 w-3" />
                      {item.aiReason}
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
