"use client";

import { apiPath } from "@/lib/base-path";
import { useRouter } from "next/navigation";
import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
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
  Trophy,
  ArrowRight,
  ChevronDown,
  Sparkles,
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
  const t = useTranslation();
  const { locale } = useLocale();
  const [goals, setGoals] = useState<GoalProgress[]>([]);
  const [editingGoal, setEditingGoal] = useState<string | null>(null);
  const [goalMins, setGoalMins] = useState("");
  const [goalBooks, setGoalBooks] = useState("");
  const [trendRange, setTrendRange] = useState<"7" | "30">("7");

  const fetchGoals = () => {
    fetch(apiPath("/api/goals"))
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setGoals(data); })
      .catch(() => {});
  };

  useEffect(() => { fetchGoals(); }, []);

  useEffect(() => {
    fetch(apiPath("/api/stats/enhanced"))
      .then((r) => r.json())
      .then((data) => setStats(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function fmt(seconds: number) {
    if (!seconds || seconds <= 0) return "0m";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
  }

  function fmtLong(seconds: number) {
    if (!seconds || seconds <= 0) return "0 分钟";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0 && m > 0) return `${h} 小时 ${m} 分钟`;
    if (h > 0) return `${h} 小时`;
    return `${m} 分钟`;
  }

  const genrePercentages = useMemo(() => {
    if (!stats?.genreStats?.length) return [];
    const total = stats.genreStats.reduce((s, g) => s + g.totalTime, 0);
    return stats.genreStats.map((g) => ({
      ...g,
      pct: total > 0 ? Math.round((g.totalTime / total) * 100) : 0,
    }));
  }, [stats?.genreStats]);

  const trendDays = trendRange === "7" ? 7 : 30;
  const trendData = useMemo(() => {
    if (!stats?.dailyStats?.length) return [];
    const sliced = stats.dailyStats.slice(-trendDays);
    const max = Math.max(...sliced.map((d) => d.duration), 1);
    return sliced.map((d) => ({ ...d, pct: Math.round((d.duration / max) * 100) }));
  }, [stats?.dailyStats, trendDays]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-10 py-8 space-y-6">
          <div className="h-8 w-48 animate-pulse rounded-xl bg-card/60" />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-2xl bg-card/60" />
            ))}
          </div>
          <div className="grid lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 h-64 animate-pulse rounded-2xl bg-card/60" />
            <div className="h-64 animate-pulse rounded-2xl bg-card/60" />
          </div>
        </div>
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

  const heroCards = [
    { icon: <Clock className="h-5 w-5" />, label: "今日阅读", value: fmt(stats.todayReadTime || 0), color: "text-accent", bg: "bg-accent/10" },
    { icon: <Calendar className="h-5 w-5" />, label: "本周阅读", value: fmt(stats.weekReadTime || 0), color: "text-emerald-400", bg: "bg-emerald-500/10" },
    { icon: <Timer className="h-5 w-5" />, label: "总阅读时长", value: fmtLong(stats.totalReadTime || 0), color: "text-blue-400", bg: "bg-blue-500/10" },
    { icon: <Flame className="h-5 w-5" />, label: "连续阅读", value: `${stats.currentStreak || 0} 天`, color: "text-orange-400", bg: "bg-orange-500/10" },
    { icon: <Trophy className="h-5 w-5" />, label: "最长连续", value: `${stats.longestStreak || 0} 天`, color: "text-amber-400", bg: "bg-amber-500/10" },
    { icon: <Zap className="h-5 w-5" />, label: "阅读速度", value: `${Math.round(stats.avgPagesPerHour || 0)} 页/时`, color: "text-violet-400", bg: "bg-violet-500/10" },
  ];

  const genreColors = [
    "bg-accent", "bg-emerald-500", "bg-amber-500", "bg-rose-500",
    "bg-violet-500", "bg-cyan-500", "bg-orange-500", "bg-pink-500",
    "bg-lime-500", "bg-sky-500",
  ];

  return (
    <div className="min-h-screen bg-background pb-20 sm:pb-8">
      {/* Header */}
      <div className="sticky top-0 z-50 border-b border-border/50 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex h-14 sm:h-16 max-w-6xl items-center gap-4 px-4 sm:px-6 lg:px-10">
          <button
            onClick={() => router.back()}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 text-muted transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="text-base sm:text-lg font-semibold text-foreground flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-accent" />
            阅读仪表盘
          </h1>
        </div>
      </div>

      <main className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-10 py-6 space-y-6">

        {/* ═══════ HERO CARDS ═══════ */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {heroCards.map((c) => (
            <div key={c.label} className="group rounded-2xl border border-border/30 bg-card/60 backdrop-blur-sm p-4 transition-all hover:border-border/50 hover:bg-card/80">
              <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${c.bg} ${c.color} mb-3`}>
                {c.icon}
              </div>
              <div className="text-lg sm:text-xl font-bold text-foreground leading-tight">{c.value}</div>
              <div className="text-xs text-muted mt-1">{c.label}</div>
            </div>
          ))}
        </div>

        {/* ═══════ TREND + GOALS ROW ═══════ */}
        <div className="grid lg:grid-cols-3 gap-4">

          {/* Trend Chart */}
          <div className="lg:col-span-2 rounded-2xl border border-border/30 bg-card/60 backdrop-blur-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <TrendingUp className="h-4 w-4 text-accent" />
                阅读趋势
              </h2>
              <div className="flex rounded-lg border border-border/40 overflow-hidden">
                {(["7", "30"] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setTrendRange(r)}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                      trendRange === r ? "bg-accent text-white" : "text-muted hover:text-foreground"
                    }`}
                  >
                    {r}天
                  </button>
                ))}
              </div>
            </div>

            {trendData.length > 0 ? (
              <div className="flex items-end gap-1 sm:gap-1.5 h-40 sm:h-48">
                {trendData.map((d) => (
                  <div key={d.date} className="group relative flex-1 flex flex-col items-center justify-end h-full">
                    <div className="w-full flex items-end justify-center h-full">
                      <div
                        className="w-full max-w-[28px] sm:max-w-[32px] rounded-t-lg bg-gradient-to-t from-accent/70 to-accent transition-all group-hover:from-accent group-hover:to-accent/80"
                        style={{ height: `${Math.max(d.pct, 4)}%` }}
                      />
                    </div>
                    <span className="text-[9px] text-muted mt-1.5 leading-none">
                      {d.date.slice(5).replace("-", "/")}
                    </span>
                    <div className="pointer-events-none absolute -top-10 left-1/2 z-10 hidden -translate-x-1/2 rounded-lg bg-zinc-800/90 px-2 py-1 text-[10px] text-white shadow-lg group-hover:block whitespace-nowrap backdrop-blur">
                      {fmt(d.duration)} · {d.sessions}次
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-40 items-center justify-center text-sm text-muted">暂无趋势数据</div>
            )}
          </div>

          {/* Goals / Streak / Speed */}
          <div className="space-y-4">
            {/* Goals */}
            <div className="rounded-2xl border border-border/30 bg-card/60 backdrop-blur-sm p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-3">
                <Target className="h-4 w-4 text-accent" />
                阅读目标
              </h2>
              {goals.length > 0 ? (
                <div className="space-y-3">
                  {goals.map((g) => (
                    <div key={g.goal.id} className={`rounded-xl p-3 border ${g.achieved ? "border-emerald-500/30 bg-emerald-500/5" : "border-border/30 bg-background/50"}`}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-foreground">
                          {g.goal.goalType === "daily" ? "每日目标" : "每周目标"}
                        </span>
                        {g.achieved && <span className="text-[10px] text-emerald-400">🎉 达成!</span>}
                      </div>
                      {g.goal.targetMins > 0 && (
                        <div>
                          <div className="flex justify-between text-[11px] text-muted mb-1">
                            <span>{fmt(g.currentMins * 60)}</span>
                            <span>{fmt(g.goal.targetMins * 60)}</span>
                          </div>
                          <div className="h-2 w-full rounded-full bg-background overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-700 ${g.achieved ? "bg-emerald-500" : "bg-accent"}`}
                              style={{ width: `${Math.min(g.progressPct, 100)}%` }}
                            />
                          </div>
                        </div>
                      )}
                      {g.goal.targetBooks > 0 && (
                        <div className="mt-2">
                          <div className="flex justify-between text-[11px] text-muted mb-1">
                            <span>{g.currentBooks} 本</span>
                            <span>{g.goal.targetBooks} 本</span>
                          </div>
                          <div className="h-2 w-full rounded-full bg-background overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-700 ${g.bookProgressPct >= 100 ? "bg-emerald-500" : "bg-amber-500"}`}
                              style={{ width: `${Math.min(g.bookProgressPct, 100)}%` }}
                            />
                          </div>
                        </div>
                      )}
                      <div className="flex gap-2 mt-2">
                        <button onClick={() => { setEditingGoal(g.goal.goalType); setGoalMins(String(g.goal.targetMins)); setGoalBooks(String(g.goal.targetBooks)); }} className="text-[10px] text-muted hover:text-accent transition-colors">
                          <Edit3 className="h-3 w-3 inline" /> 编辑
                        </button>
                        <button onClick={() => { fetch(apiPath("/api/goals/" + g.goal.goalType), { method: "DELETE" }).then(fetchGoals); }} className="text-[10px] text-muted hover:text-rose-400 transition-colors">
                          <Trash2 className="h-3 w-3 inline" /> 删除
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {["daily", "weekly"].map((type) => (
                    <button
                      key={type}
                      onClick={() => { setEditingGoal(type); setGoalMins(type === "daily" ? "30" : "120"); setGoalBooks(""); }}
                      className="w-full rounded-xl border border-dashed border-border/40 py-3 text-xs text-muted hover:text-foreground hover:border-accent/40 transition-all"
                    >
                      + {type === "daily" ? "设定每日目标" : "设定每周目标"}
                    </button>
                  ))}
                </div>
              )}

              {/* Edit Modal Inline */}
              {editingGoal && (
                <div className="mt-3 rounded-xl border border-border/40 bg-background/80 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <input type="number" value={goalMins} onChange={(e) => setGoalMins(e.target.value)} className="w-20 rounded-md border border-border/60 bg-card px-2 py-1 text-sm text-foreground outline-none focus:border-accent/50" placeholder="分钟" />
                    <span className="text-xs text-muted">分钟</span>
                    <input type="number" value={goalBooks} onChange={(e) => setGoalBooks(e.target.value)} className="w-16 rounded-md border border-border/60 bg-card px-2 py-1 text-sm text-foreground outline-none focus:border-accent/50" placeholder="本" />
                    <span className="text-xs text-muted">本</span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => { fetch(apiPath("/api/goals"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ goalType: editingGoal, targetMins: parseInt(goalMins) || 0, targetBooks: parseInt(goalBooks) || 0 }) }).then(() => { fetchGoals(); setEditingGoal(null); }); }} className="flex items-center gap-1 rounded-lg bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20 transition-colors">
                      <Check className="h-3 w-3" /> 保存
                    </button>
                    <button onClick={() => setEditingGoal(null)} className="rounded-lg px-3 py-1.5 text-xs text-muted hover:text-foreground transition-colors">取消</button>
                  </div>
                </div>
              )}
            </div>

            {/* Reading Speed */}
            <div className="rounded-2xl border border-border/30 bg-card/60 backdrop-blur-sm p-5">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="h-4 w-4 text-violet-400" />
                <span className="text-sm font-semibold text-foreground">阅读速度</span>
              </div>
              <div className="text-3xl font-bold text-foreground">{Math.round(stats.avgPagesPerHour || 0)}</div>
              <div className="text-xs text-muted">页 / 小时</div>
            </div>
          </div>
        </div>

        {/* ═══════ MONTHLY TREND ═══════ */}
        {(stats.monthlyStats || []).length > 0 && (
          <div className="rounded-2xl border border-border/30 bg-card/60 backdrop-blur-sm p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-4">
              <Calendar className="h-4 w-4 text-emerald-400" />
              月度趋势
            </h2>
            <div className="flex items-end gap-1 sm:gap-2 h-36 sm:h-44">
              {stats.monthlyStats.map((m) => {
                const max = Math.max(...(stats.monthlyStats || []).map((x) => x.duration), 1);
                return (
                  <div key={m.month} className="group relative flex-1 flex flex-col items-center justify-end h-full">
                    <div className="w-full flex items-end justify-center h-full">
                      <div
                        className="w-full max-w-[36px] rounded-t-lg bg-gradient-to-t from-emerald-500/60 to-emerald-500/30 transition-all group-hover:from-emerald-500 group-hover:to-emerald-500/60"
                        style={{ height: `${Math.max((m.duration / max) * 100, 4)}%` }}
                      />
                    </div>
                    <span className="text-[9px] text-muted mt-1.5 leading-none">{m.month.slice(5)}月</span>
                    <div className="pointer-events-none absolute -top-12 left-1/2 z-10 hidden -translate-x-1/2 rounded-lg bg-zinc-800/90 px-2 py-1 text-[10px] text-white shadow-lg group-hover:block whitespace-nowrap backdrop-blur">
                      {m.month}: {fmt(m.duration)} · {m.sessions}次 · {m.comics}本
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ═══════ GENRE + SESSIONS ROW ═══════ */}
        <div className="grid lg:grid-cols-2 gap-4">

          {/* Genre Preferences */}
          {genrePercentages.length > 0 && (
            <div className="rounded-2xl border border-border/30 bg-card/60 backdrop-blur-sm p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-4">
                <PieChart className="h-4 w-4 text-rose-400" />
                类型偏好
              </h2>
              <div className="flex h-4 w-full overflow-hidden rounded-full bg-background mb-4">
                {genrePercentages.map((g, i) => (
                  <div
                    key={g.genre}
                    className={`${genreColors[i % genreColors.length]} transition-all`}
                    style={{ width: `${g.pct}%` }}
                    title={`${g.genre}: ${g.pct}%`}
                  />
                ))}
              </div>
              <div className="space-y-2.5">
                {genrePercentages.map((g, i) => (
                  <div key={g.genre} className="flex items-center gap-3">
                    <div className={`h-2.5 w-2.5 shrink-0 rounded-full ${genreColors[i % genreColors.length]}`} />
                    <span className="text-sm text-foreground flex-1 truncate">{g.genre}</span>
                    <span className="text-xs text-muted">{g.comicCount}本</span>
                    <div className="w-20 h-1.5 rounded-full bg-background overflow-hidden">
                      <div className={`h-full rounded-full ${genreColors[i % genreColors.length]}`} style={{ width: `${g.pct}%` }} />
                    </div>
                    <span className="text-xs font-medium text-accent w-10 text-right">{g.pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent Sessions */}
          <div className="rounded-2xl border border-border/30 bg-card/60 backdrop-blur-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Clock className="h-4 w-4 text-blue-400" />
                最近阅读
              </h2>
              <Link href="/history" className="flex items-center gap-1 text-xs text-accent hover:text-accent/80 transition-colors">
                查看全部 <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            {(stats.recentSessions || []).length > 0 ? (
              <div className="space-y-2.5">
                {stats.recentSessions.slice(0, 8).map((s, i) => (
                  <Link
                    key={s.id}
                    href={`/comic/${s.comicId}`}
                    className="group flex items-center gap-3 rounded-xl p-2.5 -mx-1 transition-all hover:bg-background/60"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-accent text-xs font-bold shrink-0">
                      {i + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate group-hover:text-accent transition-colors">{s.comicTitle}</p>
                      <p className="text-[11px] text-muted">
                        {new Date(s.startedAt).toLocaleString(locale, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        {" · "}p{s.startPage + 1}→{s.endPage + 1}
                      </p>
                    </div>
                    <span className="text-xs font-medium text-accent shrink-0">{fmt(s.duration)}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="flex h-32 items-center justify-center text-sm text-muted">暂无阅读记录</div>
            )}
          </div>
        </div>

        {/* ═══════ STATS OVERVIEW (Totals) ═══════ */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-2xl border border-border/30 bg-card/60 backdrop-blur-sm p-4 text-center">
            <div className="text-2xl font-bold text-foreground">{stats.totalSessions || 0}</div>
            <div className="text-xs text-muted mt-1">总阅读次数</div>
          </div>
          <div className="rounded-2xl border border-border/30 bg-card/60 backdrop-blur-sm p-4 text-center">
            <div className="text-2xl font-bold text-foreground">{stats.totalComicsRead || 0}</div>
            <div className="text-xs text-muted mt-1">作品数</div>
          </div>
          <div className="rounded-2xl border border-border/30 bg-card/60 backdrop-blur-sm p-4 text-center">
            <div className="text-2xl font-bold text-foreground">{stats.currentStreak || 0}</div>
            <div className="text-xs text-muted mt-1">当前连续天数</div>
          </div>
          <div className="rounded-2xl border border-border/30 bg-card/60 backdrop-blur-sm p-4 text-center">
            <div className="text-2xl font-bold text-foreground">{stats.longestStreak || 0}</div>
            <div className="text-xs text-muted mt-1">最长连续天数</div>
          </div>
        </div>

      </main>
    </div>
  );
}
