"use client";

import { Library, BookOpen, Clock } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

interface StatsBarProps {
  totalComics: number;
  filteredCount: number;
}

export default function StatsBar({ totalComics, filteredCount }: StatsBarProps) {
  const t = useTranslation();

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2 text-muted">
          <Library className="h-4 w-4" />
          <span className="text-sm">
            {t.statsBar.total} <span className="font-medium text-foreground">{totalComics}</span> {t.statsBar.unit}
          </span>
        </div>
        {filteredCount !== totalComics && (
          <div className="flex items-center gap-2 text-muted">
            <BookOpen className="h-4 w-4" />
            <span className="text-sm">
              {t.statsBar.filtered} <span className="font-medium text-accent">{filteredCount}</span> {t.statsBar.unit}
            </span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 text-muted">
        <Clock className="h-3.5 w-3.5" />
        <span className="text-xs">{t.statsBar.recentUpdate}</span>
      </div>
    </div>
  );
}
