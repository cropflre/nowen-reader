"use client";

import { useState, useCallback, useMemo } from "react";
import { X, Copy, Trash2, AlertTriangle, FileCheck, FileText, Brain, Loader2, Filter, Eye, ChevronDown, ChevronUp } from "lucide-react";
import { useTranslation, useLocale } from "@/lib/i18n";
import { useAIStatus } from "@/hooks/useAIStatus";

interface DuplicateComic {
  id: string;
  filename: string;
  title: string;
  fileSize: number;
  pageCount: number;
  addedAt: string;
  coverUrl: string;
  author?: string;
  genre?: string;
  format?: string;
}

interface DuplicateGroup {
  reason: string;
  confidence: number;
  details: string;
  comics: DuplicateComic[];
}

interface DuplicateDetectorProps {
  open: boolean;
  onClose: () => void;
  onDeleted: () => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

export default function DuplicateDetector({ open, onClose, onDeleted }: DuplicateDetectorProps) {
  const t = useTranslation();
  const { locale } = useLocale();
  const { aiConfigured } = useAIStatus();
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<DuplicateComic | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Track which comic to keep per group (key: group index, value: comic id)
  const [keepSelection, setKeepSelection] = useState<Record<number, string>>({});
  // Batch delete all duplicates
  const [batchDeleteConfirm, setBatchDeleteConfirm] = useState(false);
  const [batchDeleting, setBatchDeleting] = useState(false);
  // AI verification state
  const [aiVerifying, setAiVerifying] = useState(false);
  const [aiResults, setAiResults] = useState<Record<number, { isDuplicate: boolean; confidence: string; reason: string }>>({});
  // Filter state
  const [filterReason, setFilterReason] = useState<string>("all");
  // Compare mode: show covers side by side
  const [compareGroupIdx, setCompareGroupIdx] = useState<number | null>(null);
  // Expand details
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());

