"use client";

import { useMemo } from "react";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import ComicCard from "@/components/ComicCard";
import type { ApiComic } from "@/hooks/useComics";
import type { Comic } from "@/types/comic";
import type { HomeSectionConfig, CardSize } from "@/hooks/useHomeLayout";
import { getGridColsClasses } from "@/hooks/useHomeLayout";
import { calculateReadingProgress } from "@/lib/progress";

// ============================================================
// Types
// ============================================================

interface CategorySectionProps {
  /** Section title */
  title: string;
  /** Optional icon */
  icon?: React.ReactNode;
  /** Comics to display */
  comics: ApiComic[];
  /** Layout configuration from useHomeLayout */
  sectionConfig: HomeSectionConfig;
  /** Optional "see all" link */
  href?: string;
  /** Optional "see all" label */
  actionLabel?: string;
  /** Whether using real API data (for image optimization) */
  isReal?: boolean;
  /** Additional CSS classes */
  className?: string;
}

// ============================================================
// Helpers
// ============================================================

const SHELF_CARD_WIDTHS: Record<CardSize, string> = {
  sm: "w-28 sm:w-32",
  md: "w-36 sm:w-40 lg:w-44",
  lg: "w-44 sm:w-52 lg:w-60",
};

// ============================================================
// Conversion helper
// ============================================================

function apiToComic(api: ApiComic): Comic {
  return {
    id: api.id,
    title: api.title,
    coverUrl: api.coverUrl,
    coverAspectRatio: api.coverAspectRatio || 0,
    tags: (api.tags || []).map((t) => t.name),
    tagData: api.tags || [],
    pageCount: api.pageCount,
    fileSize: api.fileSize,
    addedAt: api.addedAt || undefined,
    progress: api.pageCount > 0 ? calculateReadingProgress(api.lastReadPage, api.pageCount) : 0,
    lastRead: api.lastReadAt || undefined,
    isFavorite: api.isFavorite,
    rating: api.rating ?? undefined,
    lastReadPage: api.lastReadPage,
    sortOrder: api.sortOrder,
    totalReadTime: api.totalReadTime,
    categories: api.categories || [],
    filename: api.filename,
    author: api.author || undefined,
    type: api.type,
  };
}

// ============================================================
// Component
// ============================================================

export default function CategorySection({
  title,
  icon,
  comics,
  sectionConfig,
  href,
  actionLabel,
  isReal = false,
  className = "",
}: CategorySectionProps) {
  const convertedComics: Comic[] = useMemo(() => comics.map(apiToComic), [comics]);
  if (convertedComics.length === 0) return null;

  const { layout, cardSize, posterAspect, titleMaxLines, showRating, showProgress, showLatestChapter, hideMeta } = sectionConfig;

  return (
    <section className={`mb-4 ${className}`}>
      {/* Section header */}
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground sm:text-base">
          {icon}
          {title}
        </h3>
        {actionLabel && href && (
          <Link
            href={href}
            className="flex items-center gap-1 text-xs text-muted hover:text-accent transition-colors"
          >
            {actionLabel}
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>

      {/* Content area */}
      {layout === "grid" ? (
        <div className={`grid gap-3 ${getGridColsClasses(cardSize)}`}>
          {convertedComics.map((comic, i) => (
            <ComicCard
              key={comic.id}
              comic={comic}
              isReal={isReal}
              posterAspect={posterAspect}
              titleMaxLines={titleMaxLines}
              showRating={showRating}
              showProgress={showProgress}
              hideMeta={hideMeta}
              animationIndex={i < 20 ? i : undefined}
            />
          ))}
        </div>
      ) : layout === "row" ? (
        <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
          {convertedComics.map((comic, i) => (
            <div key={comic.id} className={`flex-shrink-0 ${SHELF_CARD_WIDTHS[cardSize] || SHELF_CARD_WIDTHS.md}`}>
              <ComicCard
                comic={comic}
                isReal={isReal}
                posterAspect={posterAspect}
                titleMaxLines={titleMaxLines}
                showRating={showRating}
                showProgress={showProgress}
                hideMeta={hideMeta}
                compact={titleMaxLines === 1}
                animationIndex={i < 20 ? i : undefined}
              />
            </div>
          ))}
        </div>
      ) : (
        /* shelf layout — horizontal scroll */
        <div className="scrollbar-hide -mx-1 flex gap-3 overflow-x-auto px-1 pb-2" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
          {convertedComics.map((comic, i) => (
            <div key={comic.id} className={`flex-shrink-0 ${SHELF_CARD_WIDTHS[cardSize] || SHELF_CARD_WIDTHS.md}`}>
              <ComicCard
                comic={comic}
                isReal={isReal}
                posterAspect={posterAspect}
                titleMaxLines={titleMaxLines}
                showRating={showRating}
                showProgress={showProgress}
                hideMeta={hideMeta}
                compact={titleMaxLines === 1}
                animationIndex={i < 20 ? i : undefined}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
