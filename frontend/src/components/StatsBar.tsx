"use client";

import { Library, BookOpen, ArrowUpDown } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

interface StatsBarProps {
  totalComics: number;
  filteredCount: number;
  sortStatus: string;
}

export default function StatsBar({ totalComics, filteredCount, sortStatus }: StatsBarProps) {
  const t = useTranslation();

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3 sm:gap-6">
        <div className="flex items-center gap-1.5 sm:gap-2 text-muted">
          <Library className="h-4 w-4" />
          <span className="text-xs sm:text-sm">
            {t.statsBar.total} <span className="font-medium text-foreground tabular-nums">{totalComics}</span> {t.statsBar.unit}
          </span>
        </div>
        {filteredCount !== totalComics && (
          <div className="flex items-center gap-1.5 sm:gap-2 text-muted">
            <BookOpen className="h-4 w-4" />
            <span className="text-xs sm:text-sm">
              {t.statsBar.filtered} <span className="font-medium text-accent tabular-nums">{filteredCount}</span> {t.statsBar.unit}
            </span>
          </div>
        )}
      </div>
      <div className="hidden sm:flex items-center gap-2 text-muted">
        <ArrowUpDown className="h-3.5 w-3.5" />
        <span className="text-xs">{sortStatus}</span>
      </div>
    </div>
  );
}
