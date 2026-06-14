"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import {
  Globe, Save, FolderOpen, Image, Languages, BookOpen,
  CheckCircle, Trash2, RefreshCw, Plus, X, Search, Sparkles,
  ImagePlus, AlertCircle, ChevronRight, ChevronUp, Folder,
  Database, BookMarked,
  Library
} from "lucide-react";
import { FolderBrowser } from "@/components/FolderBrowser";
import { useTranslation } from "@/lib/i18n";
import { invalidateSiteSettings } from "@/hooks/useSiteSettings";

interface SiteConfig {
  siteName: string;
  siteIcon: string;
  comicsDir: string;
  extraComicsDirs: string[];
  novelsDir: string;
  extraNovelsDirs: string[];
  thumbnailWidth: number;
  thumbnailHeight: number;
  pageSize: number;
  language: string;
  scraperEnabled: boolean;
  ebookTypeAutoDetect: "off" | "comics" | "all";
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
  const searchParams = useSearchParams();
  const [config, setConfig] = useState<SiteConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 高亮锚点（用于从 Navbar 灰显入口跳转过来时闪烁提示）
  const scraperRef = useRef<HTMLDivElement>(null);
  const [highlightScraper, setHighlightScraper] = useState(false);
  useEffect(() => {
    if (loading) return;
    if (searchParams.get("highlight") !== "scraperEnabled") return;
    const t1 = setTimeout(() => {
      scraperRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightScraper(true);
    }, 80);
    const t2 = setTimeout(() => setHighlightScraper(false), 2400);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [loading, searchParams]);

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

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/site-settings", {
        credentials: "include",
      });
      const contentType = res.headers.get("content-type") || "";
      if (!res.ok) {
        const body = await res.text();
        const preview = body.length > 240 ? `${body.slice(0, 240)}…` : body;
        if (!contentType.includes("json")) {
          throw new Error(`站点设置接口返回非 JSON 响应 (${res.status})，可能是登录页或网关错误：${preview}`);
        }
        throw new Error(`Failed to load site settings: ${res.status} ${preview}`);
      }
      if (!contentType.includes("json")) {
        const body = await res.text();
        const preview = body.length > 240 ? `${body.slice(0, 240)}…` : body;
        throw new Error(`站点设置接口返回了 HTML 而不是 JSON，通常是反代 / 认证跳转：${preview}`);
      }
      const data = await res.json();
      setConfig({
        extraComicsDirs: [],
        extraNovelsDirs: [],
        ebookTypeAutoDetect: "comics",
        ...data,
      });
    } catch (err) {
      console.error("[SiteSettingsPanel] load failed:", err);
      setError(err instanceof Error ? err.message : "加载站点设置失败");
      setConfig(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
    loadThumbStats();
  }, [loadConfig]);

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
        invalidateSiteSettings();
        setTimeout(() => setSaved(false), 2000);
      }
    } finally {
      setSaving(false);
    }
  };

  const update = (key: keyof SiteConfig, value: string | number | string[] | boolean) => {
    if (!config) return;
    setConfig({ ...config, [key]: value });
    setSaved(false);
  };

  // Icon upload states
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const [iconError, setIconError] = useState<string | null>(null);
  const [iconSuccess, setIconSuccess] = useState(false);
  const iconInputRef = useRef<HTMLInputElement>(null);

  const handleIconUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type (不支持 SVG，存在 XSS 风险)
    const allowedTypes = ["image/png", "image/jpeg", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      setIconError(siteT?.iconTypeError || "不支持的文件格式，请上传 PNG、JPG 或 WebP 格式的图标");
      return;
    }

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      setIconError(siteT?.iconSizeError || "图标文件大小不能超过 2MB");
      return;
    }

    setUploadingIcon(true);
    setIconError(null);
    setIconSuccess(false);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/site-settings/icon", {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        setIconSuccess(true);
        invalidateSiteSettings();
        // Update config to reflect new icon
        const data = await res.json();
        if (config) {
          setConfig({ ...config, siteIcon: data.iconPath });
        }
        setTimeout(() => setIconSuccess(false), 2000);
      } else {
        const data = await res.json();
        setIconError(data.error || "上传失败");
      }
    } catch {
      setIconError("上传失败，请重试");
    } finally {
      setUploadingIcon(false);
      // Reset file input
      if (iconInputRef.current) {
        iconInputRef.current.value = "";
      }
    }
  };

  const handleIconDelete = async () => {
    try {
      const res = await fetch("/api/site-settings/icon", {
        method: "DELETE",
      });

      if (res.ok) {
        setIconSuccess(true);
        invalidateSiteSettings();
        if (config) {
          setConfig({ ...config, siteIcon: "" });
        }
        setTimeout(() => setIconSuccess(false), 2000);
      } else {
        const data = await res.json();
        setIconError(data.error || "删除失败");
      }
    } catch {
      setIconError("删除失败，请重试");
    }
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

  if (error || !config) {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-2">
          <Globe className="h-5 w-5 text-accent" />
          <h3 className="text-sm font-medium text-foreground">
            {t.siteSettings?.title || "Site Settings"}
          </h3>
        </div>
        <div className="rounded-2xl border border-border/40 bg-card p-6 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/10 text-red-500">
            <AlertCircle className="h-5 w-5" />
          </div>
          <h3 className="text-sm font-semibold text-foreground">站点设置加载失败</h3>
          <p className="mt-1 text-xs text-muted">
            {error || "未获取到站点配置，请检查接口或登录状态。"}
          </p>
          <button
            onClick={loadConfig}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/90"
          >
            <RefreshCw className="h-4 w-4" />
            重试
          </button>
        </div>
      </div>
    );
  }

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

      {/* Site Icon */}
      <div className="space-y-3 rounded-xl bg-background p-4">
        <div className="flex items-center gap-2 text-xs font-medium text-foreground">
          <Image className="h-3.5 w-3.5 text-accent" />
          {siteT?.siteIcon || "Site Icon"}
        </div>
        <p className="text-[11px] text-muted">
          {siteT?.siteIconDesc || "Upload a custom icon for the site logo. Supports PNG, JPG, WebP formats, max 2MB."}
        </p>

        <div className="flex items-center gap-4">
          {/* Icon Preview */}
          <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-border bg-card overflow-hidden">
            {config.siteIcon ? (
              <img src="/api/site-settings/icon" alt="Site Icon" className="h-full w-full object-contain" />
            ) : (
              <BookMarked className="h-8 w-8 text-muted" />
            )}
          </div>

          {/* Upload/Delete Buttons */}
          <div className="flex flex-col gap-2">
            <input
              ref={iconInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleIconUpload}
              className="hidden"
            />
            <button
              onClick={() => iconInputRef.current?.click()}
              disabled={uploadingIcon}
              className="flex items-center gap-1.5 rounded-lg bg-accent/15 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/25 transition-colors disabled:opacity-50"
            >
              {uploadingIcon ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ImagePlus className="h-3.5 w-3.5" />
              )}
              {uploadingIcon ? (siteT?.uploading || "Uploading...") : (siteT?.uploadIcon || "Upload Icon")}
            </button>
            {config.siteIcon && (
              <button
                onClick={handleIconDelete}
                className="flex items-center gap-1.5 rounded-lg bg-destructive/15 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/25 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {siteT?.resetIcon || "Reset to Default"}
              </button>
            )}
          </div>
        </div>

        {/* Error/Success Messages */}
        {iconError && (
          <div className="flex items-center gap-2 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5" />
            {iconError}
          </div>
        )}
        {iconSuccess && (
          <div className="flex items-center gap-2 text-xs text-green-500">
            <CheckCircle className="h-3.5 w-3.5" />
            {siteT?.iconSaved || "Icon saved successfully"}
          </div>
        )}
      </div>

      {/* Comics Directories - migrated to library management */}
      <div className="space-y-3 rounded-xl bg-background p-4">
        <div className="flex items-center gap-2 text-xs font-medium text-foreground">
          <FolderOpen className="h-3.5 w-3.5 text-accent" />
          {siteT?.comicsDir || "Comics Directory"}
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-accent/20 bg-accent/5 p-3">
          <Library className="h-5 w-5 text-accent shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">
              {"目录配置已迁移到书库管理"}
            </p>
            <p className="text-xs text-muted mt-0.5">
              {"请在书库管理中创建漫画库、小说库或混合库，统一管理扫描目录"}
            </p>
          </div>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("navigate-to-library"))}
            className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition-opacity"
          >
            {"前往书库管理"}
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

      {/* Novels/Ebooks Directories - migrated to library management */}
      <div className="space-y-3 rounded-xl bg-background p-4">
        <div className="flex items-center gap-2 text-xs font-medium text-foreground">
          <BookOpen className="h-3.5 w-3.5 text-accent" />
          {siteT?.novelsDir || "电子书目录"}
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-accent/20 bg-accent/5 p-3">
          <Library className="h-5 w-5 text-accent shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">
              {"目录配置已迁移到书库管理"}
            </p>
            <p className="text-xs text-muted mt-0.5">
              {"请在书库管理中创建小说库或混合库"}
            </p>
          </div>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("navigate-to-library"))}
            className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition-opacity"
          >
            {"前往书库管理"}
          </button>
        </div>
      </div>

      {/* Ebook Type Auto Detect */}
      <div className="space-y-3 rounded-xl bg-background p-4">
        <div className="flex items-center gap-2 text-xs font-medium text-foreground">
          <BookOpen className="h-3.5 w-3.5 text-accent" />
          {siteT?.ebookTypeAutoDetect || "电子书类型识别策略"}
        </div>
        <p className="text-[11px] text-muted">
          {siteT?.ebookTypeAutoDetectDesc ||
            "EPUB/MOBI/AZW3 文件可能既是图文教材也可能是漫画。该选项决定系统如何判断它们是漫画还是小说。"}
        </p>
        <div className="space-y-2">
          {([
            {
              key: "comics",
              label: siteT?.ebookDetectComicsOnly || "仅漫画目录里的电子书做内容识别（推荐）",
              desc: siteT?.ebookDetectComicsOnlyDesc ||
                "放在小说目录里的文件一律视为小说，避免图文教材被误判为漫画。",
            },
            {
              key: "off",
              label: siteT?.ebookDetectOff || "完全按目录区分",
              desc: siteT?.ebookDetectOffDesc ||
                "严格按文件所在目录决定类型，不做任何内容分析。最快也最可控。",
            },
            {
              key: "all",
              label: siteT?.ebookDetectAll || "对所有电子书都做内容识别（旧版行为）",
              desc: siteT?.ebookDetectAllDesc ||
                "无论文件位于哪个目录，只要图片占比高就归类为漫画。可能将图文教材误判为漫画。",
            },
          ] as const).map((opt) => (
            <label
              key={opt.key}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 transition-colors ${
                config.ebookTypeAutoDetect === opt.key
                  ? "border-accent/50 bg-accent/10"
                  : "border-border hover:border-border/80 hover:bg-card-hover"
              }`}
            >
              <input
                type="radio"
                name="ebookTypeAutoDetect"
                value={opt.key}
                checked={config.ebookTypeAutoDetect === opt.key}
                onChange={() => update("ebookTypeAutoDetect", opt.key)}
                className="mt-0.5 accent-accent"
              />
              <div className="flex-1">
                <div className="text-xs font-medium text-foreground">{opt.label}</div>
                <div className="mt-0.5 text-[11px] text-muted leading-relaxed">{opt.desc}</div>
              </div>
            </label>
          ))}
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

      {/* Scraper Toggle */}
      <div
        id="scraperEnabled"
        ref={scraperRef}
        className={`space-y-3 rounded-xl bg-background p-4 transition-all duration-500 ${
          highlightScraper
            ? "ring-2 ring-accent/70 shadow-lg shadow-accent/20 animate-pulse"
            : ""
        }`}
      >
        <div className="flex items-center gap-2 text-xs font-medium text-foreground">
          <Database className="h-3.5 w-3.5 text-accent" />
          {siteT?.scraperEnabled || "启用内容刮削"}
        </div>
        <div className="flex items-center justify-between">
          <div className="flex-1 pr-4">
            <p className="text-[11px] text-muted">
              {siteT?.scraperEnabledDesc || "开启后允许系统从在线数据源（AniList、Bangumi 等）自动获取封面、简介、标签等元数据。关闭时所有自动内容获取和更新操作将被禁止。"}
            </p>
          </div>
          <button
            onClick={() => update("scraperEnabled", config.scraperEnabled ? false : true)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ${
              config.scraperEnabled ? "bg-accent" : "bg-border"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
                config.scraperEnabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>
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
