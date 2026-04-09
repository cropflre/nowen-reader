"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import Image from "next/image";
import {
  X, User, Globe, Bookmark, Tag, Clock, Calendar, Languages, FileText,
  Star, Heart, Pencil, CheckCircle, AlertCircle, Loader2, Search,
  Trash2, Plus, ImagePlus, Download, Eye, RefreshCw, Sparkles,
  ChevronDown, ChevronUp, BookOpen, Layers, Database, Brain,
} from "lucide-react";
import { useTranslation, useLocale } from "@/lib/i18n";
import { useAIStatus } from "@/hooks/useAIStatus";
import { MetadataSearch } from "@/components/MetadataSearch";
import {
  updateComicMetadata,
  removeComicTag,
  addComicTags,
  clearAllComicTags,
  addComicCategories,
  removeComicCategory,
  clearAllComicCategories,
  toggleComicFavorite,
  updateComicRating,
} from "@/api/comics";
import { useCategories } from "@/hooks/useCategories";
import type { ApiCategory } from "@/hooks/useComicTypes";
import { setFocusedItem, loadLibrary, loadStats } from "@/lib/scraper-store";
import type { LibraryItem } from "@/lib/scraper-store";
import { emitMetadataUpdated, emitTagsUpdated, emitCategoriesUpdated, emitScrapeApplied } from "@/lib/sync-event";
import { invalidateSwCache } from "@/lib/pwa";
import { invalidateComicsCache } from "@/hooks/useComicList";
import { DetailInlineEditField } from "./DetailInlineEditField";

