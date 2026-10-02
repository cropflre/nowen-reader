"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Eye, FilterX, Loader2, Save, Trash2, X } from "lucide-react";
import { apiPath } from "@/lib/base-path";

interface ExclusionSample {
  libraryId: string;
  libraryName?: string;
  relativePath: string;
  title?: string;
  kind?: "file" | "directory";
}

interface ExclusionPreview {
  pattern: string;
  existingCount: number;
  existingSamples: ExclusionSample[];
  diskMatchCount: number;
  diskSamples: ExclusionSample[];
  unavailableRoots: string[];
  matchHash: string;
}

async function readResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data as T;
}

function SampleList({ samples, total }: { samples: ExclusionSample[]; total: number }) {
  if (total === 0) return <p className="text-xs text-muted">暂无匹配项</p>;
  return (
    <div className="max-h-44 overflow-y-auto border-t border-border/40">
      {samples.map((sample, index) => (
        <div key={`${sample.libraryId}:${sample.relativePath}:${index}`} className="flex min-w-0 items-start gap-2 border-b border-border/30 py-1.5 text-xs">
          <span className="shrink-0 text-muted">{sample.libraryName || sample.libraryId}</span>
          <span className="min-w-0 break-all text-foreground" title={sample.relativePath}>{sample.relativePath}</span>
          {sample.kind === "directory" && <span className="shrink-0 text-muted">目录</span>}
        </div>
      ))}
      {total > samples.length && <p className="py-2 text-xs text-muted">仅显示前 {samples.length} 项</p>}
    </div>
  );
}

