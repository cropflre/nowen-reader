"use client";

import { memo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { BookOpen, Layers } from "lucide-react";
import type { SeriesListItem } from "@/api/series";
import { useTranslation } from "@/lib/i18n";

interface SeriesCardProps {
  series: SeriesListItem;
  viewMode?: "grid" | "list";
}

const SeriesCard = memo(function SeriesCard({ series, viewMode = "grid" }: SeriesCardProps) {
  const t = useTranslation();
  const [coverLoaded, setCoverLoaded] = useState(false);

  const href = `/series/${encodeURIComponent(series.seriesName)}`;

  if (viewMode === "list") {
    return (
      <Link href={href} className="group block">
        <div className="flex items-center gap-3 rounded-xl bg-card p-2 transition-colors hover:bg-card-hover">
          {/* 封面 */}
          <div className="relative h-16 w-11 shrink-0 overflow-hidden rounded-lg bg-muted/20">
            {series.coverUrl && (
              <Image
                src={series.coverUrl}
                alt={series.seriesName}
                fill
                unoptimized
                className="object-cover"
                sizes="44px"
              />
            )}
            {/* 卷数角标 */}
            <div className="absolute -right-0.5 -top-0.5 z-10 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white shadow">
              {series.volumeCount}
            </div>
          </div>

          {/* 信息 */}
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-medium text-foreground/90 group-hover:text-foreground">
              {series.seriesName}
            </h3>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
              <span className="flex items-center gap-1">
                <Layers className="h-3 w-3" />
                {t.series.volumeCount.replace("{count}", String(series.volumeCount))}
              </span>
              <span>·</span>
              <span>{t.series.totalPages.replace("{count}", String(series.totalPages))}</span>
            </div>
            {series.authors && (
              <p className="mt-0.5 truncate text-xs text-muted/70">{series.authors}</p>
            )}
          </div>

          <BookOpen className="h-4 w-4 flex-shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
      </Link>
    );
  }

  // 网格模式
  return (
    <Link href={href} className="group block">
      <div className="overflow-hidden rounded-xl bg-card transition-all duration-200 hover:shadow-lg hover:shadow-black/10">
        {/* 封面区域 — 堆叠效果 */}
        <div className="relative aspect-[5/7] w-full">
          {/* 堆叠背景卡片（仅在多卷时显示） */}
          {series.volumeCount > 1 && (
            <>
              <div className="absolute inset-0 translate-x-1.5 translate-y-1 rounded-lg bg-muted/30" />
              <div className="absolute inset-0 translate-x-0.5 translate-y-0.5 rounded-lg bg-muted/20" />
            </>
          )}

          {/* 主封面 */}
          <div className="relative h-full w-full overflow-hidden rounded-lg">
            {!coverLoaded && (
              <div className="absolute inset-0 animate-pulse bg-muted/20" />
            )}
            {series.coverUrl && (
              <Image
                src={series.coverUrl}
                alt={series.seriesName}
                fill
                unoptimized
                className={`object-cover transition-all duration-300 group-hover:scale-105 ${
                  coverLoaded ? "opacity-100" : "opacity-0"
                }`}
                sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
                onLoad={() => setCoverLoaded(true)}
              />
            )}

            {/* 卷数角标 */}
            <div className="absolute right-1.5 top-1.5 z-10 flex h-6 min-w-6 items-center justify-center rounded-full bg-accent/90 px-1.5 text-xs font-bold text-white shadow-lg backdrop-blur-sm">
              <Layers className="mr-0.5 h-3 w-3" />
              {series.volumeCount}
            </div>
          </div>
        </div>

        {/* 信息区 */}
        <div className="p-3">
          <h3 className="mb-1 truncate text-sm font-medium text-foreground/90 group-hover:text-foreground">
            {series.seriesName}
          </h3>
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <span>{t.series.totalPages.replace("{count}", String(series.totalPages))}</span>
          </div>
          {series.authors && (
            <p className="mt-1 truncate text-xs text-muted/60">{series.authors}</p>
          )}
        </div>
      </div>
    </Link>
  );
});

export default SeriesCard;
