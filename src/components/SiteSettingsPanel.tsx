"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Globe, Save, FolderOpen, Image, LayoutGrid, Palette, Languages,
  CheckCircle, Trash2, RefreshCw, Plus, X, Search, Sparkles,
  HardDrive, ImagePlus, AlertCircle,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n";

interface SiteConfig {
  siteName: string;
  comicsDir: string;
  extraComicsDirs: string[];
  thumbnailWidth: number;
  thumbnailHeight: number;
  pageSize: number;
  language: string;
  theme: string;
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

  // New dir input
  const [newDir, setNewDir] = useState("");

  useEffect(() => {
    fetch("/api/site-settings")
      .then((r) => r.json())
      .then((data) => {
        setConfig({ extraComicsDirs: [], ...data });
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

      {/* Comics Directory */}
      <div className="space-y-3 rounded-xl bg-background p-4">
        <div className="flex items-center gap-2 text-xs font-medium text-foreground">
          <FolderOpen className="h-3.5 w-3.5 text-accent" />
          {siteT?.comicsDir || "Comics Directory"}
        </div>
        <input
          type="text"
          value={config.comicsDir}
          onChange={(e) => update("comicsDir", e.target.value)}
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground font-mono outline-none focus:border-accent/50 transition-colors"
          placeholder="/path/to/comics"
        />
        <p className="text-[11px] text-muted">
          {siteT?.comicsDirDesc || "Path where comic archives are stored. Requires restart to take effect."}
        </p>

        {/* Extra Directories for Docker/NAS */}
        <div className="mt-3 pt-3 border-t border-border/30">
          <div className="flex items-center gap-2 text-xs font-medium text-foreground mb-2">
            <HardDrive className="h-3.5 w-3.5 text-accent" />
            {siteT?.extraDirs || "Additional Directories (Docker/NAS)"}
          </div>
          <p className="text-[11px] text-muted mb-2">
            {siteT?.extraDirsDesc || "Mount multiple directories for Docker or NAS. All directories will be scanned for comics."}
          </p>

          {/* Existing extra dirs */}
          {config.extraComicsDirs.map((dir, idx) => (
            <div key={idx} className="flex items-center gap-2 mb-1.5">
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
          <div className="flex items-center gap-2 mt-2">
            <input
              type="text"
              value={newDir}
              onChange={(e) => setNewDir(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addExtraDir()}
              className="flex-1 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground font-mono outline-none focus:border-accent/50 transition-colors"
              placeholder={siteT?.extraDirPlaceholder || "/mnt/nas/comics or /data/manga"}
            />
            <button
              onClick={addExtraDir}
              disabled={!newDir.trim()}
              className="shrink-0 rounded-lg bg-accent/15 p-1.5 text-accent hover:bg-accent/25 transition-colors disabled:opacity-30"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
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
          <div className="flex items-center gap-4 text-[11px]">
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
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted truncate max-w-[70%]">
                {batchProgress.title || batchProgress.comicId}
              </span>
              <span className="text-foreground font-medium shrink-0">
                {(batchProgress.index ?? 0) + 1} / {batchProgress.total} ({batchProgress.percent}%)
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
            <div className="flex items-center gap-4 text-[11px]">
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

      {/* Page Size */}
      <div className="space-y-3 rounded-xl bg-background p-4">
        <div className="flex items-center gap-2 text-xs font-medium text-foreground">
          <LayoutGrid className="h-3.5 w-3.5 text-accent" />
          {siteT?.pageSize || "Items Per Page"}
        </div>
        <select
          value={config.pageSize}
          onChange={(e) => update("pageSize", parseInt(e.target.value))}
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-accent/50 transition-colors"
        >
          {[12, 24, 36, 48, 60, 96].map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        <p className="text-[11px] text-muted">
          {siteT?.pageSizeDesc || "Number of comics displayed per page on the home screen"}
        </p>
      </div>

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

      {/* Theme */}
      <div className="space-y-3 rounded-xl bg-background p-4">
        <div className="flex items-center gap-2 text-xs font-medium text-foreground">
          <Palette className="h-3.5 w-3.5 text-accent" />
          {siteT?.theme || "Theme"}
        </div>
        <select
          value={config.theme}
          onChange={(e) => update("theme", e.target.value)}
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-accent/50 transition-colors"
        >
          <option value="dark">{siteT?.themeDark || "Dark"}</option>
          <option value="light">{siteT?.themeLight || "Light"}</option>
          <option value="system">{siteT?.themeSystem || "System"}</option>
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
