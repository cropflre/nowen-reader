"use client";

import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  Grid2X2,
  Layers3,
  List,
  Loader2,
  Lock,
  Pencil,
  RefreshCw,
  Save,
  Sparkles,
  Unlock,
  X,
} from "lucide-react";
import { fetchSeriesDetail, redetectSeries, updateSeries, updateSeriesStructure } from "@/api/series";
import { GroupMetadataSearch } from "@/components/GroupMetadataSearch";
import type { SeriesDetail, SeriesItem } from "@/types/series";
import { useAuth } from "@/lib/auth-context";
import { calculateStoredReadingProgress, isStoredReadingFinished } from "@/lib/progress";
import { formatDuration, formatFileSize, isNovelFile } from "@/lib/comic-utils";

function readerURL(item: SeriesItem): string {
  if (item.comic.type === "novel" || isNovelFile(item.comic.filename || "")) {
    return `/novel/${item.comic.id}`;
  }
  return `/reader/${item.comic.id}`;
}

function itemProgress(item: SeriesItem): number {
  return item.comic.pageCount && item.comic.pageCount > 0
    ? calculateStoredReadingProgress(
        item.comic.lastReadPage || 0,
        item.comic.pageCount,
        item.comic.lastReadAt,
        item.comic.readingStatus,
      )
    : 0;
}

function isFinished(item: SeriesItem): boolean {
  return isStoredReadingFinished(
    item.comic.lastReadPage || 0,
    item.comic.pageCount || 0,
    item.comic.lastReadAt,
    item.comic.readingStatus,
  );
}

