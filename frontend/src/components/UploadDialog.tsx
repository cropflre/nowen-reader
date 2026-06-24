"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Upload,
  X,
  FileArchive,
  FileText,
  File,
  CheckCircle,
  XCircle,
  Loader2,
  CloudUpload,
  Trash2,
} from "lucide-react";
import { uploadComics } from "@/api/comics";
import { fetchLibraries, type Library } from "@/api/libraries";

// ============================================================
// Types
// ============================================================

interface QueueItem {
  id: string;
  file: File;
  status: "waiting" | "uploading" | "success" | "failed";
  error?: string;
}

interface UploadDialogProps {
  open: boolean;
  onClose: () => void;
  contentType?: "comic" | "novel";
  defaultLibraryId?: string;
  onUploaded?: () => void;
}

// ============================================================
// Helpers
// ============================================================

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(1) + " GB";
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + " KB";
  return bytes + " B";
}

function fileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["zip", "cbz", "cbr", "rar", "7z"].includes(ext)) return <FileArchive className="h-4 w-4 text-amber-500" />;
  if (["pdf", "epub", "mobi"].includes(ext)) return <FileText className="h-4 w-4 text-blue-500" />;
  return <File className="h-4 w-4 text-muted" />;
}

let nextId = 0;
function makeId() {
  return `q-${++nextId}-${Date.now()}`;
}

// ============================================================
// Component
// ============================================================

