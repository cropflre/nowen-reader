"use client";

import { useRouter } from "next/navigation";
import { useState, useEffect, useMemo } from "react";
import {
  ArrowLeft,
  Clock,
  BookOpen,
  BarChart3,
  Calendar,
  TrendingUp,
  Flame,
  Zap,
  PieChart,
  Timer,
  Target,
  Edit3,
  Trash2,
  Check,
} from "lucide-react";
import { useTranslation, useLocale } from "@/lib/i18n";

interface EnhancedStats {
  totalReadTime: number;
  totalSessions: number;
  totalComicsRead: number;
  todayReadTime: number;
  weekReadTime: number;
  currentStreak: number;
  longestStreak: number;
  avgPagesPerHour: number;
  recentSessions: {
    id: number;
    comicId: string;
    comicTitle: string;
    startedAt: string;
    endedAt: string | null;
    duration: number;
    startPage: number;
    endPage: number;
  }[];
  dailyStats: { date: string; duration: number; sessions: number }[];
  monthlyStats: { month: string; duration: number; sessions: number; comics: number }[];
  genreStats: { genre: string; totalTime: number; comicCount: number }[];
}

interface GoalProgress {
  goal: {
    id: number;
    goalType: string;
    targetMins: number;
    targetBooks: number;
  };
  currentMins: number;
  currentBooks: number;
  progressPct: number;
  bookProgressPct: number;
  periodStart: string;
  periodEnd: string;
  achieved: boolean;
}

