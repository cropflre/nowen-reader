"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { Tag, ChevronLeft, ChevronRight, Languages } from "lucide-react";
import { useTranslation, useLocale } from "@/lib/i18n";

interface TagFilterProps {
  allTags: string[];
  selectedTags: string[];
  onTagToggle: (tag: string) => void;
  onClearAll: () => void;
  onTagsTranslated?: () => void;
}

const tagColorMap: Record<string, string> = {
  Action: "border-red-500/30 text-red-400 hover:bg-red-500/10",
  Romance: "border-pink-500/30 text-pink-400 hover:bg-pink-500/10",
  Comedy: "border-amber-500/30 text-amber-400 hover:bg-amber-500/10",
  Fantasy: "border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/10",
  Horror: "border-purple-500/30 text-purple-400 hover:bg-purple-500/10",
  "Sci-Fi": "border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10",
  Drama: "border-green-500/30 text-green-400 hover:bg-green-500/10",
  "Slice of Life": "border-orange-500/30 text-orange-400 hover:bg-orange-500/10",
  Adventure: "border-blue-500/30 text-blue-400 hover:bg-blue-500/10",
  Mystery: "border-rose-500/30 text-rose-400 hover:bg-rose-500/10",
};

const tagActiveColorMap: Record<string, string> = {
  Action: "bg-red-500/20 border-red-500/50 text-red-300",
  Romance: "bg-pink-500/20 border-pink-500/50 text-pink-300",
  Comedy: "bg-amber-500/20 border-amber-500/50 text-amber-300",
  Fantasy: "bg-indigo-500/20 border-indigo-500/50 text-indigo-300",
  Horror: "bg-purple-500/20 border-purple-500/50 text-purple-300",
  "Sci-Fi": "bg-cyan-500/20 border-cyan-500/50 text-cyan-300",
  Drama: "bg-green-500/20 border-green-500/50 text-green-300",
  "Slice of Life": "bg-orange-500/20 border-orange-500/50 text-orange-300",
  Adventure: "bg-blue-500/20 border-blue-500/50 text-blue-300",
  Mystery: "bg-rose-500/20 border-rose-500/50 text-rose-300",
};