export function DetailPanel({
  item,
  scraperT,
  isAdmin,
  onClose,
  onRefresh,
}: {
  item: LibraryItem;
  scraperT: Record<string, string>;
  isAdmin: boolean;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const t = useTranslation();
  const { locale } = useLocale();
  const { aiConfigured } = useAIStatus();
  const { categories: allCategories, refetch: refetchCategories, initCategories } = useCategories();

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState(item.title);
  const [titleSaving, setTitleSaving] = useState(false);
  const [removingTag, setRemovingTag] = useState<string | null>(null);
  // 元数据编辑模式
  const [metaEditMode, setMetaEditMode] = useState(false);
  const [metaSaving, setMetaSaving] = useState(false);
  const [metaSaveSuccess, setMetaSaveSuccess] = useState<string | null>(null);

  // 标签管理
  const [newTag, setNewTag] = useState("");
  // 分类管理
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  // 评分
  const [localRating, setLocalRating] = useState<number>(item.rating || 0);
  // 收藏
  const [localFavorite, setLocalFavorite] = useState<boolean>(item.isFavorite || false);

  // AI 功能 state
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const [aiParseLoading, setAiParseLoading] = useState(false);
  const [aiParsedResult, setAiParsedResult] = useState<Record<string, unknown> | null>(null);
  const [aiSuggestLoading, setAiSuggestLoading] = useState(false);
  const [aiSuggestedTags, setAiSuggestedTags] = useState<string[]>([]);
  const [aiSelectedTags, setAiSelectedTags] = useState<Set<string>>(new Set());
  const [aiCompleteMetaLoading, setAiCompleteMetaLoading] = useState(false);
  const [aiCategoryLoading, setAiCategoryLoading] = useState(false);
  const [aiSuggestedCategories, setAiSuggestedCategories] = useState<string[]>([]);
  const [aiCoverLoading, setAiCoverLoading] = useState(false);
  const [aiCoverResult, setAiCoverResult] = useState<Record<string, unknown> | null>(null);

  // 翻译
  const [metadataTranslating, setMetadataTranslating] = useState(false);
  const [translateEngines, setTranslateEngines] = useState<{id: string; name: string; available: boolean; speed: string; quality: string}[]>([]);
  const [showEngineMenu, setShowEngineMenu] = useState(false);
  const [translateEngine, setTranslateEngine] = useState<string>("");
  const [lastTranslateEngine, setLastTranslateEngine] = useState<string>("");

  // 封面管理
  const [coverKey, setCoverKey] = useState(() => Date.now());
  const [showCoverMenu, setShowCoverMenu] = useState(false);
  const [coverUrlInput, setCoverUrlInput] = useState("");
  const [showCoverUrlInput, setShowCoverUrlInput] = useState(false);
  const [coverLoading, setCoverLoading] = useState(false);
  const coverFileRef = useRef<HTMLInputElement>(null);
  const [showCoverPicker, setShowCoverPicker] = useState(false);
  const [coverPickerPages, setCoverPickerPages] = useState<number>(0);

  // 同步 item 变化
  useEffect(() => { setLocalRating(item.rating || 0); }, [item.rating]);
  useEffect(() => { setLocalFavorite(item.isFavorite || false); }, [item.isFavorite]);

  // 初始化分类
  useEffect(() => {
    if (allCategories.length === 0) initCategories(locale);
  }, [allCategories.length, initCategories, locale]);

  // 加载翻译引擎
  useEffect(() => {
    fetch("/api/translate/engines").then(r => r.json()).then(data => {
      if (data.engines) setTranslateEngines(data.engines);
    }).catch(() => {});
  }, []);

  // 保存单个元数据字段
  const handleSaveMetaField = async (fieldKey: string, newValue: string) => {
    setMetaSaving(true);
    try {
      const metadata: Record<string, unknown> = {};
      if (fieldKey === "year") {
        const num = parseInt(newValue, 10);
        metadata[fieldKey] = isNaN(num) ? null : num;
      } else {
        metadata[fieldKey] = newValue;
      }
      const ok = await updateComicMetadata(item.id, metadata as any);
      if (ok) {
        setMetaSaveSuccess(fieldKey);
        setTimeout(() => setMetaSaveSuccess(null), 2000);
        onRefresh();
        loadLibrary();
        loadStats();
        emitMetadataUpdated(item.id, "scraper", { field: fieldKey, value: newValue });
      }
    } finally {
      setMetaSaving(false);
    }
  };

  // 保存标题
  const handleSaveTitle = async () => {
    const trimmed = titleInput.trim();
    if (!trimmed || trimmed === item.title) {
      setEditingTitle(false);
      setTitleInput(item.title);
      return;
    }
    setTitleSaving(true);
    try {
      const ok = await updateComicMetadata(item.id, { title: trimmed });
      if (ok) {
        onRefresh();
        loadLibrary();
        emitMetadataUpdated(item.id, "scraper", { field: "title", value: trimmed });
      }
    } finally {
      setTitleSaving(false);
      setEditingTitle(false);
    }
  };

  // ── 标签管理 ──
  const handleAddTag = async () => {
    if (!newTag.trim()) return;
    await addComicTags(item.id, [newTag.trim()]);
    setNewTag("");
    onRefresh();
    loadLibrary();
    emitTagsUpdated(item.id, "scraper", { action: "add", tag: newTag.trim() });
  };

  const handleRemoveTag = async (tagName: string) => {
    setRemovingTag(tagName);
    try {
      await removeComicTag(item.id, tagName);
      onRefresh();
      loadLibrary();
      emitTagsUpdated(item.id, "scraper", { action: "remove", tag: tagName });
    } finally {
      setRemovingTag(null);
    }
  };

  const handleClearAllTags = async () => {
    if (!item.tags || item.tags.length === 0) return;
    if (!window.confirm(t.comicDetail?.clearAllTagsConfirm || "确定清除所有标签？")) return;
    await clearAllComicTags(item.id);
    onRefresh();
    loadLibrary();
    emitTagsUpdated(item.id, "scraper", { action: "clear_all" });
  };

  // ── 分类管理 ──
  const handleAddCategory = async (slug: string) => {
    await addComicCategories(item.id, [slug]);
    setShowCategoryPicker(false);
    onRefresh();
    loadLibrary();
    refetchCategories();
    emitCategoriesUpdated(item.id, "scraper", { action: "add", slug });
  };

  const handleRemoveCategory = async (slug: string) => {
    await removeComicCategory(item.id, slug);
    onRefresh();
    loadLibrary();
    refetchCategories();
    emitCategoriesUpdated(item.id, "scraper", { action: "remove", slug });
  };

  const handleClearAllCategories = async () => {
    if (!item.categories || item.categories.length === 0) return;
    if (!window.confirm(t.comicDetail?.clearAllCategoriesConfirm || "确定清除所有分类？")) return;
    await clearAllComicCategories(item.id);
    onRefresh();
    loadLibrary();
    refetchCategories();
    emitCategoriesUpdated(item.id, "scraper", { action: "clear_all" });
  };

  // ── 评分 ──
  const handleRating = async (newRating: number) => {
    const r = newRating === localRating ? null : newRating;
    setLocalRating(r || 0);
    await updateComicRating(item.id, r);
    onRefresh();
    loadLibrary();
    emitMetadataUpdated(item.id, "scraper", { field: "rating", value: r });
  };

  // ── 收藏 ──
  const handleToggleFavorite = async () => {
    setLocalFavorite(!localFavorite);
    await toggleComicFavorite(item.id);
    onRefresh();
    loadLibrary();
    emitMetadataUpdated(item.id, "scraper", { field: "isFavorite", value: !localFavorite });
  };

  // ── AI 功能 ──
  const handleAiSummary = async () => {
    if (aiSummaryLoading) return;
    setAiSummaryLoading(true);
    try {
      const res = await fetch(`/api/comics/${item.id}/ai-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetLang: locale }),
      });
      if (res.ok) { onRefresh(); loadLibrary(); }
    } catch { /* ignore */ } finally { setAiSummaryLoading(false); }
  };

  const handleAiParseFilename = async () => {
    if (aiParseLoading) return;
    setAiParseLoading(true);
    setAiParsedResult(null);
    try {
      const res = await fetch(`/api/comics/${item.id}/ai-parse-filename`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply: false }),
      });
      if (res.ok) { const data = await res.json(); setAiParsedResult(data.parsed); }
    } catch { /* ignore */ } finally { setAiParseLoading(false); }
  };

  const handleAiParseApply = async () => {
    try {
      const res = await fetch(`/api/comics/${item.id}/ai-parse-filename`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply: true }),
      });
      if (res.ok) { setAiParsedResult(null); onRefresh(); loadLibrary(); }
    } catch { /* ignore */ }
  };

  const handleAiCompleteMetadata = async () => {
    if (aiCompleteMetaLoading) return;
    setAiCompleteMetaLoading(true);
    try {
      const res = await fetch(`/api/comics/${item.id}/ai-complete-metadata`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetLang: locale, apply: true }),
      });
      if (res.ok) { onRefresh(); loadLibrary(); }
    } catch { /* ignore */ } finally { setAiCompleteMetaLoading(false); }
  };

  const handleAiSuggestTags = async () => {
    if (aiSuggestLoading) return;
    setAiSuggestLoading(true);
    setAiSuggestedTags([]);
    setAiSelectedTags(new Set());
    try {
      const res = await fetch(`/api/comics/${item.id}/ai-suggest-tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetLang: locale, apply: false }),
      });
      if (res.ok) {
        const data = await res.json();
        const tags = data.suggestedTags || [];
        setAiSuggestedTags(tags);
        setAiSelectedTags(new Set(tags));
      }
    } catch { /* ignore */ } finally { setAiSuggestLoading(false); }
  };

  const handleAddAiTags = async (tags: string[]) => {
    if (tags.length === 0) return;
    await addComicTags(item.id, tags);
    setAiSuggestedTags([]);
    setAiSelectedTags(new Set());
    onRefresh();
    loadLibrary();
    emitTagsUpdated(item.id, "scraper", { action: "ai_add", tags });
  };

  const handleAiSuggestCategory = async () => {
    if (aiCategoryLoading) return;
    setAiCategoryLoading(true);
    setAiSuggestedCategories([]);
    try {
      const res = await fetch("/api/ai/suggest-category", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comicId: item.id, targetLang: locale, apply: true }),
      });
      if (res.ok) {
        const data = await res.json();
        setAiSuggestedCategories(data.suggestedCategories || []);
        onRefresh();
        loadLibrary();
        refetchCategories();
      }
    } catch { /* ignore */ } finally { setAiCategoryLoading(false); }
  };

  const handleAiAnalyzeCover = async () => {
    if (aiCoverLoading) return;
    setAiCoverLoading(true);
    setAiCoverResult(null);
    try {
      const res = await fetch(`/api/comics/${item.id}/ai-analyze-cover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetLang: locale, apply: false }),
      });
      if (res.ok) { const data = await res.json(); setAiCoverResult(data.analysis); }
    } catch { /* ignore */ } finally { setAiCoverLoading(false); }
  };

  const handleAiCoverApply = async () => {
    try {
      const res = await fetch(`/api/comics/${item.id}/ai-analyze-cover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetLang: locale, apply: true }),
      });
      if (res.ok) { setAiCoverResult(null); onRefresh(); loadLibrary(); }
    } catch { /* ignore */ }
  };

  // ── 翻译 ──
  const handleTranslateMetadata = async (engine?: string) => {
    if (metadataTranslating) return;
    setMetadataTranslating(true);
    setShowEngineMenu(false);
    try {
      const res = await fetch(`/api/comics/${item.id}/translate-metadata`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetLang: locale, engine: engine || translateEngine || "" }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.engine) setLastTranslateEngine(data.engine);
        onRefresh();
        loadLibrary();
      }
    } catch { /* ignore */ } finally { setMetadataTranslating(false); }
  };

  // ── 封面管理 ──
  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCoverLoading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/comics/${item.id}/cover`, { method: "POST", body: formData });
      if (res.ok) {
        invalidateSwCache(`/api/comics/${item.id}/thumbnail`);
        invalidateComicsCache();
        setCoverKey(Date.now());
        setShowCoverMenu(false);
        onRefresh();
        loadLibrary();
      }
    } catch (err) {
      console.error("Cover upload failed:", err);
    } finally {
      setCoverLoading(false);
      if (coverFileRef.current) coverFileRef.current.value = "";
    }
  };

  const handleCoverFromUrl = async () => {
    if (!coverUrlInput.trim()) return;
    setCoverLoading(true);
    try {
      const res = await fetch(`/api/comics/${item.id}/cover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: coverUrlInput.trim() }),
      });
      if (res.ok) {
        invalidateSwCache(`/api/comics/${item.id}/thumbnail`);
        invalidateComicsCache();
        setCoverKey(Date.now());
        setShowCoverUrlInput(false);
        setCoverUrlInput("");
        setShowCoverMenu(false);
        onRefresh();
        loadLibrary();
      }
    } catch (err) {
      console.error("Cover fetch failed:", err);
    } finally {
      setCoverLoading(false);
    }
  };

  const handleCoverReset = async () => {
    setCoverLoading(true);
    try {
      const res = await fetch(`/api/comics/${item.id}/cover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset: true }),
      });
      if (res.ok) {
        invalidateSwCache(`/api/comics/${item.id}/thumbnail`);
        invalidateComicsCache();
        setCoverKey(Date.now());
        setShowCoverMenu(false);
        onRefresh();
        loadLibrary();
      }
    } catch (err) {
      console.error("Cover reset failed:", err);
    } finally {
      setCoverLoading(false);
    }
  };

  const handleOpenCoverPicker = async () => {
    setShowCoverMenu(false);
    try {
      const res = await fetch(`/api/comics/${item.id}/pages`);
      if (res.ok) {
        const data = await res.json();
        setCoverPickerPages(data.totalPages || 0);
        setShowCoverPicker(true);
      }
    } catch { /* ignore */ }
  };

  const handleSelectCoverPage = async (pageIndex: number) => {
    setCoverLoading(true);
    try {
      const res = await fetch(`/api/comics/${item.id}/cover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageIndex }),
      });
      if (res.ok) {
        invalidateSwCache(`/api/comics/${item.id}/thumbnail`);
        invalidateComicsCache();
        setCoverKey(Date.now());
        setShowCoverPicker(false);
        onRefresh();
        loadLibrary();
      }
    } catch (err) {
      console.error("Cover select failed:", err);
    } finally {
      setCoverLoading(false);
    }
  };

  const handleCoverFromPlatform = async () => {
    setCoverLoading(true);
    setShowCoverMenu(false);
    try {
      const res = await fetch("/api/metadata/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: item.title,
          sources: ["anilist", "bangumi", "mangadex", "kitsu"],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const results = data.results || [];
        for (const r of results) {
          if (r.coverUrl) {
            const coverRes = await fetch(`/api/comics/${item.id}/cover`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: r.coverUrl }),
            });
            if (coverRes.ok) {
              invalidateSwCache(`/api/comics/${item.id}/thumbnail`);
              invalidateComicsCache();
              setCoverKey(Date.now());
              onRefresh();
              loadLibrary();
              break;
            }
          }
        }
      }
    } catch (err) {
      console.error("Platform cover fetch failed:", err);
    } finally {
      setCoverLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/30 flex-shrink-0">
        <h3 className="text-sm font-semibold text-foreground truncate flex-1 mr-2">
          {scraperT.detailTitle || "书籍详情"}
        </h3>
        <div className="flex items-center gap-1">
          {isAdmin && (
            <button
              onClick={() => setMetaEditMode(!metaEditMode)}
              className={`flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-medium transition-colors ${
                metaEditMode
                  ? "bg-accent/20 text-accent"
                  : "text-muted hover:text-foreground hover:bg-card-hover"
              }`}
              title={metaEditMode ? "退出编辑模式" : "进入编辑模式"}
            >
              <Pencil className="h-3 w-3" />
              {metaEditMode ? "编辑中" : "编辑"}
            </button>
          )}
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:text-foreground hover:bg-card-hover transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* 封面 + 基本信息 */}
        <div className="flex gap-4">
          <div className="group relative h-36 w-24 flex-shrink-0 overflow-hidden rounded-xl border border-border/40 bg-muted/10 shadow-lg">
            <Image
              src={`/api/comics/${item.id}/thumbnail?v=${coverKey}`}
              alt=""
              fill
              className="object-cover"
              sizes="96px"
              unoptimized
            />
            {/* 封面覆盖层按钮 — 仅管理员 */}
            {isAdmin && (
              <div className="absolute inset-0 flex items-end justify-center bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  onClick={() => setShowCoverMenu(!showCoverMenu)}
                  disabled={coverLoading}
                  className="mb-1.5 flex items-center gap-1 rounded-md bg-white/20 px-2 py-1 text-[10px] font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/30"
                >
                  {coverLoading ? (
                    <RefreshCw className="h-3 w-3 animate-spin" />
                  ) : (
                    <ImagePlus className="h-3 w-3" />
                  )}
                  {t.comicDetail?.changeCover || "更换封面"}
                </button>
              </div>
            )}
            {/* 封面菜单下拉 */}
            {showCoverMenu && isAdmin && (
              <div className="absolute bottom-0 left-0 right-0 z-10 rounded-b-xl bg-zinc-900/95 p-2 backdrop-blur-sm">
                <div className="space-y-0.5">
                  <button
                    onClick={() => coverFileRef.current?.click()}
                    disabled={coverLoading}
                    className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-[10px] text-zinc-200 transition-colors hover:bg-zinc-700/60"
                  >
                    <ImagePlus className="h-3 w-3" />
                    {t.comicDetail?.uploadCover || "上传本地图片"}
                  </button>
                  <button
                    onClick={() => setShowCoverUrlInput(!showCoverUrlInput)}
                    disabled={coverLoading}
                    className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-[10px] text-zinc-200 transition-colors hover:bg-zinc-700/60"
                  >
                    <Globe className="h-3 w-3" />
                    {t.comicDetail?.coverFromUrl || "输入图片URL"}
                  </button>
                  {showCoverUrlInput && (
                    <div className="flex gap-1 px-0.5">
                      <input
                        type="text"
                        value={coverUrlInput}
                        onChange={(e) => setCoverUrlInput(e.target.value)}
                        placeholder="https://..."
                        className="flex-1 rounded-md bg-zinc-800 px-1.5 py-1 text-[10px] text-white placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-accent"
                        onKeyDown={(e) => e.key === "Enter" && handleCoverFromUrl()}
                      />
                      <button
                        onClick={handleCoverFromUrl}
                        disabled={coverLoading || !coverUrlInput.trim()}
                        className="rounded-md bg-accent px-1.5 py-1 text-[10px] text-white disabled:opacity-50"
                      >
                        OK
                      </button>
                    </div>
                  )}
                  <button
                    onClick={handleCoverFromPlatform}
                    disabled={coverLoading}
                    className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-[10px] text-zinc-200 transition-colors hover:bg-zinc-700/60"
                  >
                    <Download className="h-3 w-3" />
                    {t.comicDetail?.coverFromPlatform || "从平台获取"}
                  </button>
                  {item.contentType !== "novel" && (
                    <button
                      onClick={handleOpenCoverPicker}
                      disabled={coverLoading}
                      className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-[10px] text-zinc-200 transition-colors hover:bg-zinc-700/60"
                    >
                      <Layers className="h-3 w-3" />
                      {t.comicDetail?.coverFromArchive || "从内页选择"}
                    </button>
                  )}
                  <button
                    onClick={handleCoverReset}
                    disabled={coverLoading}
                    className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-[10px] text-zinc-200 transition-colors hover:bg-zinc-700/60"
                  >
                    <RefreshCw className="h-3 w-3" />
                    {t.comicDetail?.resetCover || "恢复默认"}
                  </button>
                  <button
                    onClick={() => { setShowCoverMenu(false); setShowCoverUrlInput(false); }}
                    className="mt-0.5 w-full rounded-md py-1 text-[10px] text-zinc-400 transition-colors hover:text-zinc-200"
                  >
                    {t.common?.cancel || "取消"}
                  </button>
                </div>
              </div>
            )}
          </div>
          {/* 隐藏文件输入 */}
          <input
            ref={coverFileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleCoverUpload}
          />
          <div className="flex-1 min-w-0 space-y-2">
            {/* 可编辑标题 */}
            {editingTitle ? (
              <div className="space-y-1.5">
                <input
                  type="text"
                  value={titleInput}
                  onChange={(e) => setTitleInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveTitle();
                    if (e.key === "Escape") { setEditingTitle(false); setTitleInput(item.title); }
                  }}
                  autoFocus
                  disabled={titleSaving}
                  className="w-full rounded-lg bg-card-hover/60 px-2.5 py-1.5 text-sm font-bold text-foreground outline-none border border-accent/40 focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all disabled:opacity-50"
                />
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={handleSaveTitle}
                    disabled={titleSaving}
                    className="flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-[10px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
                  >
                    {titleSaving ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <CheckCircle className="h-2.5 w-2.5" />}
                    {scraperT.saveTitle || "保存"}
                  </button>
                  <button
                    onClick={() => { setEditingTitle(false); setTitleInput(item.title); }}
                    disabled={titleSaving}
                    className="flex items-center gap-1 rounded-md bg-card-hover px-2 py-0.5 text-[10px] font-medium text-muted transition-colors hover:text-foreground disabled:opacity-50"
                  >
                    <X className="h-2.5 w-2.5" />
                    {scraperT.cancelEdit || "取消"}
                  </button>
                </div>
              </div>
            ) : (
              <div
                className={`group flex items-start gap-1 ${isAdmin ? "cursor-pointer" : ""}`}
                onClick={() => { if (isAdmin) { setTitleInput(item.title); setEditingTitle(true); } }}
                title={isAdmin ? (scraperT.editTitleHint || "点击编辑书名") : undefined}
              >
                <h4 className="text-base font-bold text-foreground leading-tight line-clamp-2 flex-1">{item.title}</h4>
                {isAdmin && (
                  <span className="opacity-0 group-hover:opacity-100 transition-opacity mt-0.5 flex-shrink-0">
                    <svg className="h-3.5 w-3.5 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </span>
                )}
              </div>
            )}
            {item.filename !== item.title && (
              <p className="text-xs text-muted/60 truncate" title={item.filename}>{item.filename}</p>
            )}

            {/* 元数据状态 badge */}
            {item.hasMetadata ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400">
                <CheckCircle className="h-3.5 w-3.5" />
                {item.metadataSource}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-400">
                <AlertCircle className="h-3.5 w-3.5" />
                {scraperT.detailNoMeta || "缺失元数据"}
              </span>
            )}

            {/* 类型 */}
            <span
              className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ${
                item.contentType === "novel"
                  ? "bg-blue-500/10 text-blue-400"
                  : "bg-orange-500/10 text-orange-400"
              }`}
            >
              {item.contentType === "novel" ? (
                <><BookOpen className="h-3 w-3" />{scraperT.libTypeNovel || "小说"}</>
              ) : (
                <><FileText className="h-3 w-3" />{scraperT.libTypeComic || "漫画"}</>
              )}
            </span>
          </div>
        </div>

        {/* 收藏 & 评分 — 仅管理员 */}
        {isAdmin && (
          <div className="flex items-center gap-3">
            <button
              onClick={handleToggleFavorite}
              className={`flex h-8 w-8 items-center justify-center rounded-lg transition-all ${
                localFavorite ? "bg-rose-500/20 text-rose-400" : "bg-card-hover text-muted hover:text-foreground"
              }`}
              title={t.comicDetail?.favorite || "收藏"}
            >
              <Heart className={`h-4 w-4 ${localFavorite ? "fill-rose-500" : ""}`} />
            </button>
            <div className="flex gap-0.5">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() => handleRating(star)}
                  className="p-0.5 transition-transform hover:scale-110"
                >
                  <Star
                    className={`h-5 w-5 ${
                      star <= localRating ? "fill-amber-400 text-amber-400" : "text-muted/30"
                    }`}
                  />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 保存成功提示 */}
        {metaSaveSuccess && (
          <div className="flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-3 py-1.5 text-[11px] text-emerald-400 animate-in fade-in slide-in-from-top-1 duration-200">
            <CheckCircle className="h-3 w-3" />
            已保存
          </div>
        )}

        {/* 元数据编辑模式 */}
        {metaEditMode && isAdmin ? (
          <div className="rounded-xl border border-accent/20 bg-accent/5 p-3 space-y-2">
            <div className="flex items-center gap-1.5 mb-1">
              <Pencil className="h-3 w-3 text-accent" />
              <span className="text-[11px] font-medium text-accent">元数据编辑</span>
              <span className="text-[10px] text-muted/50 ml-auto">点击字段即可编辑</span>
            </div>
            <DetailInlineEditField label="作者" value={item.author || ""} type="text" placeholder="输入作者名" saving={metaSaving} onSave={(v) => handleSaveMetaField("author", v)} />
            <DetailInlineEditField label="类型" value={item.genre || ""} type="text" placeholder="如：科幻, 冒险" saving={metaSaving} onSave={(v) => handleSaveMetaField("genre", v)} />
            <DetailInlineEditField label="年份" value={item.year ? String(item.year) : ""} type="number" placeholder="如：2002" saving={metaSaving} onSave={(v) => handleSaveMetaField("year", v)} />
            <DetailInlineEditField label="出版社" value={item.publisher || ""} type="text" placeholder="输入出版社" saving={metaSaving} onSave={(v) => handleSaveMetaField("publisher", v)} />
            <DetailInlineEditField label="语言" value={item.language || ""} type="text" placeholder="如：zh, ja, en" saving={metaSaving} onSave={(v) => handleSaveMetaField("language", v)} />
            <DetailInlineEditField label="简介" value={item.description || ""} type="textarea" placeholder="输入简介..." saving={metaSaving} onSave={(v) => handleSaveMetaField("description", v)} />
          </div>
        ) : (
          /* 元数据信息（只读模式） */
          <>
            {(item.hasMetadata || item.author || item.genre || item.year || item.description) && (
              <div className="space-y-2.5 rounded-xl bg-card-hover/30 p-3">
                {item.author && (
                  <div className="flex items-start gap-2">
                    <User className="h-3.5 w-3.5 text-muted mt-0.5 flex-shrink-0" />
                    <div className="text-xs text-foreground/80">{item.author}</div>
                  </div>
                )}
                {item.year && (
                  <div className="flex items-start gap-2">
                    <Clock className="h-3.5 w-3.5 text-muted mt-0.5 flex-shrink-0" />
                    <div className="text-xs text-foreground/80">{item.year}</div>
                  </div>
                )}
                {item.publisher && (
                  <div className="flex items-start gap-2">
                    <Database className="h-3.5 w-3.5 text-muted mt-0.5 flex-shrink-0" />
                    <div className="text-xs text-foreground/80">{item.publisher}</div>
                  </div>
                )}
                {item.language && (
                  <div className="flex items-start gap-2">
                    <Globe className="h-3.5 w-3.5 text-muted mt-0.5 flex-shrink-0" />
                    <div className="text-xs text-foreground/80">{item.language}</div>
                  </div>
                )}
                {item.genre && (
                  <div className="flex items-start gap-2">
                    <Bookmark className="h-3.5 w-3.5 text-muted mt-0.5 flex-shrink-0" />
                    <div className="flex flex-wrap gap-1">
                      {item.genre.split(",").map((g) => (
                        <span key={g.trim()} className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">{g.trim()}</span>
                      ))}
                    </div>
                  </div>
                )}
                {item.description && (
                  <div className="flex items-start gap-2">
                    <FileText className="h-3.5 w-3.5 text-muted mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-foreground/70 leading-relaxed line-clamp-4">{item.description}</p>
                  </div>
                )}
                {item.metadataSource && (
                  <div className="text-[10px] text-muted/50 pt-1">
                    {t.metadata?.metadataSource || "Source"}: {item.metadataSource}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* AI & 翻译工具栏 — 仅管理员 */}
        {isAdmin && !metaEditMode && (
          <div className="flex flex-wrap gap-1.5">
            {/* 翻译 */}
            <div className="relative">
              <div className="flex items-center gap-0">
                <button
                  onClick={() => handleTranslateMetadata()}
                  disabled={metadataTranslating}
                  className="flex items-center gap-1 rounded-l-md border border-r-0 border-border/40 bg-card/50 px-1.5 py-0.5 text-[10px] font-medium text-muted transition-all hover:text-foreground hover:border-border disabled:opacity-50"
                  title={t.metadata?.translateMetadata || "翻译元数据"}
                >
                  <Languages className="h-3 w-3" />
                  <span>{metadataTranslating ? (t.metadata?.translatingMetadata || "翻译中...") : (lastTranslateEngine ? `${t.metadata?.translateMetadata || "翻译"} (${lastTranslateEngine})` : (t.metadata?.translateMetadata || "翻译"))}</span>
                </button>
                <button
                  onClick={() => setShowEngineMenu(!showEngineMenu)}
                  disabled={metadataTranslating}
                  className="flex items-center rounded-r-md border border-border/40 bg-card/50 px-1 py-0.5 text-[10px] text-muted transition-all hover:text-foreground hover:border-border disabled:opacity-50"
                >
                  <ChevronDown className="h-3 w-3" />
                </button>
              </div>
              {showEngineMenu && (
                <div className="absolute top-full left-0 z-50 mt-1 min-w-[180px] rounded-lg border border-border bg-card shadow-lg">
                  <div className="p-1.5">
                    <div className="px-2 py-1 text-[10px] font-medium text-muted uppercase tracking-wider">翻译引擎</div>
                    {translateEngines.map(eng => (
                      <button
                        key={eng.id}
                        onClick={() => { setTranslateEngine(eng.id); handleTranslateMetadata(eng.id); }}
                        disabled={!eng.available}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[11px] text-foreground transition-colors hover:bg-card-hover disabled:opacity-40 disabled:pointer-events-none"
                      >
                        <span className="flex-1 text-left">{eng.name}</span>
                        <span className={`text-[9px] px-1 py-0.5 rounded ${eng.speed === 'instant' ? 'bg-green-500/15 text-green-400' : eng.speed === 'fast' ? 'bg-blue-500/15 text-blue-400' : 'bg-yellow-500/15 text-yellow-400'}`}>
                          {eng.speed === 'instant' ? '极快' : eng.speed === 'fast' ? '快' : '慢'}
                        </span>
                        {!eng.available && <span className="text-[9px] text-muted">未配置</span>}
                      </button>
                    ))}
                    <div className="mt-1 border-t border-border/40 pt-1">
                      <button
                        onClick={() => handleTranslateMetadata("")}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[11px] text-muted transition-colors hover:bg-card-hover"
                      >
                        <span>自动选择最优引擎</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
            {/* AI 功能按钮 */}
            {aiConfigured && (
              <>
                <button
                  onClick={handleAiSummary}
                  disabled={aiSummaryLoading}
                  className="flex items-center gap-1 rounded-md border border-purple-500/30 bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-medium text-purple-400 transition-all hover:bg-purple-500/20 disabled:opacity-50"
                  title={t.comicDetail?.aiSummary || "AI 简介"}
                >
                  {aiSummaryLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  <span>{aiSummaryLoading ? "生成中..." : (t.comicDetail?.aiSummary || "AI 简介")}</span>
                </button>
                <button
                  onClick={handleAiParseFilename}
                  disabled={aiParseLoading}
                  className="flex items-center gap-1 rounded-md border border-purple-500/30 bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-medium text-purple-400 transition-all hover:bg-purple-500/20 disabled:opacity-50"
                  title={t.comicDetail?.aiParseFilename || "AI 解析"}
                >
                  {aiParseLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
                  <span>{aiParseLoading ? "解析中..." : (t.comicDetail?.aiParseFilename || "AI 解析")}</span>
                </button>
                <button
                  onClick={handleAiAnalyzeCover}
                  disabled={aiCoverLoading}
                  className="flex items-center gap-1 rounded-md border border-purple-500/30 bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-medium text-purple-400 transition-all hover:bg-purple-500/20 disabled:opacity-50"
                  title={t.comicDetail?.aiAnalyzeCover || "AI 封面"}
                >
                  {aiCoverLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />}
                  <span>{aiCoverLoading ? "分析中..." : (t.comicDetail?.aiAnalyzeCover || "AI 封面")}</span>
                </button>
                <button
                  onClick={handleAiCompleteMetadata}
                  disabled={aiCompleteMetaLoading}
                  className="flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400 transition-all hover:bg-amber-500/20 disabled:opacity-50"
                  title={t.comicDetail?.aiCompleteMetadata || "AI 补全"}
                >
                  {aiCompleteMetaLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  <span>{aiCompleteMetaLoading ? "补全中..." : (t.comicDetail?.aiCompleteMetadata || "AI 补全")}</span>
                </button>
              </>
            )}
          </div>
        )}

        {/* AI 解析结果 */}
        {aiParsedResult && (
          <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-medium text-purple-400">
                <FileText className="h-3.5 w-3.5" />
                {t.comicDetail?.aiParseFilename || "AI 解析结果"}
              </div>
              <div className="flex gap-1.5">
                <button onClick={handleAiParseApply} className="rounded-md bg-purple-500/20 px-2 py-0.5 text-[10px] font-medium text-purple-300 hover:bg-purple-500/30">
                  {t.comicDetail?.aiParseApply || "应用"}
                </button>
                <button onClick={() => setAiParsedResult(null)} className="rounded-md px-1.5 py-0.5 text-[10px] text-muted hover:text-foreground">
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
            <div className="grid gap-1 text-[11px]">
              {Object.entries(aiParsedResult).filter(([, v]) => v != null && v !== "").map(([key, value]) => (
                <div key={key} className="flex gap-2">
                  <span className="w-16 shrink-0 text-muted">{key}:</span>
                  <span className="text-foreground">{String(value)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* AI 封面分析结果 */}
        {aiCoverResult && (
          <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-medium text-purple-400">
                <Eye className="h-3.5 w-3.5" />
                {t.comicDetail?.aiAnalyzeCoverResult || "封面分析结果"}
              </div>
              <div className="flex gap-1.5">
                <button onClick={handleAiCoverApply} className="rounded-md bg-purple-500/20 px-2 py-0.5 text-[10px] font-medium text-purple-300 hover:bg-purple-500/30">
                  {t.comicDetail?.aiParseApply || "应用"}
                </button>
                <button onClick={() => setAiCoverResult(null)} className="rounded-md px-1.5 py-0.5 text-[10px] text-muted hover:text-foreground">
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
            <div className="grid gap-1.5 text-[11px]">
              {!!(aiCoverResult as Record<string, unknown>).style && (
                <div className="flex gap-2"><span className="w-14 shrink-0 text-muted">风格:</span><span className="text-foreground">{String((aiCoverResult as Record<string, unknown>).style)}</span></div>
              )}
              {!!(aiCoverResult as Record<string, unknown>).mood && (
                <div className="flex gap-2"><span className="w-14 shrink-0 text-muted">氛围:</span><span className="text-foreground">{String((aiCoverResult as Record<string, unknown>).mood)}</span></div>
              )}
              {!!(aiCoverResult as Record<string, unknown>).theme && (
                <div className="flex gap-2"><span className="w-14 shrink-0 text-muted">主题:</span><span className="text-foreground">{String((aiCoverResult as Record<string, unknown>).theme)}</span></div>
              )}
              {!!(aiCoverResult as Record<string, unknown>).description && (
                <p className="mt-1 text-[11px] italic text-foreground/70">{String((aiCoverResult as Record<string, unknown>).description)}</p>
              )}
              {Array.isArray((aiCoverResult as Record<string, unknown>).tags) && ((aiCoverResult as Record<string, unknown>).tags as string[]).length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {((aiCoverResult as Record<string, unknown>).tags as string[]).map((tag: string) => (
                    <span key={tag} className="rounded bg-purple-500/15 px-1.5 py-0.5 text-[10px] text-purple-300">{tag}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 标签管理 — 仅管理员 */}
        {isAdmin && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted">{t.comicDetail?.tagsLabel || "标签"}</h4>
              {(item.tags || []).length > 0 && (
                <button
                  onClick={handleClearAllTags}
                  className="flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] text-muted transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-2.5 w-2.5" />
                  <span>{t.comicDetail?.clearAllTags || "清除全部"}</span>
                </button>
              )}
            </div>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {(item.tags || []).map((tg) => (
                <span
                  key={tg.name}
                  className="group/tag inline-flex items-center gap-0.5 rounded-lg px-2 py-1 text-[10px] font-medium bg-accent/15 text-accent"
                  style={{ backgroundColor: tg.color ? `${tg.color}20` : undefined, color: tg.color || undefined }}
                >
                  <Tag className="h-2.5 w-2.5" />
                  {tg.name}
                  <button
                    onClick={() => handleRemoveTag(tg.name)}
                    disabled={removingTag === tg.name}
                    className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-white/10 disabled:opacity-50"
                  >
                    {removingTag === tg.name ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <X className="h-2.5 w-2.5" />}
                  </button>
                </span>
              ))}
              {(item.tags || []).length === 0 && (
                <span className="text-[10px] text-muted">{t.comicDetail?.noTags || "暂无标签"}</span>
              )}
            </div>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddTag()}
                placeholder={t.comicDetail?.addTagPlaceholder || "添加标签..."}
                className="flex-1 rounded-lg bg-card-hover/60 px-2.5 py-1.5 text-[11px] text-foreground placeholder-muted/50 outline-none focus:ring-1 focus:ring-accent/50"
              />
              <button
                onClick={handleAddTag}
                disabled={!newTag.trim()}
                className="rounded-lg bg-accent/20 px-2 py-1.5 text-accent transition-colors hover:bg-accent/30 disabled:opacity-30"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
              {aiConfigured && (
                <button
                  onClick={handleAiSuggestTags}
                  disabled={aiSuggestLoading}
                  className="flex items-center gap-1 rounded-lg bg-purple-500/15 px-2 py-1.5 text-[10px] font-medium text-purple-400 transition-colors hover:bg-purple-500/25 disabled:opacity-50"
                  title={t.comicDetail?.aiSuggestTags || "AI 标签"}
                >
                  {aiSuggestLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Brain className="h-3 w-3" />}
                </button>
              )}
            </div>
            {/* AI 建议标签 */}
            {aiSuggestedTags.length > 0 && (
              <div className="mt-2 rounded-lg border border-purple-500/20 bg-purple-500/5 p-2.5">
                <div className="mb-1.5 flex items-center gap-1.5 text-[10px] text-purple-400">
                  <Sparkles className="h-3 w-3" />
                  <span>{t.comicDetail?.aiSuggestTags || "AI 建议标签"}</span>
                </div>
                <div className="mb-2 flex flex-wrap gap-1">
                  {aiSuggestedTags.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => {
                        const next = new Set(aiSelectedTags);
                        if (next.has(tag)) next.delete(tag); else next.add(tag);
                        setAiSelectedTags(next);
                      }}
                      className={`rounded-md px-1.5 py-0.5 text-[10px] transition-all ${
                        aiSelectedTags.has(tag)
                          ? "bg-purple-500/20 text-purple-300 ring-1 ring-purple-500/40"
                          : "bg-card text-muted hover:text-foreground"
                      }`}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => handleAddAiTags(Array.from(aiSelectedTags))}
                    disabled={aiSelectedTags.size === 0}
                    className="rounded-md bg-purple-500/20 px-2 py-0.5 text-[10px] font-medium text-purple-300 hover:bg-purple-500/30 disabled:opacity-40"
                  >
                    添加选中 ({aiSelectedTags.size})
                  </button>
                  <button
                    onClick={() => handleAddAiTags(aiSuggestedTags)}
                    className="rounded-md bg-card px-2 py-0.5 text-[10px] text-muted hover:text-foreground"
                  >
                    全部添加
                  </button>
                  <button
                    onClick={() => { setAiSuggestedTags([]); setAiSelectedTags(new Set()); }}
                    className="rounded-md px-1.5 py-0.5 text-[10px] text-muted hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 分类管理 — 仅管理员 */}
        {isAdmin && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted">{t.categoryFilter?.label || "分类"}</h4>
              <div className="flex items-center gap-1">
                {(item.categories || []).length > 0 && (
                  <button
                    onClick={handleClearAllCategories}
                    className="flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] text-muted transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                    <span>{t.comicDetail?.clearAllCategories || "清除全部"}</span>
                  </button>
                )}
                {aiConfigured && (
                  <button
                    onClick={handleAiSuggestCategory}
                    disabled={aiCategoryLoading}
                    className="flex items-center gap-0.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400 transition-all hover:bg-emerald-500/20 disabled:opacity-50"
                    title={t.comicDetail?.aiSuggestCategory || "AI 分类"}
                  >
                    {aiCategoryLoading ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Layers className="h-2.5 w-2.5" />}
                    <span>{aiCategoryLoading ? "分析中..." : (t.comicDetail?.aiSuggestCategory || "AI 分类")}</span>
                  </button>
                )}
              </div>
            </div>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {(item.categories || []).map((cat) => (
                <span
                  key={cat.slug}
                  className="flex items-center gap-1 rounded-lg bg-accent/15 px-2 py-1 text-[10px] font-medium text-accent"
                >
                  <span>{cat.icon}</span>
                  {cat.name}
                  <button
                    onClick={() => handleRemoveCategory(cat.slug)}
                    className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-white/10"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              ))}
              {(!item.categories || item.categories.length === 0) && (
                <span className="text-[10px] text-muted">{t.categoryFilter?.uncategorized || "未分类"}</span>
              )}
            </div>
            {showCategoryPicker ? (
              <div className="flex flex-wrap gap-1.5 rounded-lg bg-card-hover/30 p-2">
                {allCategories
                  .filter((cat: ApiCategory) => !item.categories?.some((c) => c.slug === cat.slug))
                  .map((cat: ApiCategory) => (
                    <button
                      key={cat.slug}
                      onClick={() => handleAddCategory(cat.slug)}
                      className="flex items-center gap-1 rounded-lg border border-border/60 px-2 py-1 text-[10px] font-medium text-foreground transition-colors hover:bg-accent/20 hover:border-accent/50 hover:text-accent"
                    >
                      <span>{cat.icon}</span>
                      <span>{cat.name}</span>
                    </button>
                  ))}
                <button
                  onClick={() => setShowCategoryPicker(false)}
                  className="rounded-lg bg-card px-2 py-1 text-[10px] text-muted hover:text-foreground"
                >
                  {t.common?.cancel || "取消"}
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowCategoryPicker(true)}
                className="flex items-center gap-1.5 rounded-lg bg-card-hover/40 px-3 py-2 text-[11px] text-foreground transition-colors hover:bg-card-hover"
              >
                <Layers className="h-3.5 w-3.5 text-muted" />
                <Plus className="h-3 w-3 text-muted" />
                <span className="text-[10px] text-muted">{t.comicDetail?.clickToEdit || "(点击添加)"}</span>
              </button>
            )}
          </div>
        )}

        {/* 分隔线 */}
        <div className="border-t border-border/20" />

        {/* 内嵌 MetadataSearch 组件 — 精准刮削 */}
        {isAdmin && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-accent" />
              <h4 className="text-sm font-semibold text-foreground">{scraperT.detailSearchTitle || "精准刮削"}</h4>
            </div>
            <p className="text-xs text-muted leading-relaxed">
              {scraperT.detailSearchDesc || "搜索在线数据源，选择最匹配的结果应用到此书"}
            </p>
            <MetadataSearch
              comicId={item.id}
              comicTitle={item.title}
              filename={item.filename}
              comicType={item.contentType}
              onApplied={() => {
                onRefresh();
                loadLibrary();
                loadStats();
                emitScrapeApplied(item.id, "scraper");
              }}
            />
          </div>
        )}
      </div>

      {/* 封面选择器模态框 */}
      {showCoverPicker && coverPickerPages > 0 && (
        <>
          <div className="fixed inset-0 z-50 bg-black/70 animate-backdrop-in" onClick={() => setShowCoverPicker(false)} />
          <div className="fixed inset-4 z-50 flex flex-col rounded-2xl bg-zinc-900 shadow-2xl animate-modal-in sm:inset-8 lg:inset-16">
            <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
              <h3 className="text-base font-semibold text-foreground">
                {t.comicDetail?.coverFromArchive || "从内页选择封面"}
              </h3>
              <button
                onClick={() => setShowCoverPicker(false)}
                className="rounded-lg p-1.5 text-muted hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
                {Array.from({ length: Math.min(coverPickerPages, 50) }, (_, i) => (
                  <button
                    key={i}
                    onClick={() => handleSelectCoverPage(i)}
                    disabled={coverLoading}
                    className="group/page relative aspect-[5/7] overflow-hidden rounded-lg border-2 border-transparent bg-zinc-800 transition-all hover:border-accent hover:shadow-lg"
                  >
                    <img
                      src={`/api/comics/${item.id}/page/${i}`}
                      alt={`Page ${i + 1}`}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover/page:bg-black/30">
                      <span className="rounded-full bg-black/60 px-2 py-0.5 text-xs font-medium text-white opacity-0 transition-opacity group-hover/page:opacity-100">
                        {i + 1}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
              {coverPickerPages > 50 && (
                <p className="mt-4 text-center text-xs text-muted">
                  {t.comicDetail?.coverPickerLimitMsg || `仅显示前 50 页，共 ${coverPickerPages} 页`}
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