  const detect = useCallback(async () => {
    setLoading(true);
    setGroups(null);
    setKeepSelection({});
    setAiResults({});
    setFilterReason("all");
    setCompareGroupIdx(null);
    setExpandedGroups(new Set());
    try {
      // Fetch traditional duplicates
      const res = await fetch("/api/comics/duplicates");
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      let allGroups: DuplicateGroup[] = data.groups || [];

      setGroups(allGroups);
      // Default: keep first comic in each group
      const defaults: Record<number, string> = {};
      allGroups.forEach((g: DuplicateGroup, i: number) => {
        if (g.comics.length > 0) defaults[i] = g.comics[0].id;
      });
      setKeepSelection(defaults);
    } catch {
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // AI 验证重复组
  const handleAIVerify = useCallback(async () => {
    if (!groups || groups.length === 0 || aiVerifying) return;
    setAiVerifying(true);
    setAiResults({});
    try {
      const payload = groups.map((g) => ({
        reason: g.reason,
        comics: g.comics.map((c) => ({
          id: c.id,
          filename: c.filename,
          title: c.title,
          fileSize: c.fileSize,
          pageCount: c.pageCount,
        })),
      }));
      const res = await fetch("/api/ai/verify-duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groups: payload, targetLang: locale === "en" ? "en" : "zh" }),
      });
      if (res.ok) {
        const data = await res.json();
        const newResults: Record<number, { isDuplicate: boolean; confidence: string; reason: string }> = {};
        for (const r of data.results || []) {
          if (r.verification) {
            newResults[r.groupIndex] = r.verification;
          }
        }
        setAiResults(newResults);
      }
    } catch {
      // ignore
    } finally {
      setAiVerifying(false);
    }
  }, [groups, aiVerifying, locale]);

  // Filtered groups
  const filteredGroups = useMemo(() => {
    if (!groups) return null;
    if (filterReason === "all") return groups;
    return groups.filter((g) => g.reason === filterReason);
  }, [groups, filterReason]);

  // Available reason types
  const availableReasons = useMemo(() => {
    if (!groups) return [];
    const reasons = new Set(groups.map((g) => g.reason));
    return Array.from(reasons);
  }, [groups]);

  // Get all comic IDs that will be deleted (not kept)
  const toDeleteIds = useMemo(() => {
    if (!groups) return [];
    const ids: string[] = [];
    groups.forEach((g, gi) => {
      const keepId = keepSelection[gi] || g.comics[0]?.id;
      g.comics.forEach((c) => {
        if (c.id !== keepId) ids.push(c.id);
      });
    });
    return ids;
  }, [groups, keepSelection]);

  const handleDelete = useCallback(async (comic: DuplicateComic) => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/comics/${comic.id}/delete`, { method: "DELETE" });
      if (res.ok) {
        setGroups((prev) => {
          if (!prev) return prev;
          return prev
            .map((g) => ({
              ...g,
              comics: g.comics.filter((c) => c.id !== comic.id),
            }))
            .filter((g) => g.comics.length > 1);
        });
        onDeleted();
      }
    } catch {
      // ignore
    } finally {
      setDeleting(false);
      setDeleteConfirm(null);
    }
  }, [onDeleted]);

  // Batch delete: delete all non-kept comics across all groups
  const handleBatchDelete = useCallback(async () => {
    if (toDeleteIds.length === 0) return;
    setBatchDeleting(true);
    let deletedCount = 0;
    for (const id of toDeleteIds) {
      try {
        const res = await fetch(`/api/comics/${id}/delete`, { method: "DELETE" });
        if (res.ok) deletedCount++;
      } catch {
        // continue with next
      }
    }
    if (deletedCount > 0) {
      onDeleted();
      // Re-detect after batch delete
      setBatchDeleteConfirm(false);
      setBatchDeleting(false);
      await detect();
    } else {
      setBatchDeleteConfirm(false);
      setBatchDeleting(false);
    }
  }, [toDeleteIds, onDeleted, detect]);

  const selectKeep = useCallback((groupIndex: number, comicId: string) => {
    setKeepSelection((prev) => ({ ...prev, [groupIndex]: comicId }));
  }, []);

  if (!open) return null;

  const reasonIcon = (reason: string) => {
    switch (reason) {
      case "sameFile": return <FileCheck className="h-4 w-4 text-red-400" />;
      case "sameSize": return <Copy className="h-4 w-4 text-amber-400" />;
      case "sameName": return <FileText className="h-4 w-4 text-blue-400" />;
      case "fuzzyName": return <FileText className="h-4 w-4 text-purple-400" />;
      default: return <AlertTriangle className="h-4 w-4 text-muted" />;
    }
  };

  const reasonLabel = (reason: string) => {
    switch (reason) {
      case "sameFile": return t.duplicates.sameFile;
      case "sameSize": return t.duplicates.sameSize;
      case "sameName": return t.duplicates.sameName;
      case "fuzzyName": return locale === "en" ? "Fuzzy title match" : "模糊标题匹配";
      case "aiVerified": return locale === "en" ? "AI Verified" : "AI 确认";
      default: return reason;
    }
  };

  const reasonBadgeClass = (reason: string) => {
    switch (reason) {
      case "sameFile": return "bg-red-500/15 text-red-400 border-red-500/30";
      case "sameSize": return "bg-amber-500/15 text-amber-400 border-amber-500/30";
      case "sameName": return "bg-blue-500/15 text-blue-400 border-blue-500/30";
      case "fuzzyName": return "bg-purple-500/15 text-purple-400 border-purple-500/30";
      default: return "bg-card text-muted";
    }
  };

  const confidenceColor = (confidence: number) => {
    if (confidence >= 90) return "text-red-400";
    if (confidence >= 70) return "text-amber-400";
    if (confidence >= 50) return "text-blue-400";
    return "text-muted";
  };

  const confidenceBg = (confidence: number) => {
    if (confidence >= 90) return "bg-red-500/10";
    if (confidence >= 70) return "bg-amber-500/10";
    if (confidence >= 50) return "bg-blue-500/10";
    return "bg-card/50";
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[70] bg-black/60 animate-backdrop-in" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-2 sm:inset-4 z-[70] mx-auto my-auto flex max-h-[90vh] sm:max-h-[85vh] max-w-3xl flex-col rounded-2xl bg-background border border-border/40 shadow-2xl sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:-translate-x-1/2 sm:-translate-y-1/2 animate-modal-in">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/30 px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex items-center gap-2">
            <Copy className="h-5 w-5 text-accent" />
            <h2 className="text-lg font-semibold text-foreground">{t.duplicates.title}</h2>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-card hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-3 sm:py-4">
          {/* Initial state: show detect button */}
          {!loading && groups === null && (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/10">
                <Copy className="h-8 w-8 text-accent" />
              </div>
              <p className="mb-6 text-sm text-muted">
                {t.duplicates.title}
              </p>
              <button
                onClick={detect}
                className="rounded-xl bg-accent px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
              >
                {t.duplicates.detect}
              </button>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="mb-4 h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-accent" />
              <p className="text-sm text-muted">{t.duplicates.detecting}</p>
            </div>
          )}

          {/* No duplicates */}
          {!loading && groups !== null && groups.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/10">
                <FileCheck className="h-8 w-8 text-emerald-400" />
              </div>
              <p className="text-sm text-foreground/80">{t.duplicates.noDuplicates}</p>
            </div>
          )}

          {/* Results */}
          {!loading && filteredGroups !== null && filteredGroups.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-sm text-muted">
                  {t.duplicates.foundGroups.replace("{count}", String(groups?.length || 0))}
                </p>
                <div className="flex items-center gap-2">
                  {/* Filter by reason */}
                  {availableReasons.length > 1 && (
                    <div className="flex items-center gap-1">
                      <Filter className="h-3.5 w-3.5 text-muted" />
                      <select
                        value={filterReason}
                        onChange={(e) => setFilterReason(e.target.value)}
                        className="rounded-md border border-border/40 bg-card px-2 py-1 text-xs text-foreground outline-none"
                      >
                        <option value="all">{locale === "en" ? "All types" : "所有类型"}</option>
                        {availableReasons.map((r) => (
                          <option key={r} value={r}>{reasonLabel(r)}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <p className="text-xs text-muted/60">
                    {t.duplicates.selectToKeep}
                  </p>
                </div>
              </div>

              {filteredGroups.map((group, _fi) => {
                // Find original group index for keepSelection
                const gi = groups?.indexOf(group) ?? _fi;
                const keepId = keepSelection[gi] || group.comics[0]?.id;
                const isExpanded = expandedGroups.has(gi);
                const isComparing = compareGroupIdx === gi;
                return (
                  <div key={gi} className={`rounded-xl border overflow-hidden transition-all ${confidenceBg(group.confidence)} ${
                    group.confidence >= 90 ? "border-red-500/30" : group.confidence >= 70 ? "border-amber-500/30" : "border-border/40"
                  }`}>
                    {/* Group header */}
                    <div className="flex items-center gap-2 border-b border-border/30 px-4 py-2.5 flex-wrap">
                    {reasonIcon(group.reason)}
                      <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${reasonBadgeClass(group.reason)}`}>
                        {reasonLabel(group.reason)}
                      </span>
                      {/* Confidence badge */}
                      <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${confidenceColor(group.confidence)}`}>
                        {group.confidence}%
                      </span>
                      {/* AI 验证结果标签 */}
                      {aiResults[gi] && (
                        <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${
                          aiResults[gi].isDuplicate
                            ? "bg-red-500/15 text-red-400 border-red-500/30"
                            : "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                        }`}>
                          {aiResults[gi].isDuplicate
                            ? (locale === "en" ? "✅ AI: Duplicate" : "✅ AI: 确认重复")
                            : (locale === "en" ? "❌ AI: Not Duplicate" : "❌ AI: 非重复")}
                        </span>
                      )}
                      <span className="text-xs text-muted">
                        {group.comics.length} {t.batch.items}
                      </span>
                      {/* AI 验证理由 */}
                      {aiResults[gi]?.reason && (
                        <span className="text-[10px] text-muted/60 hidden sm:inline">
                          {aiResults[gi].reason}
                        </span>
                      )}
                      {/* Expand/collapse details button */}
                      <button
                        onClick={() => {
                          setExpandedGroups((prev) => {
                            const next = new Set(prev);
                            if (next.has(gi)) next.delete(gi); else next.add(gi);
                            return next;
                          });
                        }}
                        className="ml-auto flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] text-muted hover:text-foreground transition-colors"
                        title={locale === "en" ? "Details" : "详情"}
                      >
                        {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </button>
                    </div>

                    {/* Expanded details section */}
                    {isExpanded && (
                      <div className="border-b border-border/20 bg-background/30 px-4 py-2.5">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <p className="text-xs text-muted/70">{group.details}</p>
                          {group.comics.length >= 2 && (
                            <button
                              onClick={() => setCompareGroupIdx(isComparing ? null : gi)}
                              className={`flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition-colors ${
                                isComparing
                                  ? "bg-accent/20 text-accent"
                                  : "bg-card text-muted hover:text-foreground"
                              }`}
                            >
                              <Eye className="h-3 w-3" />
                              {locale === "en" ? "Compare Covers" : "封面对比"}
                            </button>
                          )}
                        </div>
                        {/* Cover comparison mode */}
                        {isComparing && (
                          <div className="mt-3 flex gap-3 overflow-x-auto pb-2">
                            {group.comics.map((comic) => (
                              <div key={comic.id} className="flex-shrink-0 text-center">
                                <img
                                  src={comic.coverUrl}
                                  alt={comic.title}
                                  className="h-40 w-28 rounded-lg border border-border/30 object-cover shadow-md"
                                />
                                <p className="mt-1 max-w-[7rem] truncate text-[10px] text-muted">
                                  {comic.title}
                                </p>
                                <p className="text-[10px] text-muted/50">
                                  {formatFileSize(comic.fileSize)} · {comic.format?.toUpperCase() || "?"}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Comics in group */}
                    <div className="divide-y divide-border/20">
                      {group.comics.map((comic) => {
                        const isKept = comic.id === keepId;
                        return (
                          <div
                            key={comic.id}
                            className={`flex cursor-pointer items-center gap-2.5 sm:gap-4 px-3 sm:px-4 py-2.5 sm:py-3 transition-colors ${
                              isKept
                                ? "bg-emerald-500/5 hover:bg-emerald-500/10"
                                : "hover:bg-card/80"
                            }`}
                            onClick={() => selectKeep(gi, comic.id)}
                          >
                            {/* Keep indicator / radio */}
                            <div className="flex shrink-0 items-center justify-center">
                              <div
                                className={`flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors ${
                                  isKept
                                    ? "border-emerald-400 bg-emerald-400"
                                    : "border-muted/40"
                                }`}
                              >
                {isKept && <FileCheck className="h-3 w-3 text-white" />}
                              </div>
                            </div>

                            {/* Thumbnail */}
                            <img
                              src={comic.coverUrl}
                              alt={comic.title}
                              className={`h-16 w-12 shrink-0 rounded-md bg-card object-cover transition-opacity ${
                                isKept ? "" : "opacity-60"
                              }`}
                            />

                            {/* Info */}
                            <div className="min-w-0 flex-1">
                              <p className={`truncate text-sm font-medium ${isKept ? "text-foreground" : "text-foreground/60"}`}>
                                {comic.title}
                              </p>
                              <p className="mt-0.5 truncate text-xs text-muted hidden sm:block">
                                {comic.filename}
                              </p>
                              <div className="mt-1 flex flex-wrap gap-2 sm:gap-3 text-[10px] sm:text-xs text-muted/70">
                                <span>{formatFileSize(comic.fileSize)}</span>
                                <span>{comic.pageCount}p</span>
                                {comic.format && <span className="uppercase">{comic.format}</span>}
                                {comic.author && <span className="hidden sm:inline">✍ {comic.author}</span>}
                                <span className="hidden sm:inline">{t.duplicates.addedAt}: {formatDate(comic.addedAt)}</span>
                              </div>
                            </div>

                            {/* Status */}
                            <div className="flex shrink-0 items-center gap-2">
                              {isKept ? (
                                <span className="rounded-md bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-400">
                                  {t.duplicates.keepThis}
                                </span>
                              ) : (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDeleteConfirm(comic);
                                  }}
                                  className="flex h-8 items-center gap-1.5 rounded-lg bg-red-500/10 px-3 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/20"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  {t.duplicates.deleteThis}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border/30 px-3 sm:px-6 py-2.5 sm:py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {groups !== null && groups.length > 0 && (
                <button
                  onClick={detect}
                  className="rounded-lg bg-card px-4 py-2 text-sm text-muted transition-colors hover:text-foreground"
                >
                  {t.duplicates.detect}
                </button>
              )}
              {groups !== null && groups.length > 0 && aiConfigured && (
                <button
                  onClick={handleAIVerify}
                  disabled={aiVerifying}
                  className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm transition-colors ${
                    aiVerifying
                      ? "bg-purple-500/20 text-purple-400 cursor-wait"
                      : "bg-purple-500/10 text-purple-400 hover:bg-purple-500/20"
                  }`}
                >
                  {aiVerifying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Brain className="h-3.5 w-3.5" />}
                  {aiVerifying
                    ? (locale === "en" ? "AI Verifying..." : "AI 验证中...")
                    : (locale === "en" ? "AI Verify" : "AI 验证")}
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {/* Batch delete all duplicates button */}
              {groups !== null && groups.length > 0 && toDeleteIds.length > 0 && (
                <button
                  onClick={() => setBatchDeleteConfirm(true)}
                  className="flex items-center gap-1.5 rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600"
                >
                  <Trash2 className="h-4 w-4" />
                  {t.duplicates.deleteAllDuplicates} ({toDeleteIds.length})
                </button>
              )}
              <button
                onClick={onClose}
                className="rounded-lg bg-card px-4 py-2 text-sm text-foreground transition-colors hover:bg-card-hover"
              >
                {t.duplicates.close}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Delete Single Confirm Modal */}
      {deleteConfirm && (
        <>
          <div className="fixed inset-0 z-[80] bg-black/60 animate-backdrop-in" onClick={() => setDeleteConfirm(null)} />
          <div className="fixed left-1/2 top-1/2 z-[80] w-80 -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-background border border-border/40 p-6 shadow-2xl animate-modal-in">
            <h3 className="text-lg font-semibold text-foreground">{t.duplicates.confirmDelete}</h3>
            <p className="mt-2 text-sm text-muted">
              {t.duplicates.confirmDeleteMsg.replace("{title}", deleteConfirm.title)}
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="rounded-lg bg-card px-4 py-2 text-sm text-foreground"
              >
                {t.common.cancel}
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                disabled={deleting}
                className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {deleting ? t.common.loading : t.common.delete}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Batch Delete Confirm Modal */}
      {batchDeleteConfirm && (
        <>
          <div className="fixed inset-0 z-[80] bg-black/60 animate-backdrop-in" onClick={() => !batchDeleting && setBatchDeleteConfirm(false)} />
          <div className="fixed left-1/2 top-1/2 z-[80] w-96 -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-background border border-border/40 p-6 shadow-2xl animate-modal-in">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-red-500/10">
              <AlertTriangle className="h-6 w-6 text-red-400" />
            </div>
            <h3 className="text-lg font-semibold text-foreground">{t.duplicates.confirmDeleteAll}</h3>
            <p className="mt-2 text-sm text-muted">
              {t.duplicates.confirmDeleteAllMsg.replace("{count}", String(toDeleteIds.length))}
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setBatchDeleteConfirm(false)}
                disabled={batchDeleting}
                className="rounded-lg bg-card px-4 py-2 text-sm text-foreground disabled:opacity-50"
              >
                {t.common.cancel}
              </button>
              <button
                onClick={handleBatchDelete}
                disabled={batchDeleting}
                className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {batchDeleting ? t.duplicates.deletingAll : t.common.delete}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
