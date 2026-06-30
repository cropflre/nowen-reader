"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Clock,
  BookOpen,
  Filter,
  SortAsc,
  ChevronRight,
  CalendarDays,
  Timer,
  BarChart3,
  BookMarked,
  Sparkles,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { calculateReadingProgress, isReadingFinished } from "@/lib/progress";

interface ApiComic {
  id: string;
  title: string;
  filename: string;
  pageCount: number;
  fileSize: number;
  lastReadPage: number;
  lastReadAt: string | null;
  totalReadTime: number;
  coverUrl: string;
  coverAspectRatio: number;
  readingStatus?: string;
  type: string;
  author: string;
}

interface ComicGroup {
  label: string;
  key: string;
  items: ApiComic[];
}

type FilterKey = "all" | "comic" | "novel" | "reading" | "finished";
type SortKey = "recent" | "duration" | "progress";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "comic", label: "漫画" },
  { key: "novel", label: "小说" },
  { key: "reading", label: "在读" },
  { key: "finished", label: "已完成" },
];

const SORTS: { key: SortKey; label: string }[] = [
  { key: "recent", label: "最近阅读" },
  { key: "duration", label: "阅读时长" },
  { key: "progress", label: "阅读进度" },
];

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "0 分钟";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h} 小时 ${m > 0 ? m + " 分" : ""}`.trim();
  if (m > 0) return `${m} 分钟`;
  return `${seconds} 秒`;
}

function formatReadTime(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffMs = today.getTime() - target.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  const time = d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 0) return `今天 ${time}`;
  if (diffDays === 1) return `昨天 ${time}`;
  if (diffDays < 7) {
    const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    return `${weekdays[d.getDay()]} ${time}`;
  }
  return d.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }) + " " + time;
}

function getDateGroup(dateStr: string | null): string {
  if (!dateStr) return "更早";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "更早";
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffMs = today.getTime() - target.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return "今天";
  if (diffDays === 1) return "昨天";
  if (diffDays < 7) return "近 7 天";
  return "更早";
}

const GROUP_ORDER = ["今天", "昨天", "近 7 天", "更早"];

export default function HistoryPage() {
  const router = useRouter();
  const t = useTranslation();
  const [comics, setComics] = useState<ApiComic[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");
  const [activeSort, setActiveSort] = useState<SortKey>("recent");

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch(
        "/api/comics?sortBy=lastReadAt&sortOrder=desc&pageSize=200&page=1",
        { credentials: "include" }
      );
      if (!res.ok) return;
      const data = await res.json();
      const all: ApiComic[] = data.comics || [];
      setComics(all.filter((c) => !!c.lastReadAt && c.lastReadPage > 0));
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const filtered = useMemo(() => {
    let items = [...comics];
    if (activeFilter === "comic") items = items.filter((c) => c.type !== "novel");
    else if (activeFilter === "novel") items = items.filter((c) => c.type === "novel");
    else if (activeFilter === "reading") items = items.filter((c) => !isReadingFinished(c.lastReadPage, c.pageCount));
    else if (activeFilter === "finished") items = items.filter((c) => isReadingFinished(c.lastReadPage, c.pageCount));

    if (activeSort === "recent") {
      items.sort((a, b) => new Date(b.lastReadAt!).getTime() - new Date(a.lastReadAt!).getTime());
    } else if (activeSort === "duration") {
      items.sort((a, b) => (b.totalReadTime || 0) - (a.totalReadTime || 0));
    } else if (activeSort === "progress") {
      items.sort((a, b) => calculateReadingProgress(b.lastReadPage, b.pageCount) - calculateReadingProgress(a.lastReadPage, a.pageCount));
    }
    return items;
  }, [comics, activeFilter, activeSort]);

  const grouped = useMemo<ComicGroup[]>(() => {
    if (activeSort !== "recent") {
      return [{ label: "全部", key: "all", items: filtered }];
    }
    const map = new Map<string, ApiComic[]>();
    for (const c of filtered) {
      const g = getDateGroup(c.lastReadAt);
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(c);
    }
    return GROUP_ORDER.filter((g) => map.has(g)).map((g) => ({ label: g, key: g, items: map.get(g)! }));
  }, [filtered, activeSort]);

  const summary = useMemo(() => {
    const totalTime = comics.reduce((s, c) => s + (c.totalReadTime || 0), 0);
    const readingCount = comics.filter((c) => !isReadingFinished(c.lastReadPage, c.pageCount)).length;
    const finishedCount = comics.filter((c) => isReadingFinished(c.lastReadPage, c.pageCount)).length;
    return { total: comics.length, totalTime, readingCount, finishedCount };
  }, [comics]);

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-card/60" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1680px] px-4 sm:px-6 lg:px-10 py-6 sm:py-8">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => router.push("/")}
          className="mb-4 flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {t.common?.back || "返回首页"}
        </button>

        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground flex items-center gap-2">
              <Clock className="h-6 w-6 sm:h-7 sm:w-7 text-accent" />
              阅读历史
            </h1>
            <p className="mt-1 text-sm text-muted">
              {summary.total > 0
                ? `共 ${summary.total} 部作品，累计阅读 ${formatDuration(summary.totalTime)}`
                : "开始阅读一本作品后，它会出现在这里。"}
            </p>
          </div>
        </div>
      </div>

      {comics.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {[
              { icon: <BookOpen className="h-4 w-4" />, label: "总作品", value: String(summary.total), color: "text-accent" },
              { icon: <Timer className="h-4 w-4" />, label: "累计时长", value: formatDuration(summary.totalTime), color: "text-emerald-400" },
              { icon: <BookMarked className="h-4 w-4" />, label: "在读", value: String(summary.readingCount), color: "text-blue-400" },
              { icon: <Sparkles className="h-4 w-4" />, label: "已完成", value: String(summary.finishedCount), color: "text-amber-400" },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-border/40 bg-card/60 backdrop-blur-sm p-3 sm:p-4">
                <div className={`flex items-center gap-2 ${s.color} mb-1`}>
                  {s.icon}
                  <span className="text-xs">{s.label}</span>
                </div>
                <div className="text-lg sm:text-xl font-bold text-foreground">{s.value}</div>
              </div>
            ))}
          </div>

          {/* Filters & Sort */}
          <div className="flex flex-wrap items-center gap-2 mb-5">
            <Filter className="h-4 w-4 text-muted" />
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setActiveFilter(f.key)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                  activeFilter === f.key
                    ? "bg-accent text-white"
                    : "bg-card border border-border/40 text-muted hover:text-foreground hover:border-border"
                }`}
              >
                {f.label}
              </button>
            ))}
            <div className="mx-2 h-5 w-px bg-border/40" />
            <SortAsc className="h-4 w-4 text-muted" />
            {SORTS.map((s) => (
              <button
                key={s.key}
                onClick={() => setActiveSort(s.key)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                  activeSort === s.key
                    ? "bg-accent text-white"
                    : "bg-card border border-border/40 text-muted hover:text-foreground hover:border-border"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Grouped Content */}
          <div className="space-y-6">
            {grouped.map((group) => (
              <div key={group.key}>
                {group.label !== "全部" && (
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-muted mb-3">
                    <CalendarDays className="h-4 w-4" />
                    {group.label}
                    <span className="text-xs font-normal text-muted/60">({group.items.length})</span>
                  </h2>
                )}
                <div className="space-y-2">
                  {group.items.map((comic) => (
                    <HistoryCard key={comic.id} comic={comic} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function HistoryCard({ comic }: { comic: ApiComic }) {
  const progress = calculateReadingProgress(comic.lastReadPage, comic.pageCount);
  const finished = isReadingFinished(comic.lastReadPage, comic.pageCount);
  // 判断是否已开始阅读（不依赖 progress > 0，避免小数进度被四舍五入为 0）
  const hasStarted = !!comic.lastReadAt || comic.lastReadPage > 0;

  // 状态标签逻辑
  let statusText: string;
  let statusColor: string;
  if (finished) {
    statusText = "已完成";
    statusColor = "text-amber-400 bg-amber-500/10";
  } else if (hasStarted && progress > 0) {
    statusText = `${progress}%`;
    statusColor = "text-blue-400 bg-blue-500/10";
  } else if (hasStarted) {
    // 已开始但进度 < 1%（四舍五入后为 0）
    statusText = "<1%";
    statusColor = "text-blue-400 bg-blue-500/10";
  } else {
    statusText = "未读";
    statusColor = "text-muted bg-muted/10";
  }

  // 进度条最小宽度（已开始阅读时至少显示 2%，避免完全看不见）
  const progressBarWidth = hasStarted && progress === 0 ? 2 : progress;

  return (
    <div className="group flex gap-3 sm:gap-4 rounded-2xl border border-border/30 bg-card/60 backdrop-blur-sm p-3 sm:p-4 transition-all hover:border-border/60 hover:bg-card/80">
      {/* Cover */}
      <Link
        href={`/comic/${comic.id}`}
        className="relative h-20 w-14 sm:h-24 sm:w-[68px] flex-shrink-0 overflow-hidden rounded-xl bg-muted/10"
      >
        {comic.coverUrl ? (
          <Image
            src={comic.coverUrl}
            alt={comic.title}
            fill
            className="object-contain"
            sizes="68px"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted/40">
            <BookOpen className="h-6 w-6" />
          </div>
        )}
      </Link>

      {/* Info */}
      <div className="flex min-w-0 flex-1 flex-col justify-between">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <Link href={`/comic/${comic.id}`} className="text-sm font-semibold text-foreground hover:text-accent transition-colors truncate">
              {comic.title || comic.filename}
            </Link>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${statusColor}`}>
              {statusText}
            </span>
          </div>

          <div className="mt-1 flex items-center gap-3 text-xs text-muted">
            {comic.author && <span className="truncate">{comic.author}</span>}
            {comic.lastReadAt && (
              <span className="flex items-center gap-1 shrink-0">
                <Clock className="h-3 w-3" />
                {formatReadTime(comic.lastReadAt)}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 mt-2">
          {/* Progress bar */}
          {comic.pageCount > 0 && (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className="h-1.5 flex-1 rounded-full bg-muted/20 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${finished ? "bg-amber-400" : "bg-accent"}`}
                  style={{ width: `${progressBarWidth}%` }}
                />
              </div>
              <span className="text-[10px] text-muted shrink-0">
                {comic.lastReadPage + 1}/{comic.pageCount} 页
              </span>
            </div>
          )}

          {comic.totalReadTime > 0 && (
            <span className="text-[10px] text-muted flex items-center gap-1 shrink-0">
              <Timer className="h-3 w-3" />
              {formatDuration(comic.totalReadTime)}
            </span>
          )}

          {/* Actions */}
          <div className="flex items-center gap-1.5 ml-auto shrink-0">
            <Link
              href={`/comic/${comic.id}`}
              className="rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-muted border border-border/30 hover:text-foreground hover:border-border/60 transition-all"
            >
              详情
            </Link>
            {!finished && comic.pageCount > 0 && (
              <Link
                href={comic.type === "novel" ? `/novel/${comic.id}` : `/reader/${comic.id}`}
                className="rounded-lg px-2.5 py-1.5 text-[11px] font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-all"
              >
                继续阅读
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted/10">
        <BookOpen className="h-8 w-8 text-muted/40" />
      </div>
      <h3 className="text-base font-semibold text-foreground mb-2">还没有阅读历史</h3>
      <p className="text-sm text-muted mb-6 max-w-xs">
        开始阅读一本作品后，它会出现在这里。
      </p>
      <Link
        href="/"
        className="inline-flex items-center gap-2 rounded-xl bg-accent/10 text-accent px-5 py-2.5 text-sm font-medium hover:bg-accent/20 transition-all"
      >
        <BookOpen className="h-4 w-4" />
        去书库看看
      </Link>
    </div>
  );
}