export function ScanExclusionsPanel() {
  const [pattern, setPattern] = useState("");
  const [savedPattern, setSavedPattern] = useState("");
  const [preview, setPreview] = useState<ExclusionPreview | null>(null);
  const [busy, setBusy] = useState<"load" | "save" | "preview" | "cleanup" | null>("load");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const load = useCallback(async () => {
    setBusy("load");
    setError("");
    try {
      const data = await readResponse<{ excludePathRegex: string }>(await fetch(apiPath("/api/scan-exclusions"), { credentials: "include" }));
      setPattern(data.excludePathRegex || "");
      setSavedPattern(data.excludePathRegex || "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加载失败");
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setBusy("save");
    setError("");
    setNotice("");
    try {
      const data = await readResponse<{ excludePathRegex: string }>(await fetch(apiPath("/api/scan-exclusions"), {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ excludePathRegex: pattern }),
      }));
      setPattern(data.excludePathRegex);
      setSavedPattern(data.excludePathRegex);
      setPreview(null);
      setConfirmOpen(false);
      setNotice("规则已保存，后续扫描将跳过匹配的路径。已入库作品仍保留。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setBusy(null);
    }
  };

  const runPreview = async (currentPattern = pattern) => {
    setBusy("preview");
    setError("");
    setNotice("");
    setConfirmOpen(false);
    setConfirmed(false);
    try {
      const data = await readResponse<ExclusionPreview>(await fetch(apiPath("/api/scan-exclusions/preview"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ excludePathRegex: currentPattern }),
      }));
      setPreview(data);
    } catch (cause) {
      setPreview(null);
      setError(cause instanceof Error ? cause.message : "预览失败");
    } finally {
      setBusy(null);
    }
  };

  const cleanup = async () => {
    if (!preview || !confirmed) return;
    setBusy("cleanup");
    setError("");
    try {
      const data = await readResponse<{ removed: number }>(await fetch(apiPath("/api/scan-exclusions/cleanup"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchHash: preview.matchHash, confirm: true }),
      }));
      setConfirmOpen(false);
      setConfirmed(false);
      setPreview(null);
      setNotice(`已从书库移出 ${data.removed} 项，磁盘文件未删除。`);
    } catch (cause) {
      setConfirmOpen(false);
      setError(cause instanceof Error ? cause.message : "清理失败，请重新预览");
      setPreview(null);
    } finally {
      setBusy(null);
    }
  };

  const previewCurrent = preview?.pattern === pattern.trim();
  const canCleanup = previewCurrent && preview.existingCount > 0 && savedPattern === preview.pattern;

  return (
    <section className="rounded-lg border border-border bg-card p-4 sm:p-5">
      <div className="mb-3 flex items-center gap-2">
        <FilterX className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-semibold text-foreground">扫描入库排除</h3>
      </div>
      <p className="mb-3 text-xs text-muted">独立于下方自动化开关。按书库内的相对路径匹配；匹配目录时会跳过整个目录。保存后只阻止新入库，已有作品需单独确认清理。</p>
      <label htmlFor="scan-exclude-path" className="mb-1.5 block text-xs font-medium text-foreground">路径排除正则</label>
      <input
        id="scan-exclude-path"
        type="text"
        value={pattern}
        onChange={(event) => { setPattern(event.target.value); setPreview(null); setNotice(""); }}
        placeholder="例如：(?i)(^|/)(\.[^/]*|thumbs?)(/|$)"
        spellCheck={false}
        disabled={busy === "load"}
        className="h-10 w-full rounded-md border border-border bg-background px-3 font-mono text-sm text-foreground outline-none focus:border-accent"
      />
      <p className="mt-1.5 text-xs text-muted">规则过宽可能跳过正常书籍。建议先预览，再保存。</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void runPreview()} disabled={!!busy} className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-xs font-medium text-foreground hover:bg-card-hover disabled:opacity-50">
          {busy === "preview" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}预览匹配
        </button>
        <button type="button" onClick={() => void save()} disabled={!!busy || pattern.trim() === savedPattern} className="inline-flex h-9 items-center gap-2 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50">
          {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}保存规则
        </button>
        {busy === "load" && <span className="text-xs text-muted">加载中...</span>}
      </div>
      {error && <p role="alert" className="mt-3 text-xs text-red-500">{error}</p>}
      {notice && <p role="status" className="mt-3 text-xs text-emerald-600 dark:text-emerald-400">{notice}</p>}

      {previewCurrent && preview && (
        <div className="mt-4 space-y-4 border-t border-border/50 pt-4">
          <div>
            <h4 className="mb-2 text-xs font-semibold text-foreground">磁盘上将被跳过的路径：{preview.diskMatchCount} 项</h4>
            <p className="mb-2 text-xs text-muted">匹配目录按一项统计，目录内文件不再逐个列出。</p>
            <SampleList samples={preview.diskSamples} total={preview.diskMatchCount} />
          </div>
          <div>
            <h4 className="mb-2 text-xs font-semibold text-foreground">已经入库的匹配项：{preview.existingCount} 项</h4>
            <SampleList samples={preview.existingSamples} total={preview.existingCount} />
          </div>
          {preview.unavailableRoots.length > 0 && (
            <p className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400"><AlertTriangle className="h-4 w-4 shrink-0" />{preview.unavailableRoots.length} 个书库目录未能检查，磁盘预览可能不完整。</p>
          )}
          {preview.existingCount > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => { setConfirmed(false); setConfirmOpen(true); }} disabled={!canCleanup || !!busy} className="inline-flex h-9 items-center gap-2 rounded-md border border-red-500/50 px-3 text-xs font-medium text-red-600 hover:bg-red-500/10 disabled:opacity-50">
                <Trash2 className="h-4 w-4" />清理已入库匹配项
              </button>
              {!canCleanup && <span className="text-xs text-muted">先保存当前规则，再重新预览即可清理。</span>}
            </div>
          )}
        </div>
      )}

      {confirmOpen && preview && createPortal(
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && busy !== "cleanup") setConfirmOpen(false); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="scan-exclude-confirm-title" className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-lg border border-border bg-card p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <h3 id="scan-exclude-confirm-title" className="text-sm font-semibold text-foreground">从书库移出 {preview.existingCount} 项？</h3>
              <button type="button" onClick={() => setConfirmOpen(false)} disabled={busy === "cleanup"} className="text-muted hover:text-foreground" aria-label="关闭"><X className="h-4 w-4" /></button>
            </div>
            <p className="mt-3 text-sm text-foreground">磁盘文件会保留，但这些作品的书库记录、元数据、合集关联与阅读记录将被删除。之后移除排除规则时，文件可重新入库，原有阅读记录不会恢复。</p>
            <label className="mt-4 flex items-start gap-2 text-xs text-foreground">
              <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5 accent-accent" />
              我已确认预览结果，并了解阅读记录会被删除
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmOpen(false)} disabled={busy === "cleanup"} className="h-9 rounded-md border border-border px-3 text-xs text-foreground">取消</button>
              <button type="button" onClick={() => void cleanup()} disabled={!confirmed || !!busy} className="inline-flex h-9 items-center gap-2 rounded-md bg-red-600 px-3 text-xs font-medium text-white disabled:opacity-50">
                {busy === "cleanup" && <Loader2 className="h-4 w-4 animate-spin" />}确认移出
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </section>
  );
}
