"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { Layers, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { ApiCategory } from "@/hooks/useComics";

interface CategoryFilterProps {
  categories: ApiCategory[];
  selectedCategory: string | null;
  onCategorySelect: (slug: string | null) => void;
}

export default function CategoryFilter({
  categories,
  selectedCategory,
  onCategorySelect,
}: CategoryFilterProps) {
  const t = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

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
  }, [checkScroll, categories]);

  const scroll = (dir: "left" | "right") => {
    const el = scrollRef.current;
    if (!el) return;
    const amount = el.clientWidth * 0.6;
    el.scrollBy({ left: dir === "left" ? -amount : amount, behavior: "smooth" });
  };

  if (categories.length === 0) return null;

  return (
    <div className="relative flex items-center gap-2">
      {/* Label */}
      <div className="flex items-center gap-1.5 text-muted shrink-0">
        <Layers className="h-3.5 w-3.5" />
        <span className="text-xs font-medium whitespace-nowrap">{t.categoryFilter.label}</span>
      </div>

      {/* Left arrow */}
      {canScrollLeft && (
        <button
          onClick={() => scroll("left")}
          className="absolute left-16 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-background/90 border border-border/60 text-muted hover:text-foreground shadow-sm backdrop-blur-sm transition-all"
          aria-label="Scroll left"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
      )}

      {/* Scrollable tabs */}
      <div
        ref={scrollRef}
        className="flex items-center gap-2 overflow-x-auto scrollbar-hide scroll-smooth"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        <button
          onClick={() => onCategorySelect(null)}
          className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
            selectedCategory === null
              ? "bg-accent/20 border-accent/50 text-accent"
              : "border-border/60 text-muted hover:text-foreground hover:border-border"
          }`}
        >
          {t.common.all}
        </button>

        <button
          onClick={() => onCategorySelect("uncategorized")}
          className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all duration-200 whitespace-nowrap ${
            selectedCategory === "uncategorized"
              ? "bg-zinc-500/20 border-zinc-500/50 text-zinc-300"
              : "border-border/60 text-muted hover:text-foreground hover:border-border"
          }`}
        >
          {t.categoryFilter.uncategorized}
        </button>

        {categories.map((cat) => (
          <button
            key={cat.slug}
            onClick={() => onCategorySelect(cat.slug)}
            className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all duration-200 whitespace-nowrap ${
              selectedCategory === cat.slug
                ? "bg-accent/20 border-accent/50 text-accent"
                : "border-border/60 text-muted hover:text-foreground hover:border-border"
            }`}
          >
            <span className="mr-1">{cat.icon}</span>
            {cat.name}
            {cat.count > 0 && (
              <span className="ml-1 text-[10px] opacity-60">{cat.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Right arrow */}
      {canScrollRight && (
        <button
          onClick={() => scroll("right")}
          className="absolute right-0 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-background/90 border border-border/60 text-muted hover:text-foreground shadow-sm backdrop-blur-sm transition-all"
          aria-label="Scroll right"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      )}

      {/* Left fade */}
      {canScrollLeft && (
        <div className="pointer-events-none absolute left-14 top-0 bottom-0 w-6 bg-gradient-to-r from-background to-transparent z-[5]" />
      )}
      {/* Right fade */}
      {canScrollRight && (
        <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-background to-transparent z-[5]" />
      )}
    </div>
  );
}
