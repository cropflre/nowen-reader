"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Globe, Save, FolderOpen, Image, Languages, BookOpen,
  CheckCircle, Trash2, RefreshCw, Plus, X, Search, Sparkles,
  ImagePlus, AlertCircle, ChevronRight, ChevronUp, Folder,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n";

interface SiteConfig {
  siteName: string;
  comicsDir: string;
  extraComicsDirs: string[];
  novelsDir: string;
  extraNovelsDirs: string[];
  thumbnailWidth: number;
  thumbnailHeight: number;
  pageSize: number;
  language: string;
}

interface ThumbnailStats {
  total: number;
  existing: number;
  missing: number;
}

interface BatchProgress {
  type: string;
  index?: number;
  total?: number;
  percent?: number;
  title?: string;
  comicId?: string;
  status?: string;
  success?: number;
  failed?: number;
  skipped?: number;
  source?: string;
  error?: string;
  reason?: string;
}

interface BrowseDirResponse {
  current: string;
  parent: string;
  dirs: { name: string; path: string }[];
}

// 文件夹浏览器弹窗组件
function FolderBrowser({
  open,
  onClose,
  onSelect,
  siteT,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  siteT: any;
}) {
  const [currentPath, setCurrentPath] = useState("/");
  const [dirs, setDirs] = useState<{ name: string; path: string }[]>([]);
  const [parentPath, setParentPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");

  const browseTo = useCallback(async (path: string) => {
    setLoading(true);
    setError("");
    setHint("");
    try {
      const res = await fetch(`/api/browse-dirs?path=${encodeURIComponent(path)}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || siteT?.browseError || "Cannot read directory");
        if (data.hint) setHint(data.hint);
        return;
      }
      const data: BrowseDirResponse = await res.json();
      setCurrentPath(data.current);
      setParentPath(data.parent);
      setDirs(data.dirs || []);
    } catch {
      setError(siteT?.browseError || "Cannot read directory");
    } finally {
      setLoading(false);
    }
  }, [siteT]);

  useEffect(() => {
    if (open) {
      browseTo("/");
    }
  }, [open, browseTo]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-backdrop-in" onClick={onClose}>
      <div
        className="relative w-full max-w-md mx-4 max-h-[70vh] flex flex-col rounded-2xl border border-border bg-card shadow-2xl animate-modal-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <FolderOpen className="h-4 w-4 text-accent" />
            <span className="text-sm font-medium text-foreground">
              {siteT?.browseDirTitle || "Select Folder"}
            </span>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-muted hover:text-foreground hover:bg-background transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 当前路径 */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-2 bg-background/50">
          <span className="text-[11px] text-muted shrink-0">{siteT?.currentPath || "Current path"}:</span>
          <span className="text-xs font-mono text-foreground truncate flex-1" title={currentPath}>{currentPath}</span>
        </div>

        {/* 目录列表 */}
        <div className="flex-1 overflow-y-auto min-h-0 max-h-[40vh]">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-xs text-muted">
              <RefreshCw className="h-4 w-4 animate-spin mr-2" />
              Loading...
            </div>
          ) : error ? (
            <div className="flex flex-col items-center gap-3 py-6 px-4">
              <div className="flex items-center gap-2 text-xs text-red-400">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
              </div>
              {hint && (
                <div className="w-full rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 px-3 py-2.5">
                  <div className="text-[11px] font-semibold text-amber-800 dark:text-amber-300 mb-1.5">
                    {siteT?.permissionFixTitle || "💡 如何获取权限："}
                  </div>
                  <pre className="text-[10px] text-amber-700 dark:text-amber-200/90 whitespace-pre-wrap break-all leading-relaxed font-mono">{hint}</pre>
                </div>
              )}
              {parentPath && (
                <button
                  onClick={() => browseTo(parentPath)}
                  className="text-[11px] text-accent hover:underline"
                >
                  ← {siteT?.parentDir || "Parent directory"}
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {/* 上级目录 */}
              {parentPath && (
                <button
                  onClick={() => browseTo(parentPath)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-accent hover:bg-accent/5 transition-colors"
                >
                  <ChevronUp className="h-4 w-4 shrink-0" />
                  <span className="font-medium">{siteT?.parentDir || "Parent directory"} ..</span>
                </button>
              )}

              {/* 子目录列表 */}
              {dirs.length === 0 && !parentPath ? (
                <div className="py-8 text-center text-xs text-muted">
                  {siteT?.emptyDir || "No subdirectories found"}
                </div>
              ) : dirs.length === 0 ? (
                <div className="py-6 text-center text-xs text-muted">
                  {siteT?.emptyDir || "No subdirectories found"}
                </div>
              ) : (
                dirs.map((dir) => (
                  <button
                    key={dir.path}
                    onClick={() => browseTo(dir.path)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-foreground hover:bg-accent/5 transition-colors group"
                  >
                    <Folder className="h-4 w-4 shrink-0 text-accent/70" />
                    <span className="flex-1 truncate">{dir.name}</span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* 底部操作按钮 */}
        <div className="flex items-center gap-2 border-t border-border px-4 py-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted transition-colors hover:bg-background"
          >
            {/* Cancel */}
            取消
          </button>
          <button
            onClick={() => {
              onSelect(currentPath);
              onClose();
            }}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-accent/90"
          >
            <CheckCircle className="h-3.5 w-3.5" />
            {siteT?.selectDir || "Select this directory"}
          </button>
        </div>
      </div>
    </div>
  );
}

// 默认阅读模式选择组件
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function DefaultReadingModeSelect({ siteT }: { siteT: any }) {
  const [mode, setMode] = useState<string>(() => {
    try {
      const stored = localStorage.getItem("reader-options");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.infiniteScroll) return "webtoon";
        return parsed.mode || "single";
      }
    } catch {}
    return "single";
  });

  const handleChange = (newMode: string) => {
    setMode(newMode);
    try {
      const stored = localStorage.getItem("reader-options");
      const opts = stored ? JSON.parse(stored) : {};
      opts.mode = newMode === "webtoon" ? "single" : newMode;
      opts.infiniteScroll = newMode === "webtoon";
      localStorage.setItem("reader-options", JSON.stringify(opts));
    } catch {}
  };

  return (
    <div className="space-y-3 rounded-xl bg-background p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-foreground">
        <BookOpen className="h-3.5 w-3.5 text-accent" />
        {siteT?.defaultReadingMode || "Default Reading Mode"}
      </div>
      <select
        value={mode}
        onChange={(e) => handleChange(e.target.value)}
        className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-accent/50 transition-colors"
      >
        <option value="single">{siteT?.modeSingle || "Single Page"}</option>
        <option value="double">{siteT?.modeDouble || "Double Page"}</option>
        <option value="webtoon">{siteT?.modeWebtoon || "Webtoon Scroll"}</option>
      </select>
      <p className="text-[11px] text-muted">
        {siteT?.defaultReadingModeDesc || "Default page turning mode when entering the comic reader"}
      </p>
    </div>
  );
}

export function SiteSettingsPanel() {
  const t = useTranslation();
  const [config, setConfig] = useState<SiteConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Cache states
  const [clearingThumbnails, setClearingThumbnails] = useState(false);
  const [clearingSearch, setClearingSearch] = useState(false);

  // Thumbnail states
  const [thumbStats, setThumbStats] = useState<ThumbnailStats | null>(null);
  const [generatingThumbs, setGeneratingThumbs] = useState(false);
  const [regeneratingThumbs, setRegeneratingThumbs] = useState(false);
  const [thumbResult, setThumbResult] = useState<string | null>(null);

  // Batch metadata states
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);
  const [batchDone, setBatchDone] = useState<BatchProgress | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Batch translate metadata states
  const [translateRunning, setTranslateRunning] = useState(false);
  const [translateProgress, setTranslateProgress] = useState<BatchProgress | null>(null);
  const [translateDone, setTranslateDone] = useState<BatchProgress | null>(null);
  const translateAbortRef = useRef<AbortController | null>(null);
  const [batchTranslateEngine, setBatchTranslateEngine] = useState("");
  const [availableEngines, setAvailableEngines] = useState<{id: string; name: string; available: boolean; speed: string; quality: string; configured: boolean}[]>([]);

  // New dir input
  const [newDir, setNewDir] = useState("");
  const [newNovelDir, setNewNovelDir] = useState("");

  // Folder browser states
  const [browseOpen, setBrowseOpen] = useState(false);
  const [browseTarget, setBrowseTarget] = useState<"primary" | "extra" | "novelPrimary" | "novelExtra">("extra");

  // Cleanup invalid comics states
  const [cleaningUp, setCleaningUp] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/site-settings")
      .then((r) => r.json())
      .then((data) => {
        setConfig({ extraComicsDirs: [], extraNovelsDirs: [], ...data });
        setLoading(false);
      })
      .catch(() => setLoading(false));
    loadThumbStats();
  }, []);

  const loadThumbStats = () => {
    fetch("/api/thumbnails/manage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "stats" }),
    })
      .then((r) => r.json())
      .then(setThumbStats)
      .catch(() => {});
  };

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/site-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } finally {
      setSaving(false);
    }
  };

  const update = (key: keyof SiteConfig, value: string | number | string[]) => {
    if (!config) return;
    setConfig({ ...config, [key]: value });
    setSaved(false);
  };

  const addExtraDir = () => {
    if (!config || !newDir.trim()) return;
    if (config.extraComicsDirs.includes(newDir.trim())) return;
    update("extraComicsDirs", [...config.extraComicsDirs, newDir.trim()]);
    setNewDir("");
  };

  const removeExtraDir = (idx: number) => {
    if (!config) return;
    update("extraComicsDirs", config.extraComicsDirs.filter((_, i) => i !== idx));
  };

  const addExtraNovelDir = () => {
    if (!config || !newNovelDir.trim()) return;
    if (config.extraNovelsDirs.includes(newNovelDir.trim())) return;
    update("extraNovelsDirs", [...config.extraNovelsDirs, newNovelDir.trim()]);
    setNewNovelDir("");
  };

  const removeExtraNovelDir = (idx: number) => {
    if (!config) return;
    update("extraNovelsDirs", config.extraNovelsDirs.filter((_, i) => i !== idx));
  };

  const handleClearCache = async (action: string, setLoading: (v: boolean) => void) => {
    setLoading(true);
    try {
      await fetch("/api/cache", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (action === "clear-thumbnails") loadThumbStats();
    } finally {
      setLoading(false);
    }
  };

  const handleThumbAction = async (action: string) => {
    const setter = action === "generate-missing" ? setGeneratingThumbs : setRegeneratingThumbs;
    setter(true);
    setThumbResult(null);
    try {
      const res = await fetch("/api/thumbnails/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (action === "generate-missing") {
        setThumbResult(siteT?.thumbGenerated?.replace("{count}", String(data.generated)) || `Generated ${data.generated} thumbnails`);
      } else {
        setThumbResult(siteT?.thumbRegenerated?.replace("{count}", String(data.generated)) || `Regenerated ${data.generated} thumbnails`);
      }
      loadThumbStats();
    } finally {
      setter(false);
    }
  };

  const startBatchMetadata = useCallback(async (mode: "all" | "missing") => {
    setBatchRunning(true);
    setBatchProgress(null);
    setBatchDone(null);
    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const res = await fetch("/api/metadata/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang: config?.language === "auto" ? undefined : config?.language, mode }),
        signal: abort.signal,
      });

      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "done") {
              setBatchDone(data);
            } else {
              setBatchProgress(data);
            }
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setBatchDone({ type: "done", success: 0, failed: 0, skipped: 0, total: 0 });
      }
    } finally {
      setBatchRunning(false);
      abortRef.current = null;
    }
  }, [config?.language]);

  const cancelBatch = () => {
    abortRef.current?.abort();
    setBatchRunning(false);
  };

  const startBatchTranslate = useCallback(async () => {
    setTranslateRunning(true);
    setTranslateProgress(null);
    setTranslateDone(null);
    const abort = new AbortController();
    translateAbortRef.current = abort;

    try {
      const lang = config?.language === "auto" ? (navigator.language.startsWith("zh") ? "zh-CN" : "en") : config?.language;
      const res = await fetch("/api/metadata/translate-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetLang: lang, engine: batchTranslateEngine || undefined }),
        signal: abort.signal,
      });

      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "done") {
              setTranslateDone(data);
            } else {
              setTranslateProgress(data);
            }
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setTranslateDone({ type: "done", success: 0, failed: 0, skipped: 0, total: 0 });
      }
    } finally {
      setTranslateRunning(false);
      translateAbortRef.current = null;
    }
  }, [config?.language, batchTranslateEngine]);

  // 加载可用翻译引擎
  useEffect(() => {
    fetch("/api/translate/engines")
      .then(r => r.json())
      .then(data => {
        if (data.engines) setAvailableEngines(data.engines);
      })
      .catch(() => {});
  }, []);

  const cancelTranslate = () => {
    translateAbortRef.current?.abort();
    setTranslateRunning(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted text-sm">
        {t.common.loading}
      </div>
    );
  }

  if (!config) return null;

  const siteT = t.siteSettings;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Globe className="h-5 w-5 text-accent" />
        <h3 className="text-sm font-medium text-foreground">
          {siteT?.title || "Site Settings"}
        </h3>
      </div>

      {/* Site Name */}
      <div className="space-y-3 rounded-xl bg-background p-4">
        <div className="flex items-center gap-2 text-xs font-medium text-foreground">
          <Globe className="h-3.5 w-3.5 text-accent" />
          {siteT?.siteName || "Site Name"}
        </div>
        <input
          type="text"
          value={config.siteName}
          onChange={(e) => update("siteName", e.target.value)}
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-accent/50 transition-colors"
          placeholder="NowenReader"
        />
        <p className="text-[11px] text-muted">
          {siteT?.siteNameDesc || "Display name shown in the browser title bar"}
        </p>
      </div>

      {/* Comics Directories */}
      <div className="space-y-3 rounded-xl bg-background p-4">
        <div className="flex items-center gap-2 text-xs font-medium text-foreground">
          <FolderOpen className="h-3.5 w-3.5 text-accent" />
          {siteT?.comicsDir || "Comics Directory"}
        </div>
        <p className="text-[11px] text-muted">
          {siteT?.comicsDirsMergedDesc || "All directories will be scanned for comics. The first directory is the primary one (used for uploads). Requires restart to take effect."}
        </p>

        {/* Primary dir */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={config.comicsDir}
              onChange={(e) => update("comicsDir", e.target.value)}
              className="w-full rounded-lg border border-accent/40 bg-card px-3 py-1.5 text-sm text-foreground font-mono outline-none focus:border-accent/50 transition-colors pr-14"
              placeholder="/path/to/comics"
            />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent">
              {siteT?.primaryDir || "Primary"}
            </span>
          </div>
          <button
            onClick={() => { setBrowseTarget("primary"); setBrowseOpen(true); }}
            className="shrink-0 rounded-lg bg-accent/15 p-1.5 text-accent hover:bg-accent/25 transition-colors"
            title={siteT?.browseDir || "Browse"}
          >
            <FolderOpen className="h-4 w-4" />
          </button>
        </div>

        {/* Extra dirs */}
        {config.extraComicsDirs.map((dir, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <div className="flex-1 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground font-mono truncate">
              {dir}
            </div>
            <button
              onClick={() => removeExtraDir(idx)}
              className="shrink-0 rounded-lg p-1.5 text-muted hover:text-red-400 hover:bg-red-400/10 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}

        {/* Add new dir */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newDir}
            onChange={(e) => setNewDir(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addExtraDir()}
            className="flex-1 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground font-mono outline-none focus:border-accent/50 transition-colors"
            placeholder={siteT?.extraDirPlaceholder || "/mnt/nas/comics or /data/manga"}
          />
          <button
            onClick={() => { setBrowseTarget("extra"); setBrowseOpen(true); }}
            className="shrink-0 rounded-lg bg-accent/15 p-1.5 text-accent hover:bg-accent/25 transition-colors"
            title={siteT?.browseDir || "Browse"}
          >
            <FolderOpen className="h-4 w-4" />
          </button>
          <button
            onClick={addExtraDir}
            disabled={!newDir.trim()}
            className="shrink-0 rounded-lg bg-accent/15 p-1.5 text-accent hover:bg-accent/25 transition-colors disabled:opacity-30"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Folder Browser Modal */}
      <FolderBrowser
        open={browseOpen}
        onClose={() => setBrowseOpen(false)}
        onSelect={(path) => {
          if (browseTarget === "primary") {
            update("comicsDir", path);
          } else if (browseTarget === "extra") {
            if (!config.extraComicsDirs.includes(path)) {
              update("extraComicsDirs", [...config.extraComicsDirs, path]);
            }
          } else if (browseTarget === "novelPrimary") {
            update("novelsDir", path);
          } else if (browseTarget === "novelExtra") {
            if (!config.extraNovelsDirs.includes(path)) {
              update("extraNovelsDirs", [...config.extraNovelsDirs, path]);
            }
          }
        }}
        siteT={siteT}
      />

      {/* Novels/Ebooks Directories */}
      <div className="space-y-3 rounded-xl bg-background p-4">
        <div className="flex items-center gap-2 text-xs font-medium text-foreground">
          <BookOpen className="h-3.5 w-3.5 text-accent" />
          {siteT?.novelsDir || "电子书目录"}
        </div>
        <p className="text-[11px] text-muted">
          {siteT?.novelsDirDesc || "独立的电子书文件存放路径，与漫画目录分离管理。支持 EPUB/MOBI/AZW3/TXT 等格式，修改后需重启生效"}
        </p>

        {/* Primary novels dir */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={config.novelsDir}
              onChange={(e) => update("novelsDir", e.target.value)}
              className="w-full rounded-lg border border-accent/40 bg-card px-3 py-1.5 text-sm text-foreground font-mono outline-none focus:border-accent/50 transition-colors pr-14"
              placeholder="/path/to/novels"
            />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent">
              {siteT?.primaryDir || "Primary"}
            </span>
          </div>
          <button
            onClick={() => { setBrowseTarget("novelPrimary"); setBrowseOpen(true); }}
            className="shrink-0 rounded-lg bg-accent/15 p-1.5 text-accent hover:bg-accent/25 transition-colors"
            title={siteT?.browseDir || "Browse"}
          >
            <FolderOpen className="h-4 w-4" />
          </button>
        </div>

        {/* Extra novels dirs */}
        {config.extraNovelsDirs.map((dir, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <div className="flex-1 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground font-mono truncate">
              {dir}
            </div>
            <button
              onClick={() => removeExtraNovelDir(idx)}
              className="shrink-0 rounded-lg p-1.5 text-muted hover:text-red-400 hover:bg-red-400/10 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}

        {/* Add new novel dir */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newNovelDir}
            onChange={(e) => setNewNovelDir(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addExtraNovelDir()}
            className="flex-1 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground font-mono outline-none focus:border-accent/50 transition-colors"
            placeholder={siteT?.extraNovelDirPlaceholder || "/mnt/nas/ebooks 或 /data/novels"}
          />
          <button
            onClick={() => { setBrowseTarget("novelExtra"); setBrowseOpen(true); }}
            className="shrink-0 rounded-lg bg-accent/15 p-1.5 text-accent hover:bg-accent/25 transition-colors"
            title={siteT?.browseDir || "Browse"}
          >
            <FolderOpen className="h-4 w-4" />
          </button>
          <button
            onClick={addExtraNovelDir}
            disabled={!newNovelDir.trim()}
            className="shrink-0 rounded-lg bg-accent/15 p-1.5 text-accent hover:bg-accent/25 transition-colors disabled:opacity-30"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Thumbnail Size */}
      <div className="space-y-3 rounded-xl bg-background p-4">
        <div className="flex items-center gap-2 text-xs font-medium text-foreground">
          <Image className="h-3.5 w-3.5 text-accent" />
          {siteT?.thumbnailSize || "Thumbnail Size"}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <label className="text-[11px] text-muted mb-1 block">{siteT?.width || "Width"}</label>
            <input
              type="number"
              value={config.thumbnailWidth}
              onChange={(e) => update("thumbnailWidth", parseInt(e.target.value) || 400)}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-accent/50 transition-colors"
              min={100}
              max={1200}
            />
          </div>
          <span className="text-muted mt-5">&times;</span>
          <div className="flex-1">
            <label className="text-[11px] text-muted mb-1 block">{siteT?.height || "Height"}</label>
            <input
              type="number"
              value={config.thumbnailHeight}
              onChange={(e) => update("thumbnailHeight", parseInt(e.target.value) || 560)}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-accent/50 transition-colors"
              min={100}
              max={1600}
            />
          </div>
        </div>
        <p className="text-[11px] text-muted">
          {siteT?.thumbnailDesc || "Cover thumbnail dimensions in pixels. Clear thumbnail cache after changing."}
        </p>
      </div>

      {/* Thumbnail Management */}
      <div className="space-y-3 rounded-xl bg-background p-4">
        <div className="flex items-center gap-2 text-xs font-medium text-foreground">
          <ImagePlus className="h-3.5 w-3.5 text-accent" />
          {siteT?.thumbManage || "Thumbnail Management"}
        </div>

        {/* Stats */}
        {thumbStats && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
            <span className="text-muted">
              {siteT?.thumbTotal || "Total"}: <span className="text-foreground font-medium">{thumbStats.total}</span>
            </span>
            <span className="text-muted">
              {siteT?.thumbExisting || "Cached"}: <span className="text-green-400 font-medium">{thumbStats.existing}</span>
            </span>
            <span className="text-muted">
              {siteT?.thumbMissing || "Missing"}: <span className={`font-medium ${thumbStats.missing > 0 ? "text-amber-400" : "text-green-400"}`}>{thumbStats.missing}</span>
            </span>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <button
            onClick={() => handleThumbAction("generate-missing")}
            disabled={generatingThumbs || regeneratingThumbs}
            className="flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-card-hover disabled:opacity-50"
          >
            {generatingThumbs ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ImagePlus className="h-3.5 w-3.5" />
            )}
            {siteT?.thumbGenerateMissing || "Generate Missing Thumbnails"}
          </button>
          <button
            onClick={() => handleThumbAction("regenerate-all")}
            disabled={generatingThumbs || regeneratingThumbs}
            className="flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-card-hover disabled:opacity-50"
          >
            {regeneratingThumbs ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {siteT?.thumbRegenerateAll || "Regenerate All Thumbnails"}
          </button>
        </div>

        {thumbResult && (
          <div className="flex items-center gap-2 text-[11px] text-green-400">
            <CheckCircle className="h-3.5 w-3.5" />
            {thumbResult}
          </div>
        )}
      </div>

      {/* Cache Management */}
      <div className="space-y-3 rounded-xl bg-background p-4">
        <div className="flex items-center gap-2 text-xs font-medium text-foreground">
          <Trash2 className="h-3.5 w-3.5 text-accent" />
          {siteT?.cacheManage || "Cache Management"}
        </div>

        <div className="flex flex-col gap-2">
          <button
            onClick={() => handleClearCache("clear-thumbnails", setClearingThumbnails)}
            disabled={clearingThumbnails}
            className="flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-card-hover disabled:opacity-50"
          >
            {clearingThumbnails ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Image className="h-3.5 w-3.5" />
            )}
            {siteT?.clearThumbnails || "Clear Thumbnail Cache"}
          </button>

          <button
            onClick={() => handleClearCache("clear-search", setClearingSearch)}
            disabled={clearingSearch}
            className="flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-card-hover disabled:opacity-50"
          >
            {clearingSearch ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Search className="h-3.5 w-3.5" />
            )}
            {siteT?.clearSearch || "Reset Search Cache"}
          </button>
        </div>

        <p className="text-[11px] text-muted">
          {siteT?.cacheDesc || "Clear cached data to free disk space or fix display issues"}
        </p>
      </div>

      {/* Cleanup Invalid Comics */}
      <div className="space-y-3 rounded-xl bg-background p-4">
        <div className="flex items-center gap-2 text-xs font-medium text-foreground">
          <AlertCircle className="h-3.5 w-3.5 text-accent" />
          {siteT?.cleanupInvalid || "Cleanup Invalid Comics"}
        </div>
        <p className="text-[11px] text-muted">
          {siteT?.cleanupInvalidDesc || "Remove database records whose source files no longer exist on disk, fixing 404/500 errors"}
        </p>

        {!cleaningUp && cleanupResult === null && (
          <button
            onClick={async () => {
              setCleaningUp(true);
              setCleanupResult(null);
              try {
                const res = await fetch("/api/comics/cleanup", { method: "POST" });
                const data = await res.json();
                if (res.ok) {
                  setCleanupResult(data.removed ?? 0);
                }
              } catch { /* ignore */ } finally {
                setCleaningUp(false);
              }
            }}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-amber-500/30 bg-card px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-amber-500/10"
          >
            <AlertCircle className="h-3.5 w-3.5 text-amber-400" />
            {siteT?.cleanupInvalidBtn || "Scan & Cleanup"}
          </button>
        )}

        {cleaningUp && (
          <div className="flex items-center justify-center gap-2 py-2 text-xs text-muted">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            {siteT?.cleanupRunning || "Scanning..."}
          </div>
        )}

        {cleanupResult !== null && !cleaningUp && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-[11px]">
              <CheckCircle className="h-3.5 w-3.5 text-green-400" />
              <span className="text-green-400">
                {(siteT?.cleanupDone || "Cleanup complete: removed {count} invalid comics").replace("{count}", String(cleanupResult))}
              </span>
            </div>
            <button
              onClick={() => setCleanupResult(null)}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:bg-card-hover"
            >
              {t.common?.close || "Close"}
            </button>
          </div>
        )}
      </div>

      {/* Batch AI Metadata */}
      <div className="space-y-3 rounded-xl bg-background p-4">
        <div className="flex items-center gap-2 text-xs font-medium text-foreground">
          <Sparkles className="h-3.5 w-3.5 text-accent" />
          {siteT?.batchMetadata || "Batch Metadata Fetch"}
        </div>
        <p className="text-[11px] text-muted">
          {siteT?.batchMetadataDesc || "Automatically fetch metadata for all comics from online sources (AniList, Bangumi, etc.)"}
        </p>

        {!batchRunning && !batchDone && (
          <div className="flex flex-col gap-2">
            <button
              onClick={() => startBatchMetadata("missing")}
              className="flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-card-hover"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {siteT?.batchMissing || "Fetch Missing Metadata Only"}
            </button>
            <button
              onClick={() => startBatchMetadata("all")}
              className="flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-card-hover"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {siteT?.batchAll || "Re-fetch All Metadata"}
            </button>
          </div>
        )}

        {/* Progress */}
        {batchRunning && batchProgress && (
          <div className="space-y-2">
            {/* Progress bar */}
            <div className="relative h-2 w-full rounded-full bg-border overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-accent transition-all duration-300"
                style={{ width: `${batchProgress.percent || 0}%` }}
              />
            </div>
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="text-muted truncate min-w-0 flex-1">
                {batchProgress.title || batchProgress.comicId}
              </span>
              <span className="text-foreground font-medium shrink-0 text-right">
                {(batchProgress.index ?? 0) + 1}/{batchProgress.total} ({batchProgress.percent}%)
              </span>
            </div>
            <button
              onClick={cancelBatch}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs text-red-400 transition-colors hover:bg-red-400/10"
            >
              <X className="h-3.5 w-3.5" />
              {t.common?.cancel || "Cancel"}
            </button>
          </div>
        )}

        {/* Done */}
        {batchDone && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-green-400">
              <CheckCircle className="h-4 w-4" />
              {siteT?.batchComplete || "Batch metadata fetch complete"}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
              <span className="text-green-400">
                {siteT?.batchSuccess || "Success"}: {batchDone.success}
              </span>
              {(batchDone.failed ?? 0) > 0 && (
                <span className="text-red-400">
                  {siteT?.batchFailed || "Failed"}: {batchDone.failed}
                </span>
              )}
              {(batchDone.skipped ?? 0) > 0 && (
                <span className="text-muted">
                  {siteT?.batchSkipped || "Skipped"}: {batchDone.skipped}
                </span>
              )}
            </div>
            <button
              onClick={() => setBatchDone(null)}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:bg-card-hover"
            >
              {t.common?.close || "Close"}
            </button>
          </div>
        )}
      </div>

      {/* Batch Translate Metadata */}
      <div className="space-y-3 rounded-xl bg-background p-4">
        <div className="flex items-center gap-2 text-xs font-medium text-foreground">
          <Languages className="h-3.5 w-3.5 text-accent" />
          {siteT?.batchTranslateMetadata || "Batch Translate Metadata"}
        </div>
        <p className="text-[11px] text-muted">
            {siteT?.batchTranslateMetadataDesc || "Translate all comic metadata (title, description, genre) to the current language"}
        </p>

        {/* 翻译引擎选择器 */}
        {!translateRunning && !translateDone && availableEngines.length > 0 && (
          <div className="space-y-1.5">
            <label className="text-[10px] font-medium text-muted">翻译引擎</label>
            <select
              value={batchTranslateEngine}
              onChange={e => setBatchTranslateEngine(e.target.value)}
              className="w-full rounded-lg border border-border bg-card px-2 py-1.5 text-xs text-foreground"
            >
              <option value="">自动选择最优引擎</option>
              {availableEngines.filter(e => e.available).map(eng => (
                <option key={eng.id} value={eng.id}>
                  {eng.name} ({eng.speed === 'instant' ? '极快' : eng.speed === 'fast' ? '快' : '慢'})
                </option>
              ))}
            </select>
          </div>
        )}

        {!translateRunning && !translateDone && (
          <button
            onClick={startBatchTranslate}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-card-hover"
          >
            <Languages className="h-3.5 w-3.5" />
            {siteT?.startBatchTranslate || "Start Translating"}
          </button>
        )}

        {/* Progress */}
        {translateRunning && translateProgress && (
          <div className="space-y-2">
            <div className="relative h-2 w-full rounded-full bg-border overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-accent transition-all duration-300"
                style={{ width: `${translateProgress.percent || 0}%` }}
              />
            </div>
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="text-muted truncate min-w-0 flex-1">
                {translateProgress.title}
              </span>
              <span className="text-foreground font-medium shrink-0 text-right">
                {(translateProgress.index ?? 0) + 1}/{translateProgress.total} ({translateProgress.percent}%)
              </span>
            </div>
            <button
              onClick={cancelTranslate}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs text-red-400 transition-colors hover:bg-red-400/10"
            >
              <X className="h-3.5 w-3.5" />
              {t.common?.cancel || "Cancel"}
            </button>
          </div>
        )}

        {/* Done */}
        {translateDone && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-green-400">
              <CheckCircle className="h-4 w-4" />
              {siteT?.batchTranslateComplete || "Batch translation complete"}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
              <span className="text-green-400">
                {siteT?.batchSuccess || "Success"}: {translateDone.success}
              </span>
              {(translateDone.failed ?? 0) > 0 && (
                <span className="text-red-400">
                  {siteT?.batchFailed || "Failed"}: {translateDone.failed}
                </span>
              )}
              {(translateDone.skipped ?? 0) > 0 && (
                <span className="text-muted">
                  {siteT?.batchSkipped || "Skipped"}: {translateDone.skipped}
                </span>
              )}
            </div>
            <button
              onClick={() => setTranslateDone(null)}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:bg-card-hover"
            >
              {t.common?.close || "Close"}
            </button>
          </div>
        )}
      </div>

      {/* Default Reading Mode */}
      <DefaultReadingModeSelect siteT={siteT} />

      {/* Language */}
      <div className="space-y-3 rounded-xl bg-background p-4">
        <div className="flex items-center gap-2 text-xs font-medium text-foreground">
          <Languages className="h-3.5 w-3.5 text-accent" />
          {siteT?.language || "Language"}
        </div>
        <select
          value={config.language}
          onChange={(e) => update("language", e.target.value)}
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-accent/50 transition-colors"
        >
          <option value="auto">{siteT?.langAuto || "Auto Detect"}</option>
          <option value="zh-CN">中文</option>
          <option value="en">English</option>
        </select>
      </div>


      {/* Save Button */}
      <button
        onClick={handleSave}
        disabled={saving}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-xs font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
      >
        {saved ? (
          <>
            <CheckCircle className="h-4 w-4" />
            {siteT?.saved || "Saved"}
          </>
        ) : saving ? (
          <>{t.common.loading}</>
        ) : (
          <>
            <Save className="h-4 w-4" />
            {t.common.save}
          </>
        )}
      </button>

      <p className="text-center text-[11px] text-muted">
        {siteT?.restartHint || "Some settings require a restart to take effect"}
      </p>
    </div>
  );
}