export default function SeriesDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const id = String(params?.id || "");
  const [detail, setDetail] = useState<SeriesDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [activeSection, setActiveSection] = useState("all");
  const [viewMode, setViewMode] = useState<"list" | "grid">(() => {
    if (typeof window === "undefined") return "list";
    return localStorage.getItem("series:itemView") === "grid" ? "grid" : "list";
  });
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [manageStructure, setManageStructure] = useState(false);
  const [showScraper, setShowScraper] = useState(false);
  const [draftItems, setDraftItems] = useState<Record<string, { sectionId: string; sortIndex: number }>>({});

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError("");
    try {
      const data = await fetchSeriesDetail(id);
      setDetail(data);
      setTitle(data.series.title);
      const draft: Record<string, { sectionId: string; sortIndex: number }> = {};
      [...data.unsectioned, ...data.sections.flatMap((section) => section.items)].forEach((item) => {
        draft[item.comic.id] = { sectionId: item.sectionId || "", sortIndex: item.sortIndex };
      });
      setDraftItems(draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : "作品加载失败");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    localStorage.setItem("series:itemView", viewMode);
  }, [viewMode]);

  const allItems = useMemo(() => {
    if (!detail) return [];
    return [...detail.unsectioned, ...detail.sections.flatMap((section) => section.items)]
      .sort((a, b) => a.sortIndex - b.sortIndex);
  }, [detail]);

  const visibleItems = useMemo(() => {
    if (!detail || activeSection === "all") return allItems;
    if (activeSection === "unsectioned") return detail.unsectioned;
    return detail.sections.find((section) => section.id === activeSection)?.items || [];
  }, [activeSection, allItems, detail]);

  const continueItem = useMemo(() => {
    const inProgress = allItems.find((item) => itemProgress(item) > 0 && !isFinished(item));
    if (inProgress) return inProgress;
    const firstUnread = allItems.find((item) => !isFinished(item));
    return firstUnread || allItems[0];
  }, [allItems]);

  const moveDraft = (comicId: string, direction: -1 | 1) => {
    const ordered = [...visibleItems].sort((a, b) => (draftItems[a.comic.id]?.sortIndex ?? a.sortIndex) - (draftItems[b.comic.id]?.sortIndex ?? b.sortIndex));
    const index = ordered.findIndex((item) => item.comic.id === comicId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    const current = ordered[index];
    const other = ordered[target];
    setDraftItems((previous) => ({
      ...previous,
      [current.comic.id]: { ...(previous[current.comic.id] || { sectionId: current.sectionId || "" }), sortIndex: previous[other.comic.id]?.sortIndex ?? other.sortIndex },
      [other.comic.id]: { ...(previous[other.comic.id] || { sectionId: other.sectionId || "" }), sortIndex: previous[current.comic.id]?.sortIndex ?? current.sortIndex },
    }));
  };

  const saveTitle = async () => {
    if (!detail || !title.trim()) return;
    setBusy(true);
    try {
      await updateSeries(detail.series.id, { title: title.trim(), manualLocked: true });
      await load();
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  const toggleLock = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      await updateSeries(detail.series.id, { manualLocked: !detail.series.manualLocked });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const saveStructure = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      await updateSeriesStructure(
        detail.series.id,
        allItems.map((item) => ({
          comicId: item.comic.id,
          sectionId: draftItems[item.comic.id]?.sectionId || undefined,
          sortIndex: draftItems[item.comic.id]?.sortIndex ?? item.sortIndex,
        })),
      );
      await load();
      setManageStructure(false);
    } finally {
      setBusy(false);
    }
  };

  const handleRedetect = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      await redetectSeries(detail.series.id);
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <main className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-accent" /></main>;
  }

  if (!detail || error) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <Layers3 className="h-12 w-12 text-muted/40" />
        <p className="text-sm text-muted">{error || "作品不存在"}</p>
        <button onClick={() => router.push("/books")} className="rounded-lg bg-accent px-4 py-2 text-sm text-white">返回书架</button>
      </main>
    );
  }

  const { series } = detail;
  const overallProgress = series.itemCount > 0 ? Math.round((series.completedItemCount / series.itemCount) * 100) : 0;
  const contentType = allItems.filter((item) => item.comic.type === "novel" || isNovelFile(item.comic.filename || "")).length > allItems.length / 2
    ? "novel"
    : "comic";

  return (
    <main className="min-h-screen bg-background pb-24">
      <header className="sticky top-0 z-30 border-b border-border/50 bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <button onClick={() => router.push("/books")} className="flex h-9 w-9 items-center justify-center rounded-full border border-border/60 text-muted hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">{series.title}</p>
            <p className="truncate text-[11px] text-muted">{series.rootRelativePath}</p>
          </div>
          <div className="flex rounded-lg border border-border/60 bg-card/60 p-0.5">
            <button onClick={() => setViewMode("list")} className={`flex h-8 w-8 items-center justify-center rounded-md ${viewMode === "list" ? "bg-accent text-white" : "text-muted"}`}><List className="h-4 w-4" /></button>
            <button onClick={() => setViewMode("grid")} className={`flex h-8 w-8 items-center justify-center rounded-md ${viewMode === "grid" ? "bg-accent text-white" : "text-muted"}`}><Grid2X2 className="h-4 w-4" /></button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <section className="overflow-hidden rounded-3xl border border-border/50 bg-card/55 shadow-xl shadow-black/5">
          <div className="grid gap-6 p-5 sm:grid-cols-[180px_1fr] sm:p-7">
            <div className="relative mx-auto aspect-[5/7] w-full max-w-[180px] overflow-hidden rounded-2xl bg-card shadow-lg">
              {series.coverUrl ? <img src={series.coverUrl} alt={series.title} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center"><BookOpen className="h-12 w-12 text-muted/30" /></div>}
              <div className="absolute inset-x-0 bottom-0 h-1.5 bg-black/30"><div className="h-full bg-accent" style={{ width: `${overallProgress}%` }} /></div>
            </div>

            <div className="flex min-w-0 flex-col justify-center">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <span className="rounded-full bg-accent/10 px-2.5 py-1 text-accent">目录作品</span>
                <span>{series.itemCount} 个阅读单元</span>
                {series.sectionCount > 0 && <span>{series.sectionCount} 季/篇</span>}
                {series.manualLocked && <span className="inline-flex items-center gap-1"><Lock className="h-3 w-3" />手动结构</span>}
              </div>

              {editing ? (
                <div className="mt-3 flex max-w-xl gap-2">
                  <input value={title} onChange={(event: ChangeEvent<HTMLInputElement>) => setTitle(event.target.value)} className="h-11 flex-1 rounded-xl border border-border bg-background px-3 text-lg font-semibold outline-none focus:border-accent" autoFocus />
                  <button onClick={saveTitle} disabled={busy} className="flex h-11 items-center gap-1.5 rounded-xl bg-accent px-4 text-sm font-medium text-white"><Save className="h-4 w-4" />保存</button>
                </div>
              ) : (
                <div className="mt-3 flex items-start gap-2">
                  <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{series.title}</h1>
                  {series.canManage && <button onClick={() => setEditing(true)} className="mt-1 rounded-lg p-1.5 text-muted hover:bg-card hover:text-foreground"><Pencil className="h-4 w-4" /></button>}
                </div>
              )}

              <div className="mt-5 grid max-w-2xl grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl bg-background/70 p-3"><p className="text-[11px] text-muted">整部进度</p><p className="mt-1 text-lg font-semibold">{series.completedItemCount}/{series.itemCount}</p></div>
                <div className="rounded-xl bg-background/70 p-3"><p className="text-[11px] text-muted">完成比例</p><p className="mt-1 text-lg font-semibold">{overallProgress}%</p></div>
                <div className="rounded-xl bg-background/70 p-3"><p className="text-[11px] text-muted">总大小</p><p className="mt-1 text-lg font-semibold">{formatFileSize(series.fileSize)}</p></div>
                <div className="rounded-xl bg-background/70 p-3"><p className="text-[11px] text-muted">阅读时长</p><p className="mt-1 text-lg font-semibold">{formatDuration(series.totalReadTime)}</p></div>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                {continueItem && <a href={readerURL(continueItem)} className="flex h-10 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-medium text-white shadow-lg shadow-accent/20"><BookOpen className="h-4 w-4" />{itemProgress(continueItem) > 0 ? "继续阅读" : "开始阅读"}</a>}
                {series.canManage && <button onClick={() => setManageStructure((value) => !value)} className="flex h-10 items-center gap-2 rounded-xl border border-border px-4 text-sm text-foreground hover:bg-background"><Layers3 className="h-4 w-4" />调整结构</button>}
                {isAdmin && <button onClick={() => setShowScraper(true)} className="flex h-10 items-center gap-2 rounded-xl border border-border px-4 text-sm text-foreground hover:bg-background"><Sparkles className="h-4 w-4 text-purple-400" />刮削元数据</button>}
                {series.canManage && <button onClick={toggleLock} disabled={busy} className="flex h-10 items-center gap-2 rounded-xl border border-border px-4 text-sm text-muted hover:text-foreground">{series.manualLocked ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}{series.manualLocked ? "恢复自动" : "锁定结构"}</button>}
                {series.canManage && <button onClick={handleRedetect} disabled={busy || series.manualLocked} className="flex h-10 items-center gap-2 rounded-xl border border-border px-4 text-sm text-muted hover:text-foreground disabled:opacity-40"><RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />重新识别</button>}
              </div>

              {(series.author || series.year || series.publisher || series.language || series.genre || series.description || series.tags.length > 0 || series.externalRating != null) && (
                <div className="mt-5 max-w-3xl space-y-3 border-t border-border/50 pt-5">
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                    {series.author && <span>作者：<span className="text-foreground">{series.author}</span></span>}
                    {series.year && <span>年份：<span className="text-foreground">{series.year}</span></span>}
                    {series.publisher && <span>出版：<span className="text-foreground">{series.publisher}</span></span>}
                    {series.language && <span>语言：<span className="text-foreground">{series.language}</span></span>}
                    {series.externalRating != null && (
                      <span>评分：<span className="text-foreground">{series.externalRating}{series.externalRatingMax ? `/${series.externalRatingMax}` : ""}</span></span>
                    )}
                  </div>
                  {(series.tags.length > 0 || series.genre) && (
                    <div className="flex flex-wrap gap-1.5">
                      {(series.tags.length > 0 ? series.tags.map((tag) => tag.name) : series.genre.split(",").map((name) => name.trim()).filter(Boolean)).map((name) => (
                        <span key={name} className="rounded-full bg-accent/10 px-2.5 py-1 text-xs text-accent">{name}</span>
                      ))}
                    </div>
                  )}
                  {series.description && <p className="whitespace-pre-line text-sm leading-6 text-muted">{series.description}</p>}
                </div>
              )}
            </div>
          </div>
        </section>

        {(detail.sections.length > 0 || detail.unsectioned.length > 0) && (
          <nav className="mt-6 flex gap-2 overflow-x-auto pb-1">
            <button onClick={() => setActiveSection("all")} className={`shrink-0 rounded-full px-4 py-2 text-sm ${activeSection === "all" ? "bg-accent text-white" : "bg-card text-muted"}`}>全部 {allItems.length}</button>
            {detail.unsectioned.length > 0 && <button onClick={() => setActiveSection("unsectioned")} className={`shrink-0 rounded-full px-4 py-2 text-sm ${activeSection === "unsectioned" ? "bg-accent text-white" : "bg-card text-muted"}`}>未分季 {detail.unsectioned.length}</button>}
            {detail.sections.map((section) => <button key={section.id} onClick={() => setActiveSection(section.id)} className={`shrink-0 rounded-full px-4 py-2 text-sm ${activeSection === section.id ? "bg-accent text-white" : "bg-card text-muted"}`}>{section.title} {section.items.length}</button>)}
          </nav>
        )}

        {manageStructure && (
          <div className="mt-5 flex items-center justify-between rounded-2xl border border-accent/30 bg-accent/5 px-4 py-3">
            <div><p className="text-sm font-medium text-foreground">结构管理模式</p><p className="text-xs text-muted">可调整季归属与顺序；保存后自动锁定，后续扫描不会覆盖。</p></div>
            <div className="flex gap-2"><button onClick={() => setManageStructure(false)} className="rounded-lg px-3 py-2 text-sm text-muted">取消</button><button onClick={saveStructure} disabled={busy} className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm text-white"><Check className="h-4 w-4" />保存结构</button></div>
          </div>
        )}

        <section className="mt-6">
          <div className="mb-3 flex items-center justify-between"><h2 className="text-base font-semibold">阅读单元</h2><span className="text-xs text-muted">{visibleItems.length} 项</span></div>
          <div className={viewMode === "grid" ? "grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5" : "space-y-2"}>
            {visibleItems.map((item, index) => {
              const progress = itemProgress(item);
              const finished = isFinished(item);
              const draft = draftItems[item.comic.id] || { sectionId: item.sectionId || "", sortIndex: item.sortIndex };
              if (viewMode === "grid") {
                return (
                  <div key={item.comic.id} className="overflow-hidden rounded-2xl border border-border/50 bg-card/65">
                    <a href={readerURL(item)} className="group block">
                      <div className="relative aspect-[5/7] overflow-hidden bg-background">
                        <img src={item.comic.coverUrl} alt={item.comic.title} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                        <span className="absolute left-2 top-2 rounded-full bg-black/65 px-2 py-1 text-[10px] text-white">{finished ? "已读" : progress > 0 ? `${Math.round(progress)}%` : "未读"}</span>
                        <div className="absolute inset-x-0 bottom-0 h-1 bg-black/35"><div className="h-full bg-accent" style={{ width: `${progress}%` }} /></div>
                      </div>
                      <div className="p-3"><p className="line-clamp-2 text-sm font-medium text-foreground">{item.displayLabel || item.comic.title}</p><p className="mt-1 text-[11px] text-muted">{item.comic.pageCount || 0} 页</p></div>
                    </a>
                    {manageStructure && <div className="border-t border-border/50 p-2"><select value={draft.sectionId} onChange={(event: ChangeEvent<HTMLSelectElement>) => setDraftItems((previous) => ({ ...previous, [item.comic.id]: { ...draft, sectionId: event.target.value } }))} className="h-8 w-full rounded-lg bg-background px-2 text-xs"><option value="">未分季</option>{detail.sections.map((section) => <option key={section.id} value={section.id}>{section.title}</option>)}</select></div>}
                  </div>
                );
              }
              return (
                <div key={item.comic.id} className="flex items-center gap-3 rounded-2xl border border-border/50 bg-card/60 p-2.5 sm:p-3">
                  <a href={readerURL(item)} className="relative h-20 w-14 shrink-0 overflow-hidden rounded-lg bg-background"><img src={item.comic.coverUrl} alt={item.comic.title} className="h-full w-full object-cover" /><div className="absolute inset-x-0 bottom-0 h-1 bg-black/35"><div className="h-full bg-accent" style={{ width: `${progress}%` }} /></div></a>
                  <a href={readerURL(item)} className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-foreground">{item.displayLabel || item.comic.title}</p><p className="mt-1 text-xs text-muted">{item.comic.pageCount || 0} 页 · {formatFileSize(item.comic.fileSize || 0)} · {finished ? "已读" : progress > 0 ? `阅读至 ${Math.round(progress)}%` : "未读"}</p></a>
                  {manageStructure ? <div className="flex items-center gap-1"><select value={draft.sectionId} onChange={(event: ChangeEvent<HTMLSelectElement>) => setDraftItems((previous) => ({ ...previous, [item.comic.id]: { ...draft, sectionId: event.target.value } }))} className="h-8 max-w-32 rounded-lg bg-background px-2 text-xs"><option value="">未分季</option>{detail.sections.map((section) => <option key={section.id} value={section.id}>{section.title}</option>)}</select><button onClick={() => moveDraft(item.comic.id, -1)} disabled={index === 0} className="rounded-md p-1.5 text-muted disabled:opacity-30"><ChevronUp className="h-4 w-4" /></button><button onClick={() => moveDraft(item.comic.id, 1)} disabled={index === visibleItems.length - 1} className="rounded-md p-1.5 text-muted disabled:opacity-30"><ChevronDown className="h-4 w-4" /></button></div> : <a href={readerURL(item)} className="rounded-xl bg-accent/10 px-3 py-2 text-xs font-medium text-accent">阅读</a>}
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {isAdmin && showScraper && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4" onClick={() => setShowScraper(false)}>
          <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-border bg-card shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-purple-400" />
                <h2 className="text-base font-semibold text-foreground">目录作品元数据刮削</h2>
              </div>
              <button onClick={() => setShowScraper(false)} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-card-hover" title="关闭">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5">
              <GroupMetadataSearch
                key={series.id}
                seriesId={series.id}
                groupName={series.title}
                contentType={contentType}
                onApplied={async (success) => {
                  if (success) await load();
                }}
              />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
