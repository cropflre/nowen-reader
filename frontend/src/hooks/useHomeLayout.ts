"use client";

import { useMemo } from "react";

// ============================================================
// Types
// ============================================================

export type SectionLayout = "grid" | "row" | "shelf";
export type CardSize = "sm" | "md" | "lg";

export interface HomeSectionConfig {
  /** Section rendering mode */
  layout: SectionLayout;
  /** Card size preset */
  cardSize: CardSize;
  /** Cover image aspect ratio (CSS value like "3/4", "2/3", "5/7") */
  posterAspect: string;
  /** Title max visible lines (1, 2, or 3) */
  titleMaxLines: 1 | 2 | 3;
  /** Show star rating badge on card */
  showRating: boolean;
  /** Show reading progress bar on card */
  showProgress: boolean;
  /** Show latest chapter info on card */
  showLatestChapter: boolean;
  /** Hide metadata (tags, badges) on card */
  hideMeta: boolean;
}

export type SectionType =
  | "discovery"
  | "explore"
  | "recentlyAdded"
  | "continueReading"
  | "recommendations"
  | "personalSidebar"
  | "mainGrid"
  | "category"
  | string;

// ============================================================
// Layered Defaults
// ============================================================

/** Global defaults — the base layer applied to all sections */
const GLOBAL_DEFAULTS: HomeSectionConfig = {
  layout: "grid",
  cardSize: "md",
  posterAspect: "5/7",
  titleMaxLines: 2,
  showRating: false,
  showProgress: false,
  showLatestChapter: false,
  hideMeta: false,
};

/** Per-section-type overrides — only specify what differs from global */
const SECTION_OVERRIDES: Partial<Record<SectionType, Partial<HomeSectionConfig>>> = {
  discovery: {
    layout: "row",
    cardSize: "lg",
    posterAspect: "3/4",
    titleMaxLines: 2,
    showRating: true,
  },
  explore: {
    layout: "shelf",
    cardSize: "md",
    posterAspect: "5/7",
    titleMaxLines: 1,
    showRating: false,
    hideMeta: true,
  },
  recentlyAdded: {
    layout: "shelf",
    cardSize: "md",
    posterAspect: "5/7",
    titleMaxLines: 1,
    showRating: false,
  },
  continueReading: {
    layout: "shelf",
    cardSize: "md",
    posterAspect: "5/7",
    titleMaxLines: 1,
    showProgress: true,
    showLatestChapter: true,
    hideMeta: true,
  },
  recommendations: {
    layout: "shelf",
    cardSize: "md",
    posterAspect: "3/4",
    titleMaxLines: 1,
    showRating: true,
  },
  personalSidebar: {
    layout: "row",
    cardSize: "sm",
    posterAspect: "1/1",
    titleMaxLines: 1,
    hideMeta: true,
  },
  mainGrid: {
    layout: "grid",
    cardSize: "md",
    posterAspect: "5/7",
    titleMaxLines: 2,
    showRating: true,
  },
  category: {
    layout: "grid",
    cardSize: "md",
    posterAspect: "5/7",
    titleMaxLines: 2,
  },
};

// ============================================================
// Card Size → Tailwind Classes
// ============================================================

const GRID_CARD_CLASSES: Record<CardSize, string> = {
  sm: "w-28 sm:w-32",
  md: "w-36 sm:w-40 lg:w-44",
  lg: "w-44 sm:w-52 lg:w-60",
};

const SHELF_CARD_CLASSES: Record<CardSize, string> = {
  sm: "w-28 sm:w-32 flex-shrink-0",
  md: "w-36 sm:w-40 lg:w-44 flex-shrink-0",
  lg: "w-44 sm:w-52 lg:w-60 flex-shrink-0",
};

const GRID_COLS_CLASSES: Record<CardSize, string> = {
  sm: "grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7",
  md: "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6",
  lg: "grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5",
};

/**
 * Returns the appropriate Tailwind width/size classes for a given card size and layout.
 */
export function getCardSizeClasses(cardSize: CardSize, layout: SectionLayout = "grid"): string {
  if (layout === "shelf" || layout === "row") {
    return SHELF_CARD_CLASSES[cardSize] || SHELF_CARD_CLASSES.md;
  }
  return GRID_CARD_CLASSES[cardSize] || GRID_CARD_CLASSES.md;
}

/**
 * Returns grid template column classes for grid layout.
 */
export function getGridColsClasses(cardSize: CardSize): string {
  return GRID_COLS_CLASSES[cardSize] || GRID_COLS_CLASSES.md;
}

// ============================================================
// Hook
// ============================================================

/**
 * Returns the merged layout configuration for each homepage section type.
 *
 * Layered resolution: GLOBAL_DEFAULTS → SECTION_OVERRIDES[sectionType] → userOverrides
 *
 * @param userOverrides - Optional per-section-type overrides from user settings.
 */
export function useHomeLayout(
  userOverrides?: Partial<Record<SectionType, Partial<HomeSectionConfig>>>
) {
  const getSectionConfig = useMemo(() => {
    return (sectionType: SectionType): HomeSectionConfig => {
      const sectionDefaults = SECTION_OVERRIDES[sectionType] || {};
      const userConfig = userOverrides?.[sectionType] || {};

      return {
        ...GLOBAL_DEFAULTS,
        ...sectionDefaults,
        ...userConfig,
      };
    };
  }, [userOverrides]);

  return { getSectionConfig };
}

export default useHomeLayout;