export default function UploadDialog({
  open,
  onClose,
  contentType = "comic",
  defaultLibraryId = "",
  onUploaded,
}: UploadDialogProps) {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [selectedLibraryId, setSelectedLibraryId] = useState(defaultLibraryId);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  // Sync default when opened
  useEffect(() => {
    if (open) {
      setSelectedLibraryId(defaultLibraryId);
      setQueue([]);
      setUploading(false);
    }
  }, [open, defaultLibraryId]);

  // Load libraries
  useEffect(() => {
    if (open) {
      fetchLibraries().then(setLibraries).catch(() => {});
    }
  }, [open]);

  // Filtered libraries
  const filteredLibs = libraries.filter(
    (lib) => lib.enabled && ((lib.rootPaths && lib.rootPaths.length > 0) || lib.rootPath) && (lib.type === "mixed" || lib.type === contentType)
  );

  // Add files to queue
  const addFiles = useCallback((files: FileList | File[]) => {
    const items: QueueItem[] = Array.from(files).map((file) => ({
      id: makeId(),
      file,
      status: "waiting" as const,
    }));
    setQueue((prev) => [...prev, ...items]);
  }, []);

  // Drag handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only deactivate if leaving the dropzone entirely
    if (dropRef.current && !dropRef.current.contains(e.relatedTarget as Node)) {
      setDragActive(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      if (e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files);
      }
    },
    [addFiles]
  );

  // Remove from queue
  const removeFromQueue = useCallback((id: string) => {
    setQueue((prev) => prev.filter((item) => item.id !== id));
  }, []);

  // Upload all
  const handleUploadAll = useCallback(async () => {
    const pending = queue.filter((item) => item.status === "waiting");
    if (pending.length === 0) return;

    setUploading(true);

    // Upload all pending files as a single batch
    const files = pending.map((item) => item.file);
    setQueue((prev) =>
      prev.map((item) => (item.status === "waiting" ? { ...item, status: "uploading" as const } : item))
    );

    try {
      const libId = selectedLibraryId || undefined;
      const result = await uploadComics(files, contentType, libId);

      if (result.success) {
        setQueue((prev) =>
          prev.map((item) =>
            item.status === "uploading"
              ? { ...item, status: "success" as const }
              : item
          )
        );
        // Trigger backend scan + refresh
        try {
          await fetch("/api/sync", { method: "POST" });
        } catch {
          // scan failure shouldn't block
        }
        onUploaded?.();
      } else {
        setQueue((prev) =>
          prev.map((item) =>
            item.status === "uploading"
              ? { ...item, status: "failed" as const, error: result.message }
              : item
          )
        );
      }
    } catch (err) {
      setQueue((prev) =>
        prev.map((item) =>
          item.status === "uploading"
            ? { ...item, status: "failed" as const, error: err instanceof Error ? err.message : "上传失败" }
            : item
        )
      );
    } finally {
      setUploading(false);
    }
  }, [queue, selectedLibraryId, contentType, onUploaded]);

  // Clear completed
  const clearCompleted = useCallback(() => {
    setQueue((prev) => prev.filter((item) => item.status === "waiting" || item.status === "uploading"));
  }, []);

  // Count
  const successCount = queue.filter((i) => i.status === "success").length;
  const failedCount = queue.filter((i) => i.status === "failed").length;
  const pendingCount = queue.filter((i) => i.status === "waiting").length;
  const uploadingCount = queue.filter((i) => i.status === "uploading").length;
  const allDone = queue.length > 0 && pendingCount === 0 && uploadingCount === 0;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
        onClick={uploading ? undefined : onClose}
      />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-lg rounded-2xl border border-border/40 bg-card/95 backdrop-blur-xl shadow-2xl transition-all animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/30 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              上传{contentType === "novel" ? "小说" : "漫画"}
            </h2>
            <p className="text-xs text-muted">支持 zip、cbz、pdf、epub 等格式</p>
          </div>
          <button
            onClick={onClose}
            disabled={uploading}
            className="rounded-lg p-1.5 text-muted hover:text-foreground hover:bg-card-hover transition-colors disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {/* Target selector */}
          {filteredLibs.length > 0 && (
            <div>
              <label className="text-xs font-medium text-muted">上传到</label>
              <select
                value={selectedLibraryId}
                onChange={(e) => setSelectedLibraryId(e.target.value)}
                disabled={uploading}
                className="mt-1 w-full rounded-xl border border-border/40 bg-background px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none disabled:opacity-50"
              >
                <option value="">{contentType === "novel" ? "默认目录（小说）" : "默认目录（漫画）"}</option>
                {filteredLibs.map((lib) => (
                  <option key={lib.id} value={lib.id}>
                    {lib.name} ({lib.type})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Dropzone */}
          <div
            ref={dropRef}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onClick={() => !uploading && fileInputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 transition-all duration-200 ${
              dragActive
                ? "border-accent bg-accent/5 shadow-lg shadow-accent/10 scale-[1.01]"
                : "border-border/40 hover:border-border/60 hover:bg-card-hover"
            }`}
          >
            <CloudUpload
              className={`mb-3 h-10 w-10 transition-transform duration-200 ${
                dragActive ? "text-accent scale-110" : "text-muted"
              }`}
            />
            <p className="text-sm font-medium text-foreground">
              拖拽文件到这里上传
            </p>
            <p className="mt-1 text-xs text-muted">或点击选择文件（支持多选）</p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".zip,.cbz,.cbr,.rar,.pdf,.epub,.mobi,.txt,.md"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = "";
              }}
              className="hidden"
            />
          </div>

          {/* Queue */}
          {queue.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted">
                  文件队列 ({queue.length})
                </span>
                {(successCount > 0 || failedCount > 0) && (
                  <button
                    onClick={clearCompleted}
                    disabled={uploading}
                    className="text-xs text-muted hover:text-foreground transition-colors disabled:opacity-50"
                  >
                    清除已完成
                  </button>
                )}
              </div>
              <div className="max-h-48 space-y-1.5 overflow-y-auto">
                {queue.map((item) => (
                  <div
                    key={item.id}
                    className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                      item.status === "success"
                        ? "bg-emerald-500/5 border border-emerald-500/20"
                        : item.status === "failed"
                        ? "bg-red-500/5 border border-red-500/20"
                        : item.status === "uploading"
                        ? "bg-accent/5 border border-accent/20"
                        : "bg-background/50 border border-border/20"
                    }`}
                  >
                    {fileIcon(item.file.name)}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-foreground">{item.file.name}</div>
                      <div className="text-[10px] text-muted">{formatFileSize(item.file.size)}</div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {item.status === "waiting" && (
                        <span className="text-[10px] text-muted">等待</span>
                      )}
                      {item.status === "uploading" && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                      )}
                      {item.status === "success" && (
                        <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
                      )}
                      {item.status === "failed" && (
                        <span className="text-[10px] text-red-500" title={item.error}>
                          失败
                        </span>
                      )}
                      {(item.status === "waiting" || item.status === "failed") && (
                        <button
                          onClick={() => removeFromQueue(item.id)}
                          className="rounded p-0.5 text-muted hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Result summary */}
          {allDone && (
            <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-400">
              上传完成：成功 {successCount} 个{failedCount > 0 ? `，失败 ${failedCount} 个` : ""}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border/30 px-5 py-3">
          <button
            onClick={onClose}
            disabled={uploading}
            className="rounded-xl px-4 py-2 text-sm text-muted hover:text-foreground hover:bg-card-hover transition-colors disabled:opacity-50"
          >
            {allDone ? "关闭" : "取消"}
          </button>
          <button
            onClick={handleUploadAll}
            disabled={uploading || pendingCount === 0}
            className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                上传中…
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                {`开始上传 (${pendingCount})`}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}