"use client";

import { useRouter } from "next/navigation";
import { useReadingStats } from "@/hooks/useComics";
import {
  ArrowLeft,
  Clock,
  BookOpen,
  BarChart3,
  Calendar,
} from "lucide-react";
import { useTranslation, useLocale } from "@/lib/i18n";

export default function StatsPage() {
  const router = useRouter();
  const { stats, loading } = useReadingStats();
  const t = useTranslation();
  const { locale } = useLocale();

  function formatDuration(seconds: number) {
    if (seconds < 60) return t.duration.seconds.replace("{n}", String(seconds));
    if (seconds < 3600) return t.duration.minutes.replace("{m}", String(Math.floor(seconds / 60))).replace("{s}", String(seconds % 60));
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return t.duration.hours.replace("{h}", String(h)).replace("{m}", String(m));
  }

  function formatShortDuration(seconds: number) {
    if (seconds < 60) return t.duration.shortSeconds.replace("{n}", String(seconds));
    if (seconds < 3600) return t.duration.shortMinutes.replace("{n}", String(Math.floor(seconds / 60)));
    return t.duration.shortHours.replace("{n}", String((seconds / 3600).toFixed(1)));
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-accent" />
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted">{t.stats.cannotLoadStats}</p>
      </div>
    );
  }

  const maxDailyDuration = Math.max(...(stats.dailyStats || []).map((d) => d.duration), 1);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-50 border-b border-border/50 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-4 px-6">
          <button
            onClick={() => router.back()}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 text-muted transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="text-lg font-bold text-foreground">{t.stats.title}</h1>
        </div>
      </div>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {/* Summary Cards */}
        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl bg-card p-6">
            <div className="flex items-center gap-3 text-muted">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/15">
                <Clock className="h-5 w-5 text-accent" />
              </div>
              <span className="text-sm">{t.stats.totalReadTime}</span>
            </div>
            <p className="mt-3 text-3xl font-bold text-foreground">
              {formatDuration(stats.totalReadTime)}
            </p>
          </div>

          <div className="rounded-xl bg-card p-6">
            <div className="flex items-center gap-3 text-muted">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/15">
                <BarChart3 className="h-5 w-5 text-emerald-400" />
              </div>
              <span className="text-sm">{t.stats.readingSessions}</span>
            </div>
            <p className="mt-3 text-3xl font-bold text-foreground">
              {stats.totalSessions}
            </p>
          </div>

          <div className="rounded-xl bg-card p-6">
            <div className="flex items-center gap-3 text-muted">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/15">
                <BookOpen className="h-5 w-5 text-amber-400" />
              </div>
              <span className="text-sm">{t.stats.comicsRead}</span>
            </div>
            <p className="mt-3 text-3xl font-bold text-foreground">
              {stats.totalComicsRead}
            </p>
          </div>
        </div>

        {/* Daily Chart */}
        {(stats.dailyStats || []).length > 0 && (
          <div className="mb-8 rounded-xl bg-card p-6">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-medium text-foreground">
              <Calendar className="h-4 w-4 text-muted" />
              {t.stats.dailyChart}
            </h2>
            <div className="flex items-end gap-1" style={{ height: 120 }}>
              {(stats.dailyStats || []).map((day) => (
                <div key={day.date} className="group relative flex flex-1 flex-col items-center">
                  <div
                    className="w-full min-w-[4px] rounded-t bg-accent/60 transition-colors group-hover:bg-accent"
                    style={{
                      height: `${Math.max((day.duration / maxDailyDuration) * 100, 4)}%`,
                    }}
                  />
                  {/* Tooltip */}
                  <div className="pointer-events-none absolute -top-10 left-1/2 z-10 hidden -translate-x-1/2 rounded-lg bg-zinc-800 px-2 py-1 text-[10px] text-white shadow-lg group-hover:block whitespace-nowrap">
                    {day.date.slice(5)}: {formatShortDuration(day.duration)}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2 flex justify-between text-[10px] text-muted">
              <span>{stats.dailyStats[0]?.date.slice(5)}</span>
              <span>{stats.dailyStats[stats.dailyStats.length - 1]?.date.slice(5)}</span>
            </div>
          </div>
        )}

        {/* Recent Sessions */}
        <div className="rounded-xl bg-card p-6">
          <h2 className="mb-4 text-sm font-medium text-foreground">{t.stats.recentRecords}</h2>
          {stats.recentSessions.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">{t.stats.noRecords}</p>
          ) : (
            <div className="space-y-3">
              {stats.recentSessions.map((session) => (
                <div
                  key={session.id}
                  className="flex items-center justify-between rounded-lg bg-background/50 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {session.comicTitle}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {new Date(session.startedAt).toLocaleString(locale)}
                      {" · "}
                      {t.stats.page} {session.startPage + 1} {t.stats.pageArrow} {session.endPage + 1} {t.stats.pageSuffix}
                    </p>
                  </div>
                  <div className="ml-4 flex-shrink-0 text-right">
                    <span className="text-sm font-medium text-accent">
                      {formatDuration(session.duration)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
