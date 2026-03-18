"use client";

import { useState, useCallback, useMemo } from "react";
import { X, Copy, Trash2, AlertTriangle, FileCheck, FileText } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

interface DuplicateComic {
  id: string;
  filename: string;
  title: string;
  fileSize: number;
  pageCount: number;
  addedAt: string;
  coverUrl: string;
}

interface DuplicateGroup {
  reason: string;
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
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<DuplicateComic | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Track which comic to keep per group (key: group index, value: comic id)
  const [keepSelection, setKeepSelection] = useState<Record<number, string>>({});
  // Batch delete all duplicates
  const [batchDeleteConfirm, setBatchDeleteConfirm] = useState(false);
  const [batchDeleting, setBatchDeleting] = useState(false);

  const detect = useCallback(async () => {
    setLoading(true);
    setGroups(null);
    setKeepSelection({});
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
      default: return <AlertTriangle className="h-4 w-4 text-muted" />;
    }
  };

  const reasonLabel = (reason: string) => {
    switch (reason) {
      case "sameFile": return t.duplicates.sameFile;
      case "sameSize": return t.duplicates.sameSize;
      case "sameName": return t.duplicates.sameName;
      default: return reason;
    }
  };

  const reasonBadgeClass = (reason: string) => {
    switch (reason) {
      case "sameFile": return "bg-red-500/15 text-red-400 border-red-500/30";
      case "sameSize": return "bg-amber-500/15 text-amber-400 border-amber-500/30";
      case "sameName": return "bg-blue-500/15 text-blue-400 border-blue-500/30";
      default: return "bg-card text-muted";
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[70] bg-black/60" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-2 sm:inset-4 z-[70] mx-auto my-auto flex max-h-[90vh] sm:max-h-[85vh] max-w-3xl flex-col rounded-2xl bg-background border border-border/40 shadow-2xl sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:-translate-x-1/2 sm:-translate-y-1/2">
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
          {!loading && groups !== null && groups.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted">
                  {t.duplicates.foundGroups.replace("{count}", String(groups.length))}
                </p>
                <p className="text-xs text-muted/60">
                  {t.duplicates.selectToKeep}
                </p>
              </div>

              {groups.map((group, gi) => {
                const keepId = keepSelection[gi] || group.comics[0]?.id;
                return (
                  <div key={gi} className="rounded-xl border border-border/40 bg-card/50 overflow-hidden">
                    {/* Group header */}
                    <div className="flex items-center gap-2 border-b border-border/30 px-4 py-2.5">
                      {reasonIcon(group.reason)}
                      <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${reasonBadgeClass(group.reason)}`}>
                        {reasonLabel(group.reason)}
                      </span>
                      <span className="text-xs text-muted">
                        {group.comics.length} {t.batch.items}
                      </span>
                    </div>

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
          <div className="fixed inset-0 z-[80] bg-black/60" onClick={() => setDeleteConfirm(null)} />
          <div className="fixed left-1/2 top-1/2 z-[80] w-80 -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-background border border-border/40 p-6 shadow-2xl">
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
          <div className="fixed inset-0 z-[80] bg-black/60" onClick={() => !batchDeleting && setBatchDeleteConfirm(false)} />
          <div className="fixed left-1/2 top-1/2 z-[80] w-96 -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-background border border-border/40 p-6 shadow-2xl">
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