export default function TagFilter({
  allTags,
  selectedTags,
  onTagToggle,
  onClearAll,
  onTagsTranslated,
}: TagFilterProps) {
  const t = useTranslation();
  const { locale } = useLocale();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const MAX_VISIBLE_TAGS = 50;
  const visibleTags = showAll ? allTags : allTags.slice(0, MAX_VISIBLE_TAGS);
  const hasMore = allTags.length > MAX_VISIBLE_TAGS;

  // 超过 10 个标签时默认折叠（仅首次渲染时）
  const [collapsed, setCollapsed] = useState(true);
  const FOLD_THRESHOLD = 10;

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    checkScroll();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", checkScroll, { passive: true });
    const ro = new ResizeObserver(checkScroll);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", checkScroll);
      ro.disconnect();
    };
  }, [checkScroll, allTags]);

  const scroll = (dir: "left" | "right") => {
    const el = scrollRef.current;
    if (!el) return;
    const amount = el.clientWidth * 0.6;
    el.scrollBy({ left: dir === "left" ? -amount : amount, behavior: "smooth" });
  };

  const handleTranslate = useCallback(async () => {
    if (translating) return;
    setTranslating(true);
    try {
      const res = await fetch("/api/tags/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetLang: locale }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.translated > 0) {
          onClearAll(); // Clear selected tags since names changed
          onTagsTranslated?.();
        }
      }
    } catch {
      // ignore
    } finally {
      setTranslating(false);
    }
  }, [translating, locale, onClearAll, onTagsTranslated]);

  return (
    <div className="relative">
      <div className={`flex gap-2 ${showAll ? "items-start" : "items-center"}`}>
        {/* Label + Translate + Fold Toggle */}
        <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
          <div className="flex items-center gap-1.5 text-muted">
            <Tag className="h-3.5 w-3.5" />
            <span className="text-xs font-medium whitespace-nowrap">{t.tagFilter.label}</span>
          </div>
          <button
            onClick={handleTranslate}
            disabled={translating}
            className="flex h-6 items-center gap-1 rounded-md border border-border/40 bg-card/50 px-1.5 text-[10px] font-medium text-muted transition-all hover:text-foreground hover:border-border disabled:opacity-50 disabled:pointer-events-none"
            title={t.tagFilter.translate}
          >
            <Languages className="h-3 w-3" />
            <span>{translating ? t.tagFilter.translating : t.tagFilter.translate}</span>
          </button>
          {/* 折叠/展开切换 */}
          {allTags.length > FOLD_THRESHOLD && (
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="flex h-6 items-center gap-0.5 rounded-md border border-border/40 bg-card/50 px-1.5 text-[10px] font-medium text-muted transition-all hover:text-foreground hover:border-border"
            >
              <ChevronRight className={`h-3 w-3 transition-transform ${collapsed ? "" : "rotate-90"}`} />
              <span>{collapsed ? `${allTags.length}` : t.common.collapse}</span>
            </button>
          )}
        </div>

        {collapsed && allTags.length > FOLD_THRESHOLD ? (
          /* 折叠时：仅显示已选中标签 + 数量提示 */
          <div className="flex items-center gap-2 flex-wrap">
            {selectedTags.length > 0 ? (
              selectedTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => onTagToggle(tag)}
                  className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all duration-200 whitespace-nowrap ${
                    tagActiveColorMap[tag] || "bg-zinc-500/20 border-zinc-500/50 text-zinc-300"
                  }`}
                >
                  {tag} ×
                </button>
              ))
            ) : (
              <span className="text-xs text-muted">
                {allTags.length} {t.tagFilter.label}
              </span>
            )}
          </div>
        ) : showAll ? (
          /* Expanded: wrap mode with max height */
          <div className="flex flex-wrap items-center gap-2 max-h-48 overflow-y-auto pr-1" style={{ scrollbarWidth: "thin" }}>
            {/* All Tag */}
            <button
              onClick={onClearAll}
              className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
                selectedTags.length === 0
                  ? "bg-accent/20 border-accent/50 text-accent"
                  : "border-border/60 text-muted hover:text-foreground hover:border-border"
              }`}
            >
              {t.common.all}
            </button>

            {visibleTags.map((tag) => {
              const isActive = selectedTags.includes(tag);
              return (
                <button
                  key={tag}
                  onClick={() => onTagToggle(tag)}
                  className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all duration-200 whitespace-nowrap ${
                    isActive
                      ? tagActiveColorMap[tag] || "bg-zinc-500/20 border-zinc-500/50 text-zinc-300"
                      : tagColorMap[tag] || "border-border/60 text-muted hover:text-foreground"
                  }`}
                >
                  {tag}
                </button>
              );
            })}

            {/* Collapse button */}
            {hasMore && (
              <button
                onClick={() => setShowAll(false)}
                className="shrink-0 rounded-lg border border-dashed border-border/60 px-3 py-1.5 text-xs font-medium text-muted transition-all hover:text-foreground hover:border-border"
              >
                {`← ${t.common?.collapse || "收起"}`}
              </button>
            )}
          </div>
        ) : (
          /* Collapsed: single-line scroll mode */
          <div className="relative flex-1 min-w-0">
            {/* Left arrow */}
            {canScrollLeft && (
              <button
                onClick={() => scroll("left")}
                className="absolute left-0 top-1/2 -translate-y-1/2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-background/90 border border-border/60 text-muted hover:text-foreground shadow-sm backdrop-blur-sm transition-all"
                aria-label="Scroll left"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
            )}

            <div
              ref={scrollRef}
              className="flex items-center gap-2 overflow-x-auto scrollbar-hide scroll-smooth"
              style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
            >
              {/* All Tag */}
              <button
                onClick={onClearAll}
                className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
                  selectedTags.length === 0
                    ? "bg-accent/20 border-accent/50 text-accent"
                    : "border-border/60 text-muted hover:text-foreground hover:border-border"
                }`}
              >
                {t.common.all}
              </button>

              {visibleTags.map((tag) => {
                const isActive = selectedTags.includes(tag);
                return (
                  <button
                    key={tag}
                    onClick={() => onTagToggle(tag)}
                    className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all duration-200 whitespace-nowrap ${
                      isActive
                        ? tagActiveColorMap[tag] || "bg-zinc-500/20 border-zinc-500/50 text-zinc-300"
                        : tagColorMap[tag] || "border-border/60 text-muted hover:text-foreground"
                    }`}
                  >
                    {tag}
                  </button>
                );
              })}

              {/* Show more button */}
              {hasMore && (
                <button
                  onClick={() => setShowAll(true)}
                  className="shrink-0 rounded-lg border border-dashed border-border/60 px-3 py-1.5 text-xs font-medium text-muted transition-all hover:text-foreground hover:border-border"
                >
                  {`+${allTags.length - MAX_VISIBLE_TAGS} ${t.common?.more || "更多"}`}
                </button>
              )}
            </div>

            {/* Right arrow */}
            {canScrollRight && (
              <button
                onClick={() => scroll("right")}
                className="absolute right-0 top-1/2 -translate-y-1/2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-background/90 border border-border/60 text-muted hover:text-foreground shadow-sm backdrop-blur-sm transition-all"
                aria-label="Scroll right"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            )}

            {/* Left fade */}
            {canScrollLeft && (
              <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-6 bg-gradient-to-r from-background to-transparent z-[5]" />
            )}
            {/* Right fade */}
            {canScrollRight && (
              <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-background to-transparent z-[5]" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
