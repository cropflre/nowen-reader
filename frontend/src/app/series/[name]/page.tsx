"use client";

import { useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, BookOpen, Layers, Play, Clock } from "lucide-react";
import { useSeriesDetail } from "@/hooks/useSeries";
import { useTranslation, useLocale } from "@/lib/i18n";

export default function SeriesDetailPage() {
  const params = useParams();
  const router = useRouter();
  const t = useTranslation();
  const { locale } = useLocale();
  const seriesName = decodeURIComponent(params.name as string);

  const { data, loading } = useSeriesDetail(seriesName);

  // 找到用户上次阅读到的卷
  const findContinueVolume = useCallback(() => {
    if (!data?.volumes?.length) return null;
    // 找最后一个有阅读进度的卷
    let lastReadVol: typeof data.volumes[0] | null = null;
    for (const vol of data.volumes) {
      if (vol.lastReadPage > 0) {
        lastReadVol = vol;
      }
    }
    // 如果最后读的卷已读完，尝试下一卷
    if (lastReadVol && lastReadVol.lastReadPage >= lastReadVol.pageCount - 1) {
      const idx = data.volumes.indexOf(lastReadVol);
      if (idx < data.volumes.length - 1) {
        return data.volumes[idx + 1];
      }
    }
    return lastReadVol || data.volumes[0];
  }, [data]);

  const continueVolume = findContinueVolume();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-accent" />
      </div>
    );
  }

  if (!data || !data.comics.length) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background">
        <Layers className="mb-4 h-12 w-12 text-muted/30" />
        <p className="text-lg font-medium text-foreground/80">{t.series.noSeries}</p>
        <button
          onClick={() => router.back()}
          className="mt-4 rounded-lg bg-accent px-4 py-2 text-white"
        >
          {t.common.back}
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* 头部 */}
      <div className="sticky top-0 z-50 border-b border-border/50 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex h-14 sm:h-16 max-w-5xl items-center gap-3 sm:gap-4 px-3 sm:px-6">
          <button
            onClick={() => router.back()}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 text-muted transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold text-foreground">{seriesName}</h1>
            <p className="text-xs text-muted">
              {t.series.volumeCount.replace("{count}", String(data.volumes.length))}
              {" · "}
              {t.series.totalPages.replace("{count}", String(data.totalPages))}
            </p>
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-5xl px-3 sm:px-6 py-4 sm:py-8 pb-20 sm:pb-8">
        {/* 系列概览 */}
        <div className="mb-6 sm:mb-8 grid gap-4 sm:gap-6 md:grid-cols-[200px_1fr]">
          {/* 封面 */}
          <div className="relative mx-auto w-48 md:mx-0 md:w-full">
            <div className="relative aspect-[5/7] w-full overflow-hidden rounded-xl shadow-lg">
              {data.comics[0]?.coverUrl && (
                <Image
                  src={`/api/comics/${data.volumes[0]?.comicId}/thumbnail`}
                  alt={seriesName}
                  fill
                  unoptimized
                  className="object-cover"
                  sizes="200px"
                />
              )}
              {/* 卷数角标 */}
              <div className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-accent/90 px-2 py-1 text-xs font-bold text-white shadow-lg backdrop-blur-sm">
                <Layers className="h-3 w-3" />
                {data.volumes.length}
              </div>
            </div>
          </div>

          {/* 信息 + 操作按钮 */}
          <div className="space-y-4">
            {/* 作者 */}
            {data.comics[0]?.author && (
              <div className="text-sm text-muted">
                <span className="font-medium text-foreground">{t.series.author}:</span>{" "}
                {data.comics[0].author}
              </div>
            )}

            {/* 进度条 */}
            <div>
              <div className="mb-1 flex items-center justify-between text-xs text-muted">
                <span>{t.series.progress}</span>
                <span className="font-mono">{data.progress}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted/20">
                <div
                  className="h-full rounded-full bg-accent transition-all duration-500"
                  style={{ width: `${data.progress}%` }}
                />
              </div>
            </div>

            {/* 操作按钮 */}
            <div className="flex flex-wrap gap-2">
              {continueVolume && (
                <Link
                  href={`/reader/${continueVolume.comicId}`}
                  className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white shadow-sm shadow-accent/25 transition-colors hover:bg-accent/90"
                >
                  <Play className="h-4 w-4" />
                  {continueVolume.lastReadPage > 0
                    ? t.series.continueReading
                    : t.series.readFromStart}
                </Link>
              )}
            </div>
          </div>
        </div>

        {/* 卷列表 */}
        <div>
          <h2 className="mb-4 text-base font-semibold text-foreground">
            {t.series.volumes}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.comics.map((comic, idx) => {
              const vol = data.volumes[idx];
              const progress = vol && vol.pageCount > 0
                ? Math.round((vol.lastReadPage / vol.pageCount) * 100)
                : 0;

              return (
                <Link
                  key={comic.id}
                  href={`/reader/${comic.id}`}
                  className="group flex items-center gap-3 rounded-xl bg-card p-3 transition-all hover:bg-card-hover hover:shadow-md"
                >
                  {/* 卷封面 */}
                  <div className="relative h-20 w-14 shrink-0 overflow-hidden rounded-lg bg-muted/20">
                    <Image
                      src={comic.coverUrl || `/api/comics/${comic.id}/thumbnail`}
                      alt={comic.title}
                      fill
                      unoptimized
                      className="object-cover"
                      sizes="56px"
                    />
                    {/* 进度条 */}
                    {progress > 0 && (
                      <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/40">
                        <div
                          className="h-full bg-accent transition-all"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    )}
                  </div>

                  {/* 卷信息 */}
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-medium text-foreground/90 group-hover:text-foreground">
                      {comic.title}
                    </h3>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                      {vol?.seriesIndex != null && (
                        <span className="rounded bg-accent/15 px-1.5 py-0.5 text-accent font-medium">
                          Vol.{vol.seriesIndex}
                        </span>
                      )}
                      <span>{vol?.pageCount || comic.pageCount} {t.continueReading.pageUnit}</span>
                    </div>
                    {progress > 0 && (
                      <p className="mt-1 text-xs text-muted/70">
                        {progress}%
                      </p>
                    )}
                  </div>

                  <BookOpen className="h-4 w-4 shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100" />
                </Link>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
}
