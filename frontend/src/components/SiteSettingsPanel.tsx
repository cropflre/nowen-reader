"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertCircle,
  BookOpen,
  BookMarked,
  CheckCircle,
  Database,
  Globe,
  Image,
  ImagePlus,
  Languages,
  RefreshCw,
  Save,
  Trash2,
  Undo2,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { invalidateSiteSettings } from "@/hooks/useSiteSettings";
import { apiPath } from "@/lib/base-path";

interface SiteConfig {
  siteName: string;
  siteIcon: string;
  thumbnailWidth: number;
  thumbnailHeight: number;
  language: string;
  scraperEnabled: boolean;
  ebookTypeAutoDetect: "off" | "comics" | "all";
}

const DEFAULT_CONFIG: SiteConfig = {
  siteName: "NowenReader",
  siteIcon: "",
  thumbnailWidth: 400,
  thumbnailHeight: 560,
  language: "auto",
  scraperEnabled: true,
  ebookTypeAutoDetect: "comics",
};

function normalizeConfig(data: Partial<SiteConfig>): SiteConfig {
  return { ...DEFAULT_CONFIG, ...data };
}

export function SiteSettingsPanel() {
  const t = useTranslation();
  const searchParams = useSearchParams();
  const [config, setConfig] = useState<SiteConfig | null>(null);
  const [savedConfig, setSavedConfig] = useState<SiteConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const [iconMessage, setIconMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const iconInputRef = useRef<HTMLInputElement>(null);
  const scraperRef = useRef<HTMLDivElement>(null);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiPath("/api/site-settings"), { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const next = normalizeConfig(await res.json());
      setConfig(next);
      setSavedConfig(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载站点设置失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (loading || searchParams.get("highlight") !== "scraperEnabled") return;
    const timer = window.setTimeout(() => {
      scraperRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [loading, searchParams]);

  const dirty = Boolean(config && savedConfig && JSON.stringify(config) !== JSON.stringify(savedConfig));

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const update = <K extends keyof SiteConfig>(key: K, value: SiteConfig[K]) => {
    setConfig((current) => (current ? { ...current, [key]: value } : current));
    setSaved(false);
  };

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(apiPath("/api/site-settings"), {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteName: config.siteName.trim() || DEFAULT_CONFIG.siteName,
          thumbnailWidth: config.thumbnailWidth,
          thumbnailHeight: config.thumbnailHeight,
          language: config.language,
          scraperEnabled: config.scraperEnabled,
          ebookTypeAutoDetect: config.ebookTypeAutoDetect,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const next = { ...config, siteName: config.siteName.trim() || DEFAULT_CONFIG.siteName };
      setConfig(next);
      setSavedConfig(next);
      setSaved(true);
      invalidateSiteSettings();
      window.setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleIconUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setIconMessage({ type: "error", text: "仅支持 PNG、JPG 和 WebP 图标" });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setIconMessage({ type: "error", text: "图标文件不能超过 2MB" });
      return;
    }

    setUploadingIcon(true);
    setIconMessage(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(apiPath("/api/site-settings/icon"), { method: "POST", body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "上传失败");
      const iconPath = data.iconPath || "custom";
      setConfig((current) => (current ? { ...current, siteIcon: iconPath } : current));
      setSavedConfig((current) => (current ? { ...current, siteIcon: iconPath } : current));
      setIconMessage({ type: "ok", text: "站点图标已更新并立即生效" });
      invalidateSiteSettings();
    } catch (err) {
      setIconMessage({ type: "error", text: err instanceof Error ? err.message : "上传失败" });
    } finally {
      setUploadingIcon(false);
      if (iconInputRef.current) iconInputRef.current.value = "";
    }
  };

  const handleIconDelete = async () => {
    setIconMessage(null);
    try {
      const res = await fetch(apiPath("/api/site-settings/icon"), { method: "DELETE" });
      if (!res.ok) throw new Error("恢复默认图标失败");
      setConfig((current) => (current ? { ...current, siteIcon: "" } : current));
      setSavedConfig((current) => (current ? { ...current, siteIcon: "" } : current));
      setIconMessage({ type: "ok", text: "已恢复默认图标并立即生效" });
      invalidateSiteSettings();
    } catch (err) {
      setIconMessage({ type: "error", text: err instanceof Error ? err.message : "操作失败" });
    }
  };

  if (loading) {
    return <div className="py-12 text-center text-sm text-muted">{t.common.loading}</div>;
  }

  if (!config) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-6 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-red-500" />
        <h2 className="mt-3 text-sm font-semibold text-foreground">站点设置加载失败</h2>
        <p className="mt-1 text-xs text-muted">{error}</p>
        <button onClick={loadConfig} className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white">
          <RefreshCw className="h-4 w-4" />
          重试
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h2 className="text-base font-semibold text-foreground">站点配置</h2>
        <p className="mt-1 text-sm text-muted">管理所有用户共享的站点信息与内容处理默认值。</p>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-500">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      <section id="site-identity" className="rounded-lg border border-border bg-card p-5">
        <div className="mb-4 flex items-center gap-2">
          <Globe className="h-4 w-4 text-accent" />
          <h3 className="text-sm font-semibold text-foreground">站点信息</h3>
        </div>
        <label className="block text-sm text-foreground" htmlFor="site-name">站点名称</label>
        <input id="site-name" value={config.siteName} onChange={(event) => update("siteName", event.target.value)} className="mt-2 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-accent" />

        <div className="mt-5 border-t border-border pt-5">
          <div className="text-sm text-foreground">站点图标</div>
          <p className="mt-1 text-xs text-muted">PNG、JPG 或 WebP，最大 2MB。上传和恢复操作会立即生效。</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-lg border border-border bg-background">
              {config.siteIcon ? <img src={apiPath("/api/site-settings/icon")} alt="当前站点图标" className="h-full w-full object-contain" /> : <BookMarked className="h-7 w-7 text-muted" />}
            </div>
            <input ref={iconInputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={handleIconUpload} className="hidden" />
            <button type="button" onClick={() => iconInputRef.current?.click()} disabled={uploadingIcon} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-accent/10 px-3 text-sm font-medium text-accent hover:bg-accent/20 disabled:opacity-50">
              {uploadingIcon ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
              上传图标
            </button>
            {config.siteIcon && (
              <button type="button" onClick={handleIconDelete} className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm text-muted hover:bg-card-hover hover:text-foreground">
                <Trash2 className="h-4 w-4" />
                恢复默认
              </button>
            )}
          </div>
          {iconMessage && (
            <p className={`mt-3 flex items-center gap-2 text-xs ${iconMessage.type === "ok" ? "text-emerald-500" : "text-red-500"}`}>
              {iconMessage.type === "ok" ? <CheckCircle className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
              {iconMessage.text}
            </p>
          )}
        </div>
      </section>

      <section id="content-detection" className="rounded-lg border border-border bg-card p-5">
        <div className="mb-2 flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-accent" />
          <h3 className="text-sm font-semibold text-foreground">内容识别</h3>
        </div>
        <p className="mb-4 text-xs leading-5 text-muted">决定 EPUB、MOBI 和 AZW3 文件如何区分漫画与小说。扫描目录本身统一在书库管理中维护。</p>
        <div className="space-y-2">
          {([
            ["comics", "仅漫画书库进行内容识别", "推荐。小说书库中的电子书始终按小说处理。"],
            ["off", "完全按书库类型区分", "不分析文件内容，速度最快且结果最可控。"],
            ["all", "所有电子书都进行内容识别", "兼容旧行为，但图文教材可能被判断为漫画。"],
          ] as const).map(([value, label, description]) => (
            <label key={value} className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${config.ebookTypeAutoDetect === value ? "border-accent/50 bg-accent/5" : "border-border"}`}>
              <input type="radio" name="ebook-detection" checked={config.ebookTypeAutoDetect === value} onChange={() => update("ebookTypeAutoDetect", value)} className="mt-0.5 accent-accent" />
              <span>
                <span className="block text-sm font-medium text-foreground">{label}</span>
                <span className="mt-0.5 block text-xs leading-5 text-muted">{description}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section id="media-processing" className="rounded-lg border border-border bg-card p-5">
        <div className="mb-4 flex items-center gap-2">
          <Image className="h-4 w-4 text-accent" />
          <h3 className="text-sm font-semibold text-foreground">媒体处理默认值</h3>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm text-foreground">缩略图宽度<input type="number" min={100} max={1200} value={config.thumbnailWidth} onChange={(event) => update("thumbnailWidth", Number(event.target.value) || 400)} className="mt-2 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-accent" /></label>
          <label className="text-sm text-foreground">缩略图高度<input type="number" min={100} max={1600} value={config.thumbnailHeight} onChange={(event) => update("thumbnailHeight", Number(event.target.value) || 560)} className="mt-2 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-accent" /></label>
        </div>
        <p className="mt-3 text-xs text-muted">修改尺寸后，可前往“数据管理”重新生成缩略图。</p>
      </section>

      <section id="metadata-defaults" className="rounded-lg border border-border bg-card p-5">
        <div className="mb-4 flex items-center gap-2"><Database className="h-4 w-4 text-accent" /><h3 className="text-sm font-semibold text-foreground">元数据默认值</h3></div>
        <div ref={scraperRef} className="flex items-center justify-between gap-4">
          <div><div className="text-sm font-medium text-foreground">启用内容刮削</div><p className="mt-1 text-xs leading-5 text-muted">允许系统从在线来源获取封面、简介和标签。</p></div>
          <button type="button" role="switch" aria-label="启用内容刮削" aria-checked={config.scraperEnabled} onClick={() => update("scraperEnabled", !config.scraperEnabled)} className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${config.scraperEnabled ? "bg-accent" : "bg-muted/40"}`}><span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${config.scraperEnabled ? "translate-x-5" : "translate-x-0"}`} /></button>
        </div>
        <label className="mt-5 block text-sm text-foreground" htmlFor="metadata-language">
          <span className="flex items-center gap-2"><Languages className="h-4 w-4 text-muted" />元数据默认语言</span>
          <select id="metadata-language" value={config.language} onChange={(event) => update("language", event.target.value)} className="mt-2 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-accent"><option value="auto">自动检测</option><option value="zh-CN">中文</option><option value="en">English</option></select>
        </label>
      </section>

      <div className="sticky bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card/95 p-3 shadow-lg backdrop-blur">
        <p className="text-xs text-muted">{dirty ? "有尚未保存的修改" : "所有站点配置均已保存"}</p>
        <div className="flex items-center gap-2">
          <button type="button" disabled={!dirty || saving} onClick={() => savedConfig && setConfig(savedConfig)} className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm text-muted hover:bg-card-hover hover:text-foreground disabled:opacity-40"><Undo2 className="h-4 w-4" />取消修改</button>
          <button type="button" disabled={!dirty || saving} onClick={handleSave} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-40">{saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : saved ? <CheckCircle className="h-4 w-4" /> : <Save className="h-4 w-4" />}{saved ? "已保存" : "保存配置"}</button>
        </div>
      </div>
    </div>
  );
}
