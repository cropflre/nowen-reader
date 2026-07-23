
"use client";

import { useState, useEffect, useMemo } from "react";
import {
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
  Download,
  Award,
  ChevronDown,
  Trophy,
  FileText,
  Sparkles,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useTranslation, useLocale } from "@/lib/i18n";
import { useAIStatus } from "@/hooks/useAIStatus";
import { apiPath } from "@/lib/base-path";

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

// 年度报告类型
interface YearlyReport {
  year: number;
  totalReadTime: number;
  totalSessions: number;
  totalComicsRead: number;
  totalPagesRead: number;
  monthlyStats: { month: number; duration: number; sessions: number; comics: number }[];
  topComics: { id: string; title: string; readTime: number; sessions: number }[];
  genreDistribution: { genre: string; count: number; readTime: number }[];
}

// 简单的 Markdown 渲染（支持 ##、**、*、- 列表、换行）
function renderMarkdown(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
    .replace(/\n{2,}/g, "</p><p>")
    .replace(/\n/g, "<br/>")
    .replace(/^/, "<p>")
    .replace(/$/, "</p>");
}

export default function StatsPanel() {
  const [stats, setStats] = useState<EnhancedStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "daily" | "monthly" | "genre" | "yearly">("overview");
  const t = useTranslation();
  const { locale } = useLocale();

  const [goals, setGoals] = useState<GoalProgress[]>([]);
  const [editingGoal, setEditingGoal] = useState<string | null>(null);
  const [goalMins, setGoalMins] = useState("");
  const [goalBooks, setGoalBooks] = useState("");

  // 年度报告
  const [yearlyReport, setYearlyReport] = useState<YearlyReport | null>(null);
  const [yearlyYear, setYearlyYear] = useState(new Date().getFullYear());
  const [yearlyLoading, setYearlyLoading] = useState(false);

  // 最近记录分页
  const [visibleSessions, setVisibleSessions] = useState(10);

  // 数据导出
  const [showExportMenu, setShowExportMenu] = useState(false);

  // AI 洞察
  const { aiConfigured } = useAIStatus();
  const [aiInsight, setAiInsight] = useState("");
  const [aiInsightLoading, setAiInsightLoading] = useState(false);
  const [aiInsightError, setAiInsightError] = useState("");

  // AI 阅读目标推荐
  const [aiGoalLoading, setAiGoalLoading] = useState(false);
  const [aiGoalRec, setAiGoalRec] = useState<{
    dailyMins: number;
    dailyBooks: number;
    weeklyMins: number;
    weeklyBooks: number;
    reasoning: string;
    encouragement: string;
  } | null>(null);

  const generateInsight = async () => {
    setAiInsightLoading(true);
    setAiInsight("");
    setAiInsightError("");
    try {
      const res = await fetch(apiPath("/api/ai/reading-insight"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetLang: locale === "en" ? "en" : "zh" }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Unknown error");
      }
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("No reader");
      let fullText = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.error) throw new Error(data.error);
            if (data.content) {
              fullText += data.content;
              setAiInsight(fullText);
            }
          } catch (e) {
            // ignore parse errors for partial chunks
          }
        }
      }
    } catch (err: unknown) {
      setAiInsightError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setAiInsightLoading(false);
    }
  };

  const fetchGoals = () => {
    fetch(apiPath("/api/goals"))
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
    fetch(apiPath("/api/stats/enhanced"))
      .then((r) => r.json())
      .then((data) => setStats(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // 加载年度报告（当切换到 yearly tab 时）
  useEffect(() => {
    if (activeTab !== "yearly") return;
    setYearlyLoading(true);
    fetch(apiPath(`/api/stats/yearly?year=${yearlyYear}`))
      .then((r) => r.json())
      .then((data) => setYearlyReport(data))
      .catch(() => setYearlyReport(null))
      .finally(() => setYearlyLoading(false));
  }, [activeTab, yearlyYear]);

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

  const genrePercentages = useMemo(() => {
    if (!stats?.genreStats?.length) return [];
    const total = stats.genreStats.reduce((sum, g) => sum + g.totalTime, 0);
    return stats.genreStats.map((g) => ({
      ...g,
      percentage: total > 0 ? Math.round((g.totalTime / total) * 100) : 0,
    }));
  }, [stats?.genreStats]);

  const genreColors = [
    "bg-accent", "bg-emerald-500", "bg-amber-500", "bg-rose-500",
    "bg-violet-500", "bg-cyan-500", "bg-orange-500", "bg-pink-500",
    "bg-lime-500", "bg-sky-500",
  ];

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-accent" />
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <p className="text-muted">{t.stats.cannotLoadStats}</p>
      </div>
    );
  }

  const maxDailyDuration = Math.max(...(stats.dailyStats || []).map((d) => d.duration), 1);
  const maxMonthlyDuration = Math.max(...(stats.monthlyStats || []).map((m) => m.duration), 1);

  return (
    <div className="space-y-6">
      {/* 阅读目标 */}
      <div>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
          <Target className="h-4 w-4 text-accent" />
          {t.readingGoal?.title || "阅读目标"}
          {aiConfigured && (
            <button
              onClick={async () => {
                if (aiGoalLoading) return;
                setAiGoalLoading(true);
                setAiGoalRec(null);
                try {
                  const res = await fetch(apiPath("/api/ai/recommend-goal"), {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ targetLang: locale === "en" ? "en" : "zh" }),
                  });
                  if (res.ok) {
                    const data = await res.json();
                    setAiGoalRec(data.recommendation || null);
                  }
                } catch {
                  // ignore
                } finally {
                  setAiGoalLoading(false);
                }
              }}
              disabled={aiGoalLoading}
              className="ml-auto flex items-center gap-1 rounded-md bg-purple-500/10 px-2 py-0.5 text-[10px] font-medium text-purple-400 transition-colors hover:bg-purple-500/20 disabled:opacity-50"
              title={locale === "en" ? "AI Recommend Goals" : "AI 推荐目标"}
            >
              {aiGoalLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              {aiGoalLoading
                ? (locale === "en" ? "Analyzing..." : "分析中...")
                : (locale === "en" ? "AI Recommend" : "AI 推荐")}
            </button>
          )}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* AI 目标推荐卡片 */}
          {aiGoalRec && (
            <div className="col-span-full rounded-xl bg-purple-500/5 border border-purple-500/20 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="flex items-center gap-1.5 text-xs font-medium text-purple-400">
                  <Sparkles className="h-3.5 w-3.5" />
                  {locale === "en" ? "AI Recommendation" : "AI 推荐"}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      // 应用日常目标
                      if (aiGoalRec.dailyMins > 0) {
                        fetch(apiPath("/api/goals"), {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ goalType: "daily", targetMins: aiGoalRec.dailyMins, targetBooks: aiGoalRec.dailyBooks || 0 }),
                        }).then(() => {
                          // 应用周目标
                          if (aiGoalRec.weeklyMins > 0) {
                            return fetch(apiPath("/api/goals"), {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ goalType: "weekly", targetMins: aiGoalRec.weeklyMins, targetBooks: aiGoalRec.weeklyBooks || 0 }),
                            });
                          }
                        }).then(() => {
                          fetchGoals();
                          setAiGoalRec(null);
                        });
                      }
                    }}
                    className="rounded-md bg-purple-500/20 px-2.5 py-1 text-[10px] font-medium text-purple-400 hover:bg-purple-500/30 transition-colors"
                  >
                    {locale === "en" ? "Apply" : "应用"}
                  </button>
                  <button
                    onClick={() => setAiGoalRec(null)}
                    className="text-xs text-muted hover:text-foreground"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-2">
                <div className="rounded-lg bg-background/50 p-2">
                  <span className="text-[10px] text-muted">{locale === "en" ? "Daily" : "每日"}</span>
                  <p className="text-sm font-medium text-foreground">
                    {aiGoalRec.dailyMins} {locale === "en" ? "min" : "分钟"}
                    {aiGoalRec.dailyBooks > 0 && ` / ${aiGoalRec.dailyBooks} ${locale === "en" ? "books" : "本"}`}
                  </p>
                </div>
                <div className="rounded-lg bg-background/50 p-2">
                  <span className="text-[10px] text-muted">{locale === "en" ? "Weekly" : "每周"}</span>
                  <p className="text-sm font-medium text-foreground">
                    {aiGoalRec.weeklyMins} {locale === "en" ? "min" : "分钟"}
                    {aiGoalRec.weeklyBooks > 0 && ` / ${aiGoalRec.weeklyBooks} ${locale === "en" ? "books" : "本"}`}
                  </p>
                </div>
              </div>
              <p className="text-xs text-muted/80 leading-relaxed">{aiGoalRec.reasoning}</p>
              {aiGoalRec.encouragement && (
                <p className="mt-1 text-xs text-purple-400/70">💪 {aiGoalRec.encouragement}</p>
              )}
            </div>
          )}
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
                          fetch(apiPath(`/api/goals?goalType=${type}`), { method: "DELETE" }).then(() => fetchGoals());
                        }}
                        className="flex h-6 w-6 items-center justify-center rounded-md text-muted hover:text-rose-400 transition-colors"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                    <button
                      onClick={() => {
                        if (isEditing) {
                          const mins = parseInt(goalMins) || 0;
                          const books = parseInt(goalBooks) || 0;
                          if (mins > 0 || books > 0) {
                            fetch(apiPath("/api/goals"), {
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

      {/* 概览卡片 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        <div className="rounded-xl bg-card p-4 sm:p-6">
          <div className="flex items-center gap-2 text-muted">
            <div className="flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-lg bg-accent/15">
              <Clock className="h-4 w-4 sm:h-5 sm:w-5 text-accent" />
            </div>
            <span className="text-xs sm:text-sm">{t.stats.totalReadTime}</span>
          </div>
          <p className="mt-2 sm:mt-3 text-xl sm:text-3xl font-bold text-foreground tabular-nums">
            {formatDuration(stats.totalReadTime)}
          </p>
        </div>
        <div className="rounded-xl bg-card p-4 sm:p-6">
          <div className="flex items-center gap-2 text-muted">
            <div className="flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-lg bg-emerald-500/15">
              <BarChart3 className="h-4 w-4 sm:h-5 sm:w-5 text-emerald-400" />
            </div>
            <span className="text-xs sm:text-sm">{t.stats.readingSessions}</span>
          </div>
          <p className="mt-2 sm:mt-3 text-xl sm:text-3xl font-bold text-foreground tabular-nums">
            {stats.totalSessions}
          </p>
        </div>
        <div className="rounded-xl bg-card p-4 sm:p-6">
          <div className="flex items-center gap-2 text-muted">
            <div className="flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-lg bg-amber-500/15">
              <BookOpen className="h-4 w-4 sm:h-5 sm:w-5 text-amber-400" />
            </div>
            <span className="text-xs sm:text-sm">{t.stats.comicsRead}</span>
          </div>
          <p className="mt-2 sm:mt-3 text-xl sm:text-3xl font-bold text-foreground tabular-nums">
            {stats.totalComicsRead}
          </p>
        </div>
        <div className="rounded-xl bg-card p-4 sm:p-6">
          <div className="flex items-center gap-2 text-muted">
            <div className="flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-lg bg-rose-500/15">
              <Flame className="h-4 w-4 sm:h-5 sm:w-5 text-rose-400" />
            </div>
            <span className="text-xs sm:text-sm">{t.statsEnhanced?.streak || "连续阅读"}</span>
          </div>
          <p className="mt-2 sm:mt-3 text-xl sm:text-3xl font-bold text-foreground tabular-nums">
            {stats.currentStreak}{t.statsEnhanced?.days || "天"}
          </p>
          <p className="text-[10px] sm:text-xs text-muted mt-1">
            {t.statsEnhanced?.longest || "最长"}: {stats.longestStreak}{t.statsEnhanced?.days || "天"}
          </p>
        </div>
      </div>

      {/* 副卡片 */}
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        <div className="rounded-xl bg-card p-4">
          <div className="flex items-center gap-2 text-muted mb-2">
            <Timer className="h-4 w-4 text-violet-400" />
            <span className="text-xs">{t.statsEnhanced?.today || "今日"}</span>
          </div>
          <p className="text-lg sm:text-xl font-bold text-foreground">
            {formatShortDuration(stats.todayReadTime)}
          </p>
        </div>
        <div className="rounded-xl bg-card p-4">
          <div className="flex items-center gap-2 text-muted mb-2">
            <Calendar className="h-4 w-4 text-cyan-400" />
            <span className="text-xs">{t.statsEnhanced?.thisWeek || "本周"}</span>
          </div>
          <p className="text-lg sm:text-xl font-bold text-foreground">
            {formatShortDuration(stats.weekReadTime)}
          </p>
        </div>
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

      {/* AI 阅读洞察 */}
      {aiConfigured && (
        <div className="rounded-xl bg-card p-4 sm:p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Sparkles className="h-4 w-4 text-amber-400" />
              {t.statsEnhanced?.aiInsight || "AI 阅读洞察"}
            </h2>
            <button
              onClick={generateInsight}
              disabled={aiInsightLoading}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                aiInsightLoading
                  ? "bg-accent/20 text-accent cursor-wait"
                  : "bg-card text-muted hover:text-foreground hover:bg-background"
              }`}
            >
              {aiInsightLoading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t.statsEnhanced?.aiInsightGenerating || "正在生成洞察报告..."}
                </>
              ) : aiInsight ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5" />
                  {"重新生成"}
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" />
                  {"生成洞察报告"}
                </>
              )}
            </button>
          </div>
          {aiInsightError && (
            <div className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">
              {t.statsEnhanced?.aiInsightError || "生成失败"}: {aiInsightError}
            </div>
          )}
          {aiInsight ? (
            <div className="prose prose-sm prose-invert max-w-none text-sm text-foreground/90 leading-relaxed [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1 [&_h2]:text-foreground [&_p]:my-1 [&_ul]:my-1 [&_li]:my-0.5">
              <div dangerouslySetInnerHTML={{ __html: renderMarkdown(aiInsight) }} />
            </div>
          ) : !aiInsightLoading && !aiInsightError ? (
            <p className="text-xs text-muted py-4 text-center">
              {stats.totalSessions > 0
                ? "点击上方按钮，AI 将分析你的阅读数据并生成个性化洞察报告 ✨"
                : (t.statsEnhanced?.aiInsightEmpty || "暂无足够数据生成洞察")}
            </p>
          ) : null}
        </div>
      )}

      {/* 数据导出 + Tab 切换 */}
      <div className="flex items-center gap-2">
        <div className="flex flex-1 items-center gap-1 overflow-x-auto rounded-lg bg-card p-1">
          {[
            { key: "overview" as const, label: t.statsEnhanced?.tabOverview || "概览", icon: TrendingUp },
            { key: "daily" as const, label: t.statsEnhanced?.tabDaily || "每日", icon: Calendar },
            { key: "monthly" as const, label: t.statsEnhanced?.tabMonthly || "月度", icon: BarChart3 },
            { key: "genre" as const, label: t.statsEnhanced?.tabGenre || "类型", icon: PieChart },
            { key: "yearly" as const, label: "年度", icon: Award },
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
        {/* 导出按钮 */}
        <div className="relative">
          <button
            onClick={() => setShowExportMenu(!showExportMenu)}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-card text-muted transition-colors hover:text-foreground"
            title="导出数据"
          >
            <Download className="h-4 w-4" />
          </button>
          {showExportMenu && (
            <div className="absolute right-0 top-full z-50 mt-1 min-w-[180px] rounded-xl border border-border/60 bg-card shadow-xl overflow-hidden">
              <a
                href={apiPath("/api/export/json")}
                download
                onClick={() => setShowExportMenu(false)}
                className="flex items-center gap-2.5 px-4 py-2.5 text-xs text-foreground hover:bg-card-hover transition-colors"
              >
                <FileText className="h-3.5 w-3.5 text-accent" />
                JSON 完整备份
              </a>
              <a
                href={apiPath("/api/export/csv/sessions")}
                download
                onClick={() => setShowExportMenu(false)}
                className="flex items-center gap-2.5 px-4 py-2.5 text-xs text-foreground hover:bg-card-hover transition-colors"
              >
                <BarChart3 className="h-3.5 w-3.5 text-emerald-400" />
                CSV 阅读记录
              </a>
              <a
                href={apiPath("/api/export/csv/comics")}
                download
                onClick={() => setShowExportMenu(false)}
                className="flex items-center gap-2.5 px-4 py-2.5 text-xs text-foreground hover:bg-card-hover transition-colors"
              >
                <BookOpen className="h-3.5 w-3.5 text-amber-400" />
                CSV 漫画库
              </a>
            </div>
          )}
        </div>
      </div>

      {/* 每日阅读图表 */}
      {(activeTab === "overview" || activeTab === "daily") && (stats.dailyStats || []).length > 0 && (
        <div className="rounded-xl bg-card p-4 sm:p-6">
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
        <div className="rounded-xl bg-card p-4 sm:p-6">
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

      {/* 类型偏好 */}
      {(activeTab === "overview" || activeTab === "genre") && genrePercentages.length > 0 && (
        <div className="rounded-xl bg-card p-4 sm:p-6">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-medium text-foreground">
            <PieChart className="h-4 w-4 text-muted" />
            {t.statsEnhanced?.genrePreference || "类型偏好"}
          </h2>
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
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {genrePercentages.map((g, i) => (
              <div key={g.genre} className="flex items-center gap-2">
                <div className={`h-3 w-3 shrink-0 rounded-sm ${genreColors[i % genreColors.length]}`} />
                <span className="text-xs text-foreground truncate">{g.genre}</span>
                <span className="ml-auto text-xs text-muted">{g.percentage}%</span>
              </div>
            ))}
          </div>
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

      {/* 年度报告 */}
      {activeTab === "yearly" && (
        <div className="space-y-4">
          {/* 年份切换 */}
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => setYearlyYear((y) => y - 1)}
              className="rounded-lg border border-border/60 px-3 py-1.5 text-xs text-muted hover:text-foreground transition-colors"
            >
              ← {yearlyYear - 1}
            </button>
            <span className="text-lg font-bold text-foreground">{yearlyYear}</span>
            <button
              onClick={() => setYearlyYear((y) => y + 1)}
              disabled={yearlyYear >= new Date().getFullYear()}
              className="rounded-lg border border-border/60 px-3 py-1.5 text-xs text-muted hover:text-foreground transition-colors disabled:opacity-30"
            >
              {yearlyYear + 1} →
            </button>
          </div>

          {yearlyLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-accent" />
            </div>
          ) : yearlyReport ? (
            <>
              {/* 年度概览卡片 */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
                <div className="rounded-xl bg-card p-4">
                  <div className="flex items-center gap-2 text-muted mb-2">
                    <Clock className="h-4 w-4 text-accent" />
                    <span className="text-xs">总阅读时长</span>
                  </div>
                  <p className="text-xl font-bold text-foreground">{formatDuration(yearlyReport.totalReadTime)}</p>
                </div>
                <div className="rounded-xl bg-card p-4">
                  <div className="flex items-center gap-2 text-muted mb-2">
                    <BarChart3 className="h-4 w-4 text-emerald-400" />
                    <span className="text-xs">阅读次数</span>
                  </div>
                  <p className="text-xl font-bold text-foreground">{yearlyReport.totalSessions}</p>
                </div>
                <div className="rounded-xl bg-card p-4">
                  <div className="flex items-center gap-2 text-muted mb-2">
                    <BookOpen className="h-4 w-4 text-amber-400" />
                    <span className="text-xs">阅读作品</span>
                  </div>
                  <p className="text-xl font-bold text-foreground">{yearlyReport.totalComicsRead}</p>
                </div>
                <div className="rounded-xl bg-card p-4">
                  <div className="flex items-center gap-2 text-muted mb-2">
                    <FileText className="h-4 w-4 text-violet-400" />
                    <span className="text-xs">翻阅页数</span>
                  </div>
                  <p className="text-xl font-bold text-foreground">{yearlyReport.totalPagesRead.toLocaleString()}</p>
                </div>
              </div>

              {/* 月度柱状图 */}
              {yearlyReport.monthlyStats.length > 0 && (() => {
                const maxM = Math.max(...yearlyReport.monthlyStats.map((m) => m.duration), 1);
                return (
                  <div className="rounded-xl bg-card p-4 sm:p-6">
                    <h3 className="mb-4 flex items-center gap-2 text-sm font-medium text-foreground">
                      <Calendar className="h-4 w-4 text-muted" />
                      月度阅读时长
                    </h3>
                    <div className="flex items-end gap-2 sm:gap-3" style={{ height: 160 }}>
                      {yearlyReport.monthlyStats.map((m) => (
                        <div key={m.month} className="group relative flex flex-1 flex-col items-center gap-1">
                          <div
                            className="w-full rounded-t bg-accent/60 transition-colors group-hover:bg-accent"
                            style={{ height: `${Math.max((m.duration / maxM) * 100, 4)}%` }}
                          />
                          <span className="text-[9px] sm:text-[10px] text-muted">{m.month}月</span>
                          <div className="pointer-events-none absolute -top-12 left-1/2 z-10 hidden -translate-x-1/2 rounded-lg bg-zinc-800 px-2 py-1 text-[10px] text-white shadow-lg group-hover:block whitespace-nowrap">
                            {m.month}月: {formatShortDuration(m.duration)} · {m.sessions}次 · {m.comics}本
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Top 10 */}
              {yearlyReport.topComics.length > 0 && (
                <div className="rounded-xl bg-card p-4 sm:p-6">
                  <h3 className="mb-4 flex items-center gap-2 text-sm font-medium text-foreground">
                    <Trophy className="h-4 w-4 text-amber-400" />
                    阅读时长 Top 10
                  </h3>
                  <div className="space-y-2">
                    {yearlyReport.topComics.map((comic, i) => {
                      const maxRT = yearlyReport.topComics[0]?.readTime || 1;
                      return (
                        <div key={comic.id} className="flex items-center gap-3">
                          <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-bold ${
                            i === 0 ? "bg-amber-500/20 text-amber-400" :
                            i === 1 ? "bg-slate-400/20 text-slate-300" :
                            i === 2 ? "bg-amber-700/20 text-amber-600" :
                            "bg-muted/10 text-muted"
                          }`}>
                            {i + 1}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="truncate text-sm text-foreground">{comic.title}</p>
                            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-background">
                              <div className="h-full rounded-full bg-accent/60" style={{ width: `${(comic.readTime / maxRT) * 100}%` }} />
                            </div>
                          </div>
                          <span className="shrink-0 text-xs font-medium text-accent">{formatShortDuration(comic.readTime)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 类型分布 */}
              {yearlyReport.genreDistribution.length > 0 && (
                <div className="rounded-xl bg-card p-4 sm:p-6">
                  <h3 className="mb-4 flex items-center gap-2 text-sm font-medium text-foreground">
                    <PieChart className="h-4 w-4 text-muted" />
                    类型分布
                  </h3>
                  <div className="space-y-2">
                    {yearlyReport.genreDistribution.map((g, i) => (
                      <div key={g.genre} className="flex items-center gap-3">
                        <div className={`h-2.5 w-2.5 shrink-0 rounded-full ${genreColors[i % genreColors.length]}`} />
                        <span className="text-sm text-foreground flex-1 truncate">{g.genre}</span>
                        <span className="text-xs text-muted">{g.count}本</span>
                        <span className="text-xs font-medium text-accent w-14 text-right">{formatShortDuration(g.readTime)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 无数据提示 */}
              {yearlyReport.totalSessions === 0 && (
                <div className="py-16 text-center">
                  <Award className="mx-auto h-12 w-12 text-muted/20 mb-4" />
                  <p className="text-sm text-muted">{yearlyYear} 年暂无阅读记录</p>
                </div>
              )}
            </>
          ) : (
            <div className="py-16 text-center">
              <p className="text-sm text-muted">无法加载年度报告</p>
            </div>
          )}
        </div>
      )}

      {/* 最近记录（带分页） */}
      {activeTab === "overview" && (
        <div className="rounded-xl bg-card p-4 sm:p-6">
          <h2 className="mb-4 text-sm font-medium text-foreground">{t.stats.recentRecords}</h2>
          {stats.recentSessions.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">{t.stats.noRecords}</p>
          ) : (
            <>
              <div className="space-y-2 sm:space-y-3">
                {stats.recentSessions.slice(0, visibleSessions).map((session) => (
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
              {/* 加载更多 */}
              {visibleSessions < stats.recentSessions.length && (
                <button
                  onClick={() => setVisibleSessions((v) => v + 10)}
                  className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-border/60 py-2.5 text-xs text-muted hover:text-foreground transition-colors"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                  加载更多（{Math.min(visibleSessions, stats.recentSessions.length)} / {stats.recentSessions.length}）
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