export default function StatsPage() {
  const router = useRouter();
  const [stats, setStats] = useState<EnhancedStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "daily" | "monthly" | "genre">("overview");
  const t = useTranslation();
  const { locale } = useLocale();

  // 阅读目标
  const [goals, setGoals] = useState<GoalProgress[]>([]);
  const [editingGoal, setEditingGoal] = useState<string | null>(null);
  const [goalMins, setGoalMins] = useState("");
  const [goalBooks, setGoalBooks] = useState("");

  const fetchGoals = () => {
    fetch("/api/goals")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setGoals(data);
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetchGoals();
  }, []);

  useEffect(() => {
    fetch("/api/stats/enhanced")
      .then((r) => r.json())
      .then((data) => setStats(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

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

  // 计算类型偏好百分比
  const genrePercentages = useMemo(() => {
    if (!stats?.genreStats?.length) return [];
    const total = stats.genreStats.reduce((sum, g) => sum + g.totalTime, 0);
    return stats.genreStats.map((g) => ({
      ...g,
      percentage: total > 0 ? Math.round((g.totalTime / total) * 100) : 0,
    }));
  }, [stats?.genreStats]);

  // 类型颜色映射
  const genreColors = [
    "bg-accent", "bg-emerald-500", "bg-amber-500", "bg-rose-500",
    "bg-violet-500", "bg-cyan-500", "bg-orange-500", "bg-pink-500",
    "bg-lime-500", "bg-sky-500",
  ];

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
  const maxMonthlyDuration = Math.max(...(stats.monthlyStats || []).map((m) => m.duration), 1);

  return (
    <div className="min-h-screen bg-background pb-20 sm:pb-8">
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

      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-6 sm:py-8">
        {/* ==================== 阅读目标 ==================== */}
        <div className="mb-6 sm:mb-8">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
            <Target className="h-4 w-4 text-accent" />
            {t.readingGoal?.title || "阅读目标"}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {["daily", "weekly"].map((type) => {
              const g = goals.find((p) => p.goal.goalType === type);
              const isEditing = editingGoal === type;
              const label = type === "daily"
                ? (t.readingGoal?.daily || "每日目标")
                : (t.readingGoal?.weekly || "每周目标");

              return (
                <div key={type} className="rounded-xl bg-card p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium text-foreground">{label}</span>
                    <div className="flex items-center gap-1.5">
                      {g && !isEditing && (
                        <button
                          onClick={() => {
                            fetch(`/api/goals?goalType=${type}`, { method: "DELETE" }).then(() => fetchGoals());
                          }}
                          className="flex h-6 w-6 items-center justify-center rounded-md text-muted hover:text-rose-400 transition-colors"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                      <button
                        onClick={() => {
                          if (isEditing) {
                            // 保存
                            const mins = parseInt(goalMins) || 0;
                            const books = parseInt(goalBooks) || 0;
                            if (mins > 0 || books > 0) {
                              fetch("/api/goals", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ goalType: type, targetMins: mins, targetBooks: books }),
                              }).then(() => {
                                fetchGoals();
                                setEditingGoal(null);
                              });
                            } else {
                              setEditingGoal(null);
                            }
                          } else {
                            setEditingGoal(type);
                            setGoalMins(String(g?.goal.targetMins || 30));
                            setGoalBooks(String(g?.goal.targetBooks || 0));
                          }
                        }}
                        className="flex h-6 w-6 items-center justify-center rounded-md text-muted hover:text-accent transition-colors"
                      >
                        {isEditing ? <Check className="h-3 w-3" /> : <Edit3 className="h-3 w-3" />}
                      </button>
                    </div>
                  </div>

                  {isEditing ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Clock className="h-3.5 w-3.5 text-muted" />
                        <input
                          type="number"
                          value={goalMins}
                          onChange={(e) => setGoalMins(e.target.value)}
                          className="w-20 rounded-md border border-border/60 bg-background px-2 py-1 text-sm text-foreground outline-none focus:border-accent/50"
                          min={0}
                        />
                        <span className="text-xs text-muted">{t.readingGoal?.minutes || "分钟"}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <BookOpen className="h-3.5 w-3.5 text-muted" />
                        <input
                          type="number"
                          value={goalBooks}
                          onChange={(e) => setGoalBooks(e.target.value)}
                          className="w-20 rounded-md border border-border/60 bg-background px-2 py-1 text-sm text-foreground outline-none focus:border-accent/50"
                          min={0}
                        />
                        <span className="text-xs text-muted">{t.readingGoal?.books || "本"}</span>
                      </div>
                    </div>
                  ) : g ? (
                    <div>
                      {/* 时间进度 */}
                      {g.goal.targetMins > 0 && (
                        <div className="mb-2">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs text-muted">
                              {formatShortDuration(g.currentMins * 60)} / {formatShortDuration(g.goal.targetMins * 60)}
                            </span>
                            <span className={`text-xs font-medium ${g.achieved ? "text-emerald-400" : "text-accent"}`}>
                              {g.progressPct}%
                            </span>
                          </div>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-background">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${g.achieved ? "bg-emerald-500" : "bg-accent"}`}
                              style={{ width: `${g.progressPct}%` }}
                            />
                          </div>
                        </div>
                      )}
                      {/* 本数进度 */}
                      {g.goal.targetBooks > 0 && (
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs text-muted">
                              {g.currentBooks} / {g.goal.targetBooks} {t.readingGoal?.books || "本"}
                            </span>
                            <span className={`text-xs font-medium ${g.bookProgressPct >= 100 ? "text-emerald-400" : "text-accent"}`}>
                              {g.bookProgressPct}%
                            </span>
                          </div>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-background">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${g.bookProgressPct >= 100 ? "bg-emerald-500" : "bg-amber-500"}`}
                              style={{ width: `${g.bookProgressPct}%` }}
                            />
                          </div>
                        </div>
                      )}
                      {g.achieved && (
                        <p className="mt-2 text-center text-xs font-medium text-emerald-400">
                          🎉 {t.readingGoal?.achieved || "目标已达成！"}
                        </p>
                      )}
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        setEditingGoal(type);
                        setGoalMins(type === "daily" ? "30" : "120");
                        setGoalBooks("0");
                      }}
                      className="w-full rounded-lg border border-dashed border-border/60 py-3 text-xs text-muted hover:text-foreground hover:border-border transition-all"
                    >
                      + {t.readingGoal?.setGoal || "设定目标"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ==================== 概览卡片 ==================== */}
        <div className="mb-6 sm:mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          {/* 总阅读时长 */}
          <div className="rounded-xl bg-card p-4 sm:p-6">
            <div className="flex items-center gap-2 text-muted">
              <div className="flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-lg bg-accent/15">
                <Clock className="h-4 w-4 sm:h-5 sm:w-5 text-accent" />
              </div>
              <span className="text-xs sm:text-sm">{t.stats.totalReadTime}</span>
            </div>
            <p className="mt-2 sm:mt-3 text-xl sm:text-3xl font-bold text-foreground">
              {formatDuration(stats.totalReadTime)}
            </p>
          </div>

          {/* 阅读次数 */}
          <div className="rounded-xl bg-card p-4 sm:p-6">
            <div className="flex items-center gap-2 text-muted">
              <div className="flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-lg bg-emerald-500/15">
                <BarChart3 className="h-4 w-4 sm:h-5 sm:w-5 text-emerald-400" />
              </div>
              <span className="text-xs sm:text-sm">{t.stats.readingSessions}</span>
            </div>
            <p className="mt-2 sm:mt-3 text-xl sm:text-3xl font-bold text-foreground">
              {stats.totalSessions}
            </p>
          </div>

          {/* 已读漫画 */}
          <div className="rounded-xl bg-card p-4 sm:p-6">
            <div className="flex items-center gap-2 text-muted">
              <div className="flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-lg bg-amber-500/15">
                <BookOpen className="h-4 w-4 sm:h-5 sm:w-5 text-amber-400" />
              </div>
              <span className="text-xs sm:text-sm">{t.stats.comicsRead}</span>
            </div>
            <p className="mt-2 sm:mt-3 text-xl sm:text-3xl font-bold text-foreground">
              {stats.totalComicsRead}
            </p>
          </div>

          {/* 连续阅读 */}
          <div className="rounded-xl bg-card p-4 sm:p-6">
            <div className="flex items-center gap-2 text-muted">
              <div className="flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-lg bg-rose-500/15">
                <Flame className="h-4 w-4 sm:h-5 sm:w-5 text-rose-400" />
              </div>
              <span className="text-xs sm:text-sm">{t.statsEnhanced?.streak || "连续阅读"}</span>
            </div>
            <p className="mt-2 sm:mt-3 text-xl sm:text-3xl font-bold text-foreground">
              {stats.currentStreak}{t.statsEnhanced?.days || "天"}
            </p>
            <p className="text-[10px] sm:text-xs text-muted mt-1">
              {t.statsEnhanced?.longest || "最长"}: {stats.longestStreak}{t.statsEnhanced?.days || "天"}
            </p>
          </div>
        </div>

        {/* ==================== 副卡片 ==================== */}
        <div className="mb-6 sm:mb-8 grid grid-cols-3 gap-3 sm:gap-4">
          {/* 今日 */}
          <div className="rounded-xl bg-card p-4">
            <div className="flex items-center gap-2 text-muted mb-2">
              <Timer className="h-4 w-4 text-violet-400" />
              <span className="text-xs">{t.statsEnhanced?.today || "今日"}</span>
            </div>
            <p className="text-lg sm:text-xl font-bold text-foreground">
              {formatShortDuration(stats.todayReadTime)}
            </p>
          </div>

          {/* 本周 */}
          <div className="rounded-xl bg-card p-4">
            <div className="flex items-center gap-2 text-muted mb-2">
              <Calendar className="h-4 w-4 text-cyan-400" />
              <span className="text-xs">{t.statsEnhanced?.thisWeek || "本周"}</span>
            </div>
            <p className="text-lg sm:text-xl font-bold text-foreground">
              {formatShortDuration(stats.weekReadTime)}
            </p>
          </div>

          {/* 阅读速度 */}
          <div className="rounded-xl bg-card p-4">
            <div className="flex items-center gap-2 text-muted mb-2">
              <Zap className="h-4 w-4 text-amber-400" />
              <span className="text-xs">{t.statsEnhanced?.speed || "速度"}</span>
            </div>
            <p className="text-lg sm:text-xl font-bold text-foreground">
              {Math.round(stats.avgPagesPerHour)}<span className="text-xs font-normal text-muted ml-1">{t.statsEnhanced?.pagesPerHour || "页/时"}</span>
            </p>
          </div>
        </div>

        {/* ==================== Tab 切换 ==================== */}
        <div className="mb-4 flex items-center gap-1 overflow-x-auto rounded-lg bg-card p-1">
          {[
            { key: "overview" as const, label: t.statsEnhanced?.tabOverview || "概览", icon: TrendingUp },
            { key: "daily" as const, label: t.statsEnhanced?.tabDaily || "每日", icon: Calendar },
            { key: "monthly" as const, label: t.statsEnhanced?.tabMonthly || "月度", icon: BarChart3 },
            { key: "genre" as const, label: t.statsEnhanced?.tabGenre || "类型", icon: PieChart },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs sm:text-sm font-medium transition-all ${
                activeTab === tab.key
                  ? "bg-accent text-white shadow-sm"
                  : "text-muted hover:text-foreground"
              }`}
            >
              <tab.icon className="h-3.5 w-3.5" />
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* ==================== 图表区域 ==================== */}

        {/* 每日阅读图表 (90天) */}
        {(activeTab === "overview" || activeTab === "daily") && (stats.dailyStats || []).length > 0 && (
          <div className="mb-6 rounded-xl bg-card p-4 sm:p-6">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-medium text-foreground">
              <Calendar className="h-4 w-4 text-muted" />
              {t.statsEnhanced?.dailyChart || "近 90 天阅读时长"}
            </h2>
            <div className="flex items-end gap-[2px] sm:gap-1" style={{ height: 140 }}>
              {(stats.dailyStats || []).map((day) => (
                <div key={day.date} className="group relative flex flex-1 flex-col items-center">
                  <div
                    className="w-full min-w-[2px] sm:min-w-[4px] rounded-t bg-accent/60 transition-colors group-hover:bg-accent"
                    style={{
                      height: `${Math.max((day.duration / maxDailyDuration) * 100, 3)}%`,
                    }}
                  />
                  <div className="pointer-events-none absolute -top-10 left-1/2 z-10 hidden -translate-x-1/2 rounded-lg bg-zinc-800 px-2 py-1 text-[10px] text-white shadow-lg group-hover:block whitespace-nowrap">
                    {day.date.slice(5)}: {formatShortDuration(day.duration)} · {day.sessions}{t.statsEnhanced?.sessionsUnit || "次"}
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

        {/* 月度趋势图 */}
        {(activeTab === "overview" || activeTab === "monthly") && (stats.monthlyStats || []).length > 0 && (
          <div className="mb-6 rounded-xl bg-card p-4 sm:p-6">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-medium text-foreground">
              <TrendingUp className="h-4 w-4 text-muted" />
              {t.statsEnhanced?.monthlyTrend || "月度趋势"}
            </h2>
            <div className="flex items-end gap-2 sm:gap-3" style={{ height: 160 }}>
              {(stats.monthlyStats || []).map((m) => (
                <div key={m.month} className="group relative flex flex-1 flex-col items-center gap-1">
                  <div
                    className="w-full rounded-t bg-emerald-500/60 transition-colors group-hover:bg-emerald-500"
                    style={{
                      height: `${Math.max((m.duration / maxMonthlyDuration) * 100, 5)}%`,
                    }}
                  />
                  <span className="text-[9px] sm:text-[10px] text-muted truncate w-full text-center">
                    {m.month.slice(5)}月
                  </span>
                  <div className="pointer-events-none absolute -top-12 left-1/2 z-10 hidden -translate-x-1/2 rounded-lg bg-zinc-800 px-2 py-1 text-[10px] text-white shadow-lg group-hover:block whitespace-nowrap">
                    {m.month}: {formatShortDuration(m.duration)} · {m.sessions}{t.statsEnhanced?.sessionsUnit || "次"} · {m.comics}{t.statsEnhanced?.comicsUnit || "本"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 类型偏好饼图（简化为水平条形图） */}
        {(activeTab === "overview" || activeTab === "genre") && genrePercentages.length > 0 && (
          <div className="mb-6 rounded-xl bg-card p-4 sm:p-6">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-medium text-foreground">
              <PieChart className="h-4 w-4 text-muted" />
              {t.statsEnhanced?.genrePreference || "类型偏好"}
            </h2>

            {/* 环形可视化 */}
            <div className="mb-4 flex h-4 w-full overflow-hidden rounded-full bg-background">
              {genrePercentages.map((g, i) => (
                <div
                  key={g.genre}
                  className={`${genreColors[i % genreColors.length]} transition-all`}
                  style={{ width: `${g.percentage}%` }}
                  title={`${g.genre}: ${g.percentage}%`}
                />
              ))}
            </div>

            {/* 图例 */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {genrePercentages.map((g, i) => (
                <div key={g.genre} className="flex items-center gap-2">
                  <div className={`h-3 w-3 shrink-0 rounded-sm ${genreColors[i % genreColors.length]}`} />
                  <span className="text-xs text-foreground truncate">{g.genre}</span>
                  <span className="ml-auto text-xs text-muted">{g.percentage}%</span>
                </div>
              ))}
            </div>

            {/* 详细列表 */}
            <div className="mt-4 space-y-2">
              {genrePercentages.map((g, i) => (
                <div key={g.genre} className="flex items-center gap-3">
                  <div className={`h-2 w-2 shrink-0 rounded-full ${genreColors[i % genreColors.length]}`} />
                  <span className="text-sm text-foreground flex-1 truncate">{g.genre}</span>
                  <span className="text-xs text-muted">{g.comicCount}{t.statsEnhanced?.comicsUnit || "本"}</span>
                  <span className="text-xs font-medium text-accent w-14 text-right">{formatShortDuration(g.totalTime)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ==================== 最近记录 ==================== */}
        {activeTab === "overview" && (
          <div className="rounded-xl bg-card p-4 sm:p-6">
            <h2 className="mb-4 text-sm font-medium text-foreground">{t.stats.recentRecords}</h2>
            {stats.recentSessions.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted">{t.stats.noRecords}</p>
            ) : (
              <div className="space-y-2 sm:space-y-3">
                {stats.recentSessions.slice(0, 20).map((session) => (
                  <div
                    key={session.id}
                    className="flex items-center justify-between rounded-lg bg-background/50 px-3 sm:px-4 py-2.5 sm:py-3"
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
                    <div className="ml-3 sm:ml-4 flex-shrink-0 text-right">
                      <span className="text-sm font-medium text-accent">
                        {formatDuration(session.duration)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
