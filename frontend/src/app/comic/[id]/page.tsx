"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import {
  useComicDetail,
  toggleComicFavorite,
  updateComicRating,
  addComicTags,
  removeComicTag,
  deleteComicById,
  useCategories,
  addComicCategories,
  removeComicCategory,
  updateComicMetadata,
  ApiCategory,
} from "@/hooks/useComics";
import type { ComicMetadataUpdate } from "@/hooks/useComics";
import {
  ArrowLeft,
  Heart,
  Star,
  Tag,
  X,
  Plus,
  BookOpen,
  Clock,
  HardDrive,
  Calendar,
  Layers,
  Trash2,
  Play,
  User,
  Globe,
  Database,
  ImagePlus,
  RefreshCw,
  Download,
  Languages,
  Pencil,
  Check,
  Save,
  Brain,
  Sparkles,
  FileText,
  Loader2,
  Eye,
} from "lucide-react";
import { useTranslation, useLocale } from "@/lib/i18n";
import { MetadataSearch } from "@/components/MetadataSearch";
import { SimilarComics } from "@/components/Recommendations";
import { useAIStatus } from "@/hooks/useAIStatus";

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isNovelFile(filename?: string): boolean {
  if (!filename) return false;
  const ext = filename.toLowerCase();
  return ext.endsWith(".txt") || ext.endsWith(".epub") || ext.endsWith(".mobi") || ext.endsWith(".azw3") || ext.endsWith(".html") || ext.endsWith(".htm");
}

export default function ComicDetailPage() {
  const params = useParams();
  const router = useRouter();
  const comicId = params.id as string;
  const t = useTranslation();
  const { locale } = useLocale();

  function formatDuration(seconds: number) {
    if (seconds < 60) return t.duration.seconds.replace("{n}", String(seconds));
    if (seconds < 3600) return t.duration.minutes.replace("{m}", String(Math.floor(seconds / 60))).replace("{s}", String(seconds % 60));
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return t.duration.hours.replace("{h}", String(h)).replace("{m}", String(m));
  }

  const { comic, loading, refetch } = useComicDetail(comicId);
  const { categories: allCategories, refetch: refetchCategories, initCategories } = useCategories();
  const [newTag, setNewTag] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [showCoverMenu, setShowCoverMenu] = useState(false);
  const [coverUrlInput, setCoverUrlInput] = useState("");
  const [showCoverUrlInput, setShowCoverUrlInput] = useState(false);
  const [coverLoading, setCoverLoading] = useState(false);
  const [coverKey, setCoverKey] = useState(0); // force re-render cover image
  const coverFileRef = useRef<HTMLInputElement>(null);
  const [metadataTranslating, setMetadataTranslating] = useState(false);

  // AI 功能 state
  const { aiConfigured } = useAIStatus();
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const [aiParseLoading, setAiParseLoading] = useState(false);
  const [aiParsedResult, setAiParsedResult] = useState<Record<string, unknown> | null>(null);
  const [aiSuggestLoading, setAiSuggestLoading] = useState(false);
  const [aiSuggestedTags, setAiSuggestedTags] = useState<string[]>([]);
  const [aiSelectedTags, setAiSelectedTags] = useState<Set<string>>(new Set());
  const [aiCoverLoading, setAiCoverLoading] = useState(false);
  const [aiCoverResult, setAiCoverResult] = useState<Record<string, unknown> | null>(null);

  // 标题编辑 state
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState("");
  const [titleSaving, setTitleSaving] = useState(false);

  // 元数据编辑 state
  const [editingMetadata, setEditingMetadata] = useState(false);
  const [metaForm, setMetaForm] = useState<ComicMetadataUpdate>({});
  const [metaSaving, setMetaSaving] = useState(false);

  // Auto-init categories on first load
  useEffect(() => {
    if (allCategories.length === 0) {
      initCategories(locale);
    }
  }, [allCategories.length, initCategories, locale]);

  // 开始编辑标题
  const startEditTitle = useCallback(() => {
    if (comic) {
      setTitleInput(comic.title);
      setEditingTitle(true);
    }
  }, [comic]);

  // 保存标题
  const handleSaveTitle = useCallback(async () => {
    if (!titleInput.trim() || titleInput.trim() === comic?.title) {
      setEditingTitle(false);
      return;
    }
    setTitleSaving(true);
    try {
      const ok = await updateComicMetadata(comicId, { title: titleInput.trim() });
      if (ok) refetch();
    } finally {
      setTitleSaving(false);
      setEditingTitle(false);
    }
  }, [titleInput, comic?.title, comicId, refetch]);

  // 开始编辑元数据
  const startEditMetadata = useCallback(() => {
    if (comic) {
      setMetaForm({
        author: comic.author || "",
        publisher: comic.publisher || "",
        year: comic.year ?? undefined,
        description: comic.description || "",
        language: comic.language || "",
        genre: comic.genre || "",
        seriesName: comic.seriesName || "",
        seriesIndex: comic.seriesIndex ?? undefined,
      });
      setEditingMetadata(true);
    }
  }, [comic]);

  // 保存元数据
  const handleSaveMetadata = useCallback(async () => {
    setMetaSaving(true);
    try {
      const ok = await updateComicMetadata(comicId, metaForm);
      if (ok) {
        refetch();
        setEditingMetadata(false);
      }
    } finally {
      setMetaSaving(false);
    }
  }, [comicId, metaForm, refetch]);

  const handleToggleFavorite = useCallback(async () => {
    await toggleComicFavorite(comicId);
    refetch();
  }, [comicId, refetch]);

  const handleRating = useCallback(
    async (newRating: number) => {
      const r = newRating === comic?.rating ? null : newRating;
      await updateComicRating(comicId, r);
      refetch();
    },
    [comicId, comic?.rating, refetch]
  );

  const handleAddTag = useCallback(async () => {
    if (!newTag.trim()) return;
    await addComicTags(comicId, [newTag.trim()]);
    setNewTag("");
    refetch();
  }, [comicId, newTag, refetch]);

  const handleRemoveTag = useCallback(
    async (tagName: string) => {
      await removeComicTag(comicId, tagName);
      refetch();
    },
    [comicId, refetch]
  );

  const handleAddCategory = useCallback(async (slug: string) => {
    await addComicCategories(comicId, [slug]);
    setShowCategoryPicker(false);
    refetch();
    refetchCategories();
  }, [comicId, refetch, refetchCategories]);

  const handleRemoveCategory = useCallback(async (slug: string) => {
    await removeComicCategory(comicId, slug);
    refetch();
    refetchCategories();
  }, [comicId, refetch, refetchCategories]);

  // Cover management handlers
  const handleCoverUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCoverLoading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/comics/${comicId}/cover`, { method: "POST", body: formData });
      if (res.ok) {
        setCoverKey((k) => k + 1);
        setShowCoverMenu(false);
      }
    } catch (err) {
      console.error("Cover upload failed:", err);
    } finally {
      setCoverLoading(false);
      if (coverFileRef.current) coverFileRef.current.value = "";
    }
  }, [comicId]);

  const handleCoverFromUrl = useCallback(async () => {
    if (!coverUrlInput.trim()) return;
    setCoverLoading(true);
    try {
      const res = await fetch(`/api/comics/${comicId}/cover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: coverUrlInput.trim() }),
      });
      if (res.ok) {
        setCoverKey((k) => k + 1);
        setShowCoverUrlInput(false);
        setCoverUrlInput("");
        setShowCoverMenu(false);
      }
    } catch (err) {
      console.error("Cover fetch failed:", err);
    } finally {
      setCoverLoading(false);
    }
  }, [comicId, coverUrlInput]);

  const handleCoverReset = useCallback(async () => {
    setCoverLoading(true);
    try {
      const res = await fetch(`/api/comics/${comicId}/cover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset: true }),
      });
      if (res.ok) {
        setCoverKey((k) => k + 1);
        setShowCoverMenu(false);
      }
    } catch (err) {
      console.error("Cover reset failed:", err);
    } finally {
      setCoverLoading(false);
    }
  }, [comicId]);

  const handleCoverFromPlatform = useCallback(async () => {
    if (!comic) return;
    setCoverLoading(true);
    setShowCoverMenu(false);
    try {
      // Use metadata search to find cover from platforms
      const res = await fetch("/api/metadata/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: comic.title,
          sources: ["anilist", "bangumi", "mangadex", "kitsu"],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const results = data.results || [];
        // Find the first result with a cover URL
        for (const r of results) {
          if (r.coverUrl) {
            const coverRes = await fetch(`/api/comics/${comicId}/cover`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: r.coverUrl }),
            });
            if (coverRes.ok) {
              setCoverKey((k) => k + 1);
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
  }, [comic, comicId]);

  // AI 生成简介
  const handleAiSummary = useCallback(async () => {
    if (aiSummaryLoading) return;
    setAiSummaryLoading(true);
    try {
      const res = await fetch(`/api/comics/${comicId}/ai-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetLang: locale }),
      });
      if (res.ok) {
        refetch();
      }
    } catch {
      // ignore
    } finally {
      setAiSummaryLoading(false);
    }
  }, [aiSummaryLoading, comicId, locale, refetch]);

  // AI 解析文件名
  const handleAiParseFilename = useCallback(async () => {
    if (aiParseLoading) return;
    setAiParseLoading(true);
    setAiParsedResult(null);
    try {
      const res = await fetch(`/api/comics/${comicId}/ai-parse-filename`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply: false }),
      });
      if (res.ok) {
        const data = await res.json();
        setAiParsedResult(data.parsed);
      }
    } catch {
      // ignore
    } finally {
      setAiParseLoading(false);
    }
  }, [aiParseLoading, comicId]);

  // AI 解析文件名 - 应用结果
  const handleAiParseApply = useCallback(async () => {
    try {
      const res = await fetch(`/api/comics/${comicId}/ai-parse-filename`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply: true }),
      });
      if (res.ok) {
        setAiParsedResult(null);
        refetch();
      }
    } catch {
      // ignore
    }
  }, [comicId, refetch]);

  // AI 建议标签
  const handleAiSuggestTags = useCallback(async () => {
    if (aiSuggestLoading) return;
    setAiSuggestLoading(true);
    setAiSuggestedTags([]);
    setAiSelectedTags(new Set());
    try {
      const res = await fetch(`/api/comics/${comicId}/ai-suggest-tags`, {
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
    } catch {
      // ignore
    } finally {
      setAiSuggestLoading(false);
    }
  }, [aiSuggestLoading, comicId, locale]);

  // 添加 AI 建议的标签
  const handleAddAiTags = useCallback(async (tags: string[]) => {
    if (tags.length === 0) return;
    await addComicTags(comicId, tags);
    setAiSuggestedTags([]);
    setAiSelectedTags(new Set());
    refetch();
  }, [comicId, refetch]);

  // AI 封面分析
  const handleAiAnalyzeCover = useCallback(async () => {
    if (aiCoverLoading) return;
    setAiCoverLoading(true);
    setAiCoverResult(null);
    try {
      const res = await fetch(`/api/comics/${comicId}/ai-analyze-cover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetLang: locale, apply: false }),
      });
      if (res.ok) {
        const data = await res.json();
        setAiCoverResult(data.analysis);
      }
    } catch {
      // ignore
    } finally {
      setAiCoverLoading(false);
    }
  }, [aiCoverLoading, comicId, locale]);

  // AI 封面分析 - 应用结果
  const handleAiCoverApply = useCallback(async () => {
    try {
      const res = await fetch(`/api/comics/${comicId}/ai-analyze-cover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetLang: locale, apply: true }),
      });
      if (res.ok) {
        setAiCoverResult(null);
        refetch();
      }
    } catch {
      // ignore
    }
  }, [comicId, locale, refetch]);

  const handleTranslateMetadata = useCallback(async () => {
    if (metadataTranslating) return;
    setMetadataTranslating(true);
    try {
      const res = await fetch(`/api/comics/${comicId}/translate-metadata`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetLang: locale }),
      });
      if (res.ok) {
        refetch();
      }
    } catch {
      // ignore
    } finally {
      setMetadataTranslating(false);
    }
  }, [metadataTranslating, comicId, locale, refetch]);

  const handleDelete = useCallback(async () => {
    const success = await deleteComicById(comicId);
    if (success) {
      router.push("/");
    }
  }, [comicId, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-accent" />
      </div>
    );
  }

  if (!comic) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-lg font-medium text-foreground">{t.comicDetail.comicNotFound}</p>
          <Link href="/" className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-sm text-white">
            {t.comicDetail.backToShelf}
          </Link>
        </div>
      </div>
    );
  }

  const progress = comic.pageCount > 0 ? Math.round((comic.lastReadPage / comic.pageCount) * 100) : 0;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-50 border-b border-border/50 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex h-14 sm:h-16 max-w-5xl items-center gap-3 sm:gap-4 px-3 sm:px-6">
          <button
            onClick={() => router.back()}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 text-muted transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="truncate text-lg font-bold text-foreground">{comic.title}</h1>
        </div>
      </div>

      <main className="mx-auto max-w-5xl px-3 sm:px-6 py-4 sm:py-8 pb-20 sm:pb-8">
        <div className="grid gap-5 sm:gap-8 md:grid-cols-[280px_1fr]">
          {/* Cover */}
          <div className="space-y-3 sm:space-y-4 mx-auto w-full max-w-[240px] md:max-w-none">
            <div className="group relative aspect-[5/7] w-full overflow-hidden rounded-xl bg-card shadow-2xl">
              <Image
                src={`/api/comics/${comic.id}/thumbnail?v=${coverKey}`}
                alt={comic.title}
                fill
                unoptimized
                className="object-cover"
                sizes="280px"
              />
              {/* Cover overlay buttons */}
              <div className="absolute inset-0 flex items-end justify-center bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  onClick={() => setShowCoverMenu(!showCoverMenu)}
                  disabled={coverLoading}
                  className="mb-3 flex items-center gap-1.5 rounded-lg bg-white/20 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/30"
                >
                  {coverLoading ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ImagePlus className="h-3.5 w-3.5" />
                  )}
                  {t.comicDetail.changeCover || "更换封面"}
                </button>
              </div>

              {/* Cover menu dropdown */}
              {showCoverMenu && (
                <div className="absolute bottom-0 left-0 right-0 z-10 rounded-b-xl bg-zinc-900/95 p-3 backdrop-blur-sm">
                  <div className="space-y-1.5">
                    {/* Upload local image */}
                    <button
                      onClick={() => coverFileRef.current?.click()}
                      disabled={coverLoading}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-zinc-200 transition-colors hover:bg-zinc-700/60"
                    >
                      <ImagePlus className="h-3.5 w-3.5" />
                      {t.comicDetail.uploadCover || "上传本地图片"}
                    </button>

                    {/* Fetch from URL */}
                    <button
                      onClick={() => setShowCoverUrlInput(!showCoverUrlInput)}
                      disabled={coverLoading}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-zinc-200 transition-colors hover:bg-zinc-700/60"
                    >
                      <Globe className="h-3.5 w-3.5" />
                      {t.comicDetail.coverFromUrl || "输入图片URL"}
                    </button>

                    {showCoverUrlInput && (
                      <div className="flex gap-1.5 px-1">
                        <input
                          type="text"
                          value={coverUrlInput}
                          onChange={(e) => setCoverUrlInput(e.target.value)}
                          placeholder="https://..."
                          className="flex-1 rounded-md bg-zinc-800 px-2 py-1.5 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-accent"
                          onKeyDown={(e) => e.key === "Enter" && handleCoverFromUrl()}
                        />
                        <button
                          onClick={handleCoverFromUrl}
                          disabled={coverLoading || !coverUrlInput.trim()}
                          className="rounded-md bg-accent px-2 py-1.5 text-xs text-white disabled:opacity-50"
                        >
                          OK
                        </button>
                      </div>
                    )}

                    {/* Fetch from platform */}
                    <button
                      onClick={handleCoverFromPlatform}
                      disabled={coverLoading}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-zinc-200 transition-colors hover:bg-zinc-700/60"
                    >
                      <Download className="h-3.5 w-3.5" />
                      {t.comicDetail.coverFromPlatform || "从漫画平台获取"}
                    </button>

                    {/* Reset to default */}
                    <button
                      onClick={handleCoverReset}
                      disabled={coverLoading}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-zinc-200 transition-colors hover:bg-zinc-700/60"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      {t.comicDetail.resetCover || "恢复默认封面"}
                    </button>
                  </div>
                  <button
                    onClick={() => { setShowCoverMenu(false); setShowCoverUrlInput(false); }}
                    className="mt-2 w-full rounded-lg py-1.5 text-xs text-zinc-400 transition-colors hover:text-zinc-200"
                  >
                    {t.common.cancel}
                  </button>
                </div>
              )}
            </div>

            {/* Hidden file input */}
            <input
              ref={coverFileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleCoverUpload}
            />

            {/* Read Button */}
            <Link
              href={isNovelFile(comic.filename) ? `/novel/${comic.id}` : `/reader/${comic.id}`}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3 text-sm font-medium text-white transition-all hover:bg-accent-hover hover:shadow-lg hover:shadow-accent/25"
            >
              <Play className="h-4 w-4" />
              {comic.lastReadPage > 0 ? t.comicDetail.continueReading.replace("{page}", String(comic.lastReadPage + 1)) : t.comicDetail.startReading}
            </Link>

            {/* Delete */}
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-500/30 py-2.5 text-sm text-red-400 transition-all hover:bg-red-500/10"
            >
              <Trash2 className="h-4 w-4" />
              {t.comicDetail.deleteComic}
            </button>
          </div>

          {/* Info */}
          <div className="space-y-6">
            {/* Title & Favorite */}
              <div className="flex items-start justify-between gap-2 sm:gap-4">
              <div className="flex-1 min-w-0">
                {editingTitle ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={titleInput}
                      onChange={(e) => setTitleInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveTitle();
                        if (e.key === "Escape") setEditingTitle(false);
                      }}
                      autoFocus
                      className="flex-1 rounded-lg bg-card px-3 py-1.5 text-2xl font-bold text-foreground outline-none ring-1 ring-accent/50"
                    />
                    <button
                      onClick={handleSaveTitle}
                      disabled={titleSaving}
                      className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/20 text-accent transition-colors hover:bg-accent/30"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setEditingTitle(false)}
                      className="flex h-9 w-9 items-center justify-center rounded-lg bg-card text-muted transition-colors hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <div className="group/title flex items-center gap-2">
                  <h2 className="text-xl sm:text-2xl font-bold text-foreground truncate">{comic.title}</h2>
                    <button
                      onClick={startEditTitle}
                      className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-muted/40 opacity-0 transition-all hover:text-foreground group-hover/title:opacity-100"
                      title={t.comicDetail.editTitle || "Edit Title"}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                <p className="mt-1 text-sm text-muted">{comic.filename}</p>
              </div>
              <button
                onClick={handleToggleFavorite}
                className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg transition-all ${
                  comic.isFavorite
                    ? "bg-rose-500/20 text-rose-400"
                    : "bg-card text-muted hover:text-foreground"
                }`}
              >
                <Heart className={`h-5 w-5 ${comic.isFavorite ? "fill-rose-500" : ""}`} />
              </button>
            </div>

            {/* Rating */}
            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">{t.comicDetail.rating}</h3>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    onClick={() => handleRating(star)}
                    className="p-0.5 transition-transform hover:scale-110"
                  >
                    <Star
                      className={`h-7 w-7 ${
                        star <= (comic.rating || 0)
                          ? "fill-amber-400 text-amber-400"
                          : "text-muted/30"
                      }`}
                    />
                  </button>
                ))}
              </div>
            </div>

            {/* Meta Info Grid */}
            <div className="grid grid-cols-2 gap-2.5 sm:gap-4 sm:grid-cols-3">
              <div className="rounded-xl bg-card p-3 sm:p-4">
                <div className="flex items-center gap-1.5 sm:gap-2 text-muted">
                  <BookOpen className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  <span className="text-[11px] sm:text-xs">{t.comicDetail.pages}</span>
                </div>
                <p className="mt-1 text-base sm:text-lg font-semibold text-foreground">{comic.pageCount}</p>
              </div>

              <div className="rounded-xl bg-card p-3 sm:p-4">
                <div className="flex items-center gap-1.5 sm:gap-2 text-muted">
                  <HardDrive className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  <span className="text-[11px] sm:text-xs">{t.comicDetail.fileSize}</span>
                </div>
                <p className="mt-1 text-base sm:text-lg font-semibold text-foreground">
                  {formatFileSize(comic.fileSize)}
                </p>
              </div>

              <div className="rounded-xl bg-card p-3 sm:p-4">
                <div className="flex items-center gap-1.5 sm:gap-2 text-muted">
                  <Calendar className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  <span className="text-[11px] sm:text-xs">{t.comicDetail.addedAt}</span>
                </div>
                <p className="mt-1 text-xs sm:text-sm font-semibold text-foreground">
                  {new Date(comic.addedAt).toLocaleDateString(locale)}
                </p>
              </div>

              <div className="rounded-xl bg-card p-3 sm:p-4">
                <div className="flex items-center gap-1.5 sm:gap-2 text-muted">
                  <Clock className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  <span className="text-[11px] sm:text-xs">{t.comicDetail.readTime}</span>
                </div>
                <p className="mt-1 text-xs sm:text-sm font-semibold text-foreground">
                  {formatDuration(comic.totalReadTime || 0)}
                </p>
              </div>

              <div className="rounded-xl bg-card p-3 sm:p-4">
                <div className="flex items-center gap-1.5 sm:gap-2 text-muted">
                  <BookOpen className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  <span className="text-[11px] sm:text-xs">{t.comicDetail.readProgress}</span>
                </div>
                <p className="mt-1 text-base sm:text-lg font-semibold text-foreground">{progress}%</p>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted/20">
                  <div
                    className="h-full rounded-full bg-accent transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>

              {comic.lastReadAt && (
                <div className="rounded-xl bg-card p-3 sm:p-4">
                  <div className="flex items-center gap-1.5 sm:gap-2 text-muted">
                    <Clock className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                    <span className="text-[11px] sm:text-xs">{t.comicDetail.lastRead}</span>
                  </div>
                  <p className="mt-1 text-xs sm:text-sm font-semibold text-foreground">
                    {new Date(comic.lastReadAt).toLocaleString(locale)}
                  </p>
                </div>
              )}
            </div>

            {/* Tags */}
            <div>
              <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">{t.comicDetail.tagsLabel}</h3>
              <div className="mb-3 flex flex-wrap gap-2">
                {(comic.tags || []).map((tag) => (
                  <span
                    key={tag.name}
                    className="flex items-center gap-1.5 rounded-lg bg-accent/15 px-3 py-1.5 text-xs font-medium text-accent"
                  >
                    <Tag className="h-3 w-3" />
                    {tag.name}
                    <button
                      onClick={() => handleRemoveTag(tag.name)}
                      className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-white/10"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                {(comic.tags || []).length === 0 && (
                  <span className="text-xs text-muted">{t.comicDetail.noTags}</span>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddTag()}
                  placeholder={t.comicDetail.addTagPlaceholder}
                  className="flex-1 rounded-lg bg-card px-3 py-2 text-sm text-foreground placeholder-muted/50 outline-none focus:ring-1 focus:ring-accent/50"
                />
                <button
                  onClick={handleAddTag}
                  disabled={!newTag.trim()}
                  className="rounded-lg bg-accent/20 px-3 py-2 text-accent transition-colors hover:bg-accent/30 disabled:opacity-30"
                >
                  <Plus className="h-4 w-4" />
                </button>
                {aiConfigured && (
                  <button
                    onClick={handleAiSuggestTags}
                    disabled={aiSuggestLoading}
                    className="flex items-center gap-1.5 rounded-lg bg-purple-500/15 px-3 py-2 text-xs font-medium text-purple-400 transition-colors hover:bg-purple-500/25 disabled:opacity-50"
                    title={t.comicDetail.aiSuggestTags || "AI Suggest Tags"}
                  >
                    {aiSuggestLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Brain className="h-3.5 w-3.5" />}
                    <span className="hidden sm:inline">{aiSuggestLoading ? (t.comicDetail.aiSuggestTagsLoading || "Analyzing...") : (t.comicDetail.aiSuggestTags || "AI Tags")}</span>
                  </button>
                )}
              </div>

              {/* AI 建议标签展示 */}
              {aiSuggestedTags.length > 0 && (
                <div className="mt-3 rounded-lg border border-purple-500/20 bg-purple-500/5 p-3">
                  <div className="mb-2 flex items-center gap-2 text-xs text-purple-400">
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>{t.comicDetail.aiSuggestTags || "AI Suggested Tags"}</span>
                  </div>
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    {aiSuggestedTags.map((tag) => (
                      <button
                        key={tag}
                        onClick={() => {
                          const next = new Set(aiSelectedTags);
                          if (next.has(tag)) next.delete(tag); else next.add(tag);
                          setAiSelectedTags(next);
                        }}
                        className={`rounded-md px-2 py-1 text-xs transition-all ${
                          aiSelectedTags.has(tag)
                            ? "bg-purple-500/20 text-purple-300 ring-1 ring-purple-500/40"
                            : "bg-card text-muted hover:text-foreground"
                        }`}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleAddAiTags(Array.from(aiSelectedTags))}
                      disabled={aiSelectedTags.size === 0}
                      className="rounded-md bg-purple-500/20 px-3 py-1 text-xs font-medium text-purple-300 transition-colors hover:bg-purple-500/30 disabled:opacity-40"
                    >
                      {t.comicDetail.aiAddSelected || "Add Selected"} ({aiSelectedTags.size})
                    </button>
                    <button
                      onClick={() => handleAddAiTags(aiSuggestedTags)}
                      className="rounded-md bg-card px-3 py-1 text-xs text-muted transition-colors hover:text-foreground"
                    >
                      {t.comicDetail.aiAddAll || "Add All"}
                    </button>
                    <button
                      onClick={() => { setAiSuggestedTags([]); setAiSelectedTags(new Set()); }}
                      className="rounded-md px-2 py-1 text-xs text-muted hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Categories */}
            <div>
              <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
                {t.categoryFilter?.label || "分类"}
              </h3>
              <div className="mb-3 flex flex-wrap gap-2">
                {comic.categories?.map((cat) => (
                  <span
                    key={cat.slug}
                    className="flex items-center gap-1.5 rounded-lg bg-accent/15 px-3 py-1.5 text-xs font-medium text-accent"
                  >
                    <span>{cat.icon}</span>
                    {cat.name}
                    <button
                      onClick={() => handleRemoveCategory(cat.slug)}
                      className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-white/10"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                {(!comic.categories || comic.categories.length === 0) && (
                  <span className="text-xs text-muted">{t.categoryFilter?.uncategorized || "未分类"}</span>
                )}
              </div>
              {showCategoryPicker ? (
                <div className="flex flex-wrap gap-2 rounded-xl bg-card p-3">
                  {allCategories
                    .filter((cat: ApiCategory) => !comic.categories?.some((c) => c.slug === cat.slug))
                    .map((cat: ApiCategory) => (
                      <button
                        key={cat.slug}
                        onClick={() => handleAddCategory(cat.slug)}
                        className="flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent/20 hover:border-accent/50 hover:text-accent"
                      >
                        <span>{cat.icon}</span>
                        <span>{cat.name}</span>
                      </button>
                    ))}
                  <button
                    onClick={() => setShowCategoryPicker(false)}
                    className="rounded-lg bg-card px-3 py-1.5 text-xs text-muted hover:text-foreground"
                  >
                    {t.common.cancel}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowCategoryPicker(true)}
                  className="flex items-center gap-2 rounded-lg bg-card px-4 py-2.5 text-sm text-foreground transition-colors hover:bg-card-hover"
                >
                  <Layers className="h-4 w-4 text-muted" />
                  <Plus className="h-3 w-3 text-muted" />
                  <span className="text-xs text-muted">{t.comicDetail?.clickToEdit || "(点击添加)"}</span>
                </button>
              )}
            </div>


            {/* Metadata Info */}
            <div>
                  <div className="mb-3 flex flex-wrap items-center gap-1.5 sm:gap-2">
                <h3 className="text-xs font-medium uppercase tracking-wider text-muted">
                  {t.metadata?.metadataSource || "Metadata"}
                </h3>
                {!editingMetadata && (
                  <>
                    <button
                      onClick={startEditMetadata}
                      className="flex items-center gap-1 rounded-md border border-border/40 bg-card/50 px-1.5 py-0.5 text-[10px] font-medium text-muted transition-all hover:text-foreground hover:border-border"
                      title={t.metadata?.editMetadata || "Edit"}
                    >
                      <Pencil className="h-3 w-3" />
                      <span>{t.metadata?.editMetadata || "Edit"}</span>
                    </button>
                    <button
                      onClick={handleTranslateMetadata}
                      disabled={metadataTranslating}
                      className="flex items-center gap-1 rounded-md border border-border/40 bg-card/50 px-1.5 py-0.5 text-[10px] font-medium text-muted transition-all hover:text-foreground hover:border-border disabled:opacity-50 disabled:pointer-events-none"
                      title={t.metadata?.translateMetadata || "Translate Metadata"}
                    >
                      <Languages className="h-3 w-3" />
                      <span>{metadataTranslating ? (t.metadata?.translatingMetadata || "Translating...") : (t.metadata?.translateMetadata || "Translate")}</span>
                    </button>
                    {aiConfigured && (
                      <button
                        onClick={handleAiSummary}
                        disabled={aiSummaryLoading}
                        className="flex items-center gap-1 rounded-md border border-purple-500/30 bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-medium text-purple-400 transition-all hover:bg-purple-500/20 hover:border-purple-500/50 disabled:opacity-50 disabled:pointer-events-none"
                        title={t.comicDetail.aiSummary || "AI Summary"}
                      >
                        {aiSummaryLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                        <span>{aiSummaryLoading ? (t.comicDetail.aiSummaryGenerating || "Generating...") : (t.comicDetail.aiSummary || "AI Summary")}</span>
                      </button>
                    )}
                    {aiConfigured && (
                      <button
                        onClick={handleAiParseFilename}
                        disabled={aiParseLoading}
                        className="flex items-center gap-1 rounded-md border border-purple-500/30 bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-medium text-purple-400 transition-all hover:bg-purple-500/20 hover:border-purple-500/50 disabled:opacity-50 disabled:pointer-events-none"
                        title={t.comicDetail.aiParseFilename || "AI Parse Filename"}
                      >
                        {aiParseLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
                        <span>{aiParseLoading ? (t.comicDetail.aiParseFilenameLoading || "Parsing...") : (t.comicDetail.aiParseFilename || "AI Parse")}</span>
                      </button>
                    )}
                    {aiConfigured && (
                      <button
                        onClick={handleAiAnalyzeCover}
                        disabled={aiCoverLoading}
                        className="flex items-center gap-1 rounded-md border border-purple-500/30 bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-medium text-purple-400 transition-all hover:bg-purple-500/20 hover:border-purple-500/50 disabled:opacity-50 disabled:pointer-events-none"
                        title={t.comicDetail.aiAnalyzeCover || "AI Analyze Cover"}
                      >
                        {aiCoverLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />}
                        <span>{aiCoverLoading ? (t.comicDetail.aiAnalyzeCoverLoading || "Analyzing...") : (t.comicDetail.aiAnalyzeCover || "AI Cover")}</span>
                      </button>
                    )}
                  </>
                )}
              </div>

              {editingMetadata ? (
                /* 元数据编辑表单 */
                <div className="space-y-3 rounded-xl bg-card p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs text-muted">{t.metadata?.author || "Author"}</label>
                      <input type="text" value={metaForm.author || ""} onChange={(e) => setMetaForm({ ...metaForm, author: e.target.value })} className="w-full rounded-lg bg-background px-3 py-1.5 text-sm text-foreground outline-none ring-1 ring-border/60 focus:ring-accent/50" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-muted">{t.metadata?.publisher || "Publisher"}</label>
                      <input type="text" value={metaForm.publisher || ""} onChange={(e) => setMetaForm({ ...metaForm, publisher: e.target.value })} className="w-full rounded-lg bg-background px-3 py-1.5 text-sm text-foreground outline-none ring-1 ring-border/60 focus:ring-accent/50" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-muted">{t.metadata?.year || "Year"}</label>
                      <input type="number" value={metaForm.year ?? ""} onChange={(e) => setMetaForm({ ...metaForm, year: e.target.value ? Number(e.target.value) : undefined })} className="w-full rounded-lg bg-background px-3 py-1.5 text-sm text-foreground outline-none ring-1 ring-border/60 focus:ring-accent/50" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-muted">{t.metadata?.language || "Language"}</label>
                      <input type="text" value={metaForm.language || ""} onChange={(e) => setMetaForm({ ...metaForm, language: e.target.value })} className="w-full rounded-lg bg-background px-3 py-1.5 text-sm text-foreground outline-none ring-1 ring-border/60 focus:ring-accent/50" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-muted">{t.metadata?.series || "Series"}</label>
                      <input type="text" value={metaForm.seriesName || ""} onChange={(e) => setMetaForm({ ...metaForm, seriesName: e.target.value })} className="w-full rounded-lg bg-background px-3 py-1.5 text-sm text-foreground outline-none ring-1 ring-border/60 focus:ring-accent/50" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-muted">{t.metadata?.seriesIndex || "Volume"}</label>
                      <input type="number" value={metaForm.seriesIndex ?? ""} onChange={(e) => setMetaForm({ ...metaForm, seriesIndex: e.target.value ? Number(e.target.value) : undefined })} className="w-full rounded-lg bg-background px-3 py-1.5 text-sm text-foreground outline-none ring-1 ring-border/60 focus:ring-accent/50" />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-muted">{t.metadata?.genre || "Genre"}</label>
                    <input type="text" value={metaForm.genre || ""} onChange={(e) => setMetaForm({ ...metaForm, genre: e.target.value })} placeholder="Action, Fantasy, ..." className="w-full rounded-lg bg-background px-3 py-1.5 text-sm text-foreground outline-none ring-1 ring-border/60 focus:ring-accent/50" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-muted">{t.metadata?.description || "Description"}</label>
                    <textarea value={metaForm.description || ""} onChange={(e) => setMetaForm({ ...metaForm, description: e.target.value })} rows={4} className="w-full resize-none rounded-lg bg-background px-3 py-1.5 text-sm text-foreground outline-none ring-1 ring-border/60 focus:ring-accent/50" />
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      onClick={() => setEditingMetadata(false)}
                      className="rounded-lg bg-card px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground"
                    >
                      {t.comicDetail.cancelEdit || "Cancel"}
                    </button>
                    <button
                      onClick={handleSaveMetadata}
                      disabled={metaSaving}
                      className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
                    >
                      <Save className="h-3.5 w-3.5" />
                      {metaSaving ? "..." : (t.comicDetail.saveMetadata || "Save")}
                    </button>
                  </div>
                </div>
              ) : (comic.author || comic.description || comic.publisher || comic.year || comic.genre || comic.seriesName) ? (
                /* 元数据只读展示 */
                <div className="space-y-2 rounded-xl bg-card p-4">
                  {comic.author && (
                    <div className="flex items-center gap-2 text-sm">
                      <User className="h-4 w-4 text-muted" />
                      <span className="text-muted">{t.metadata?.author || "Author"}:</span>
                      <span className="text-foreground">{comic.author}</span>
                    </div>
                  )}
                  {comic.publisher && (
                    <div className="flex items-center gap-2 text-sm">
                      <Database className="h-4 w-4 text-muted" />
                      <span className="text-muted">{t.metadata?.publisher || "Publisher"}:</span>
                      <span className="text-foreground">{comic.publisher}</span>
                    </div>
                  )}
                  {comic.year && (
                    <div className="flex items-center gap-2 text-sm">
                      <Calendar className="h-4 w-4 text-muted" />
                      <span className="text-muted">{t.metadata?.year || "Year"}:</span>
                      <span className="text-foreground">{comic.year}</span>
                    </div>
                  )}
                  {comic.seriesName && (
                    <div className="flex items-center gap-2 text-sm">
                      <BookOpen className="h-4 w-4 text-muted" />
                      <span className="text-muted">{t.metadata?.series || "Series"}:</span>
                      <span className="text-foreground">
                        {comic.seriesName}
                        {comic.seriesIndex != null && ` #${comic.seriesIndex}`}
                      </span>
                    </div>
                  )}
                  {comic.language && (
                    <div className="flex items-center gap-2 text-sm">
                      <Globe className="h-4 w-4 text-muted" />
                      <span className="text-muted">{t.metadata?.language || "Language"}:</span>
                      <span className="text-foreground">{comic.language}</span>
                    </div>
                  )}
                  {comic.genre && (
                    <div className="flex items-start gap-2 text-sm">
                      <Tag className="h-4 w-4 text-muted mt-0.5" />
                      <span className="text-muted">{t.metadata?.genre || "Genre"}:</span>
                      <div className="flex flex-wrap gap-1">
                        {comic.genre.split(",").map((g: string) => (
                          <span key={g} className="rounded bg-accent/10 px-1.5 py-0.5 text-xs text-accent">
                            {g.trim()}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {comic.description && (
                    <div className="mt-2 text-sm text-muted leading-relaxed">
                      {comic.description}
                    </div>
                  )}
                  {comic.metadataSource && (
                    <div className="mt-1 text-xs text-muted/60">
                      {t.metadata?.metadataSource || "Source"}: {comic.metadataSource}
                    </div>
                  )}
                </div>
              ) : (
                /* 无元数据时显示提示 */
                <div className="rounded-xl bg-card p-4 text-center text-sm text-muted">
                  {t.comicDetail.noMetadata || "No metadata"}
                  <button
                    onClick={startEditMetadata}
                    className="ml-2 text-accent hover:underline"
                  >
                    {t.metadata?.editMetadata || "Edit"}
                  </button>
                </div>
              )}
            </div>

            {/* AI 解析结果展示 */}
            {aiParsedResult && (
              <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium text-purple-400">
                    <FileText className="h-4 w-4" />
                    {t.comicDetail.aiParseFilename || "AI Parsed Filename"}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleAiParseApply}
                      className="rounded-md bg-purple-500/20 px-3 py-1 text-xs font-medium text-purple-300 transition-colors hover:bg-purple-500/30"
                    >
                      {t.comicDetail.aiParseApply || "Apply Results"}
                    </button>
                    <button
                      onClick={() => setAiParsedResult(null)}
                      className="rounded-md px-2 py-1 text-xs text-muted hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="grid gap-1.5 text-xs">
                  {Object.entries(aiParsedResult).filter(([, v]) => v != null && v !== "").map(([key, value]) => (
                    <div key={key} className="flex gap-2">
                      <span className="w-24 shrink-0 text-muted">{key}:</span>
                      <span className="text-foreground">{String(value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* AI 封面分析结果展示 */}
            {aiCoverResult && (
              <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium text-purple-400">
                    <Eye className="h-4 w-4" />
                    {t.comicDetail.aiAnalyzeCoverResult || "Cover Analysis Result"}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleAiCoverApply}
                      className="rounded-md bg-purple-500/20 px-3 py-1 text-xs font-medium text-purple-300 transition-colors hover:bg-purple-500/30"
                    >
                      {t.comicDetail.aiParseApply || "Apply Results"}
                    </button>
                    <button
                      onClick={() => setAiCoverResult(null)}
                      className="rounded-md px-2 py-1 text-xs text-muted hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="grid gap-2 text-xs sm:grid-cols-2">
                  {!!(aiCoverResult as Record<string, unknown>).style && (
                    <div className="flex gap-2">
                      <span className="w-20 shrink-0 text-muted">{t.comicDetail.aiCoverStyle || "Style"}:</span>
                      <span className="text-foreground">{String((aiCoverResult as Record<string, unknown>).style)}</span>
                    </div>
                  )}
                  {!!(aiCoverResult as Record<string, unknown>).mood && (
                    <div className="flex gap-2">
                      <span className="w-20 shrink-0 text-muted">{t.comicDetail.aiCoverMood || "Mood"}:</span>
                      <span className="text-foreground">{String((aiCoverResult as Record<string, unknown>).mood)}</span>
                    </div>
                  )}
                  {!!(aiCoverResult as Record<string, unknown>).theme && (
                    <div className="flex gap-2">
                      <span className="w-20 shrink-0 text-muted">{t.comicDetail.aiCoverTheme || "Theme"}:</span>
                      <span className="text-foreground">{String((aiCoverResult as Record<string, unknown>).theme)}</span>
                    </div>
                  )}
                  {!!(aiCoverResult as Record<string, unknown>).ageRating && (
                    <div className="flex gap-2">
                      <span className="w-20 shrink-0 text-muted">{t.comicDetail.aiCoverAgeRating || "Rating"}:</span>
                      <span className="text-foreground">{String((aiCoverResult as Record<string, unknown>).ageRating)}</span>
                    </div>
                  )}
                  {!!(aiCoverResult as Record<string, unknown>).colorTone && (
                    <div className="flex gap-2">
                      <span className="w-20 shrink-0 text-muted">{t.comicDetail.aiCoverColorTone || "Color"}:</span>
                      <span className="text-foreground">{String((aiCoverResult as Record<string, unknown>).colorTone)}</span>
                    </div>
                  )}
                  {!!(aiCoverResult as Record<string, unknown>).confidence && (
                    <div className="flex gap-2">
                      <span className="w-20 shrink-0 text-muted">{t.comicDetail.aiCoverConfidence || "Conf."}:</span>
                      <span className="text-foreground">{String((aiCoverResult as Record<string, unknown>).confidence)}</span>
                    </div>
                  )}
                </div>
                {!!(aiCoverResult as Record<string, unknown>).characters && (
                  <div className="mt-2 text-xs">
                    <span className="text-muted">{t.comicDetail.aiCoverCharacters || "Characters"}: </span>
                    <span className="text-foreground">{String((aiCoverResult as Record<string, unknown>).characters)}</span>
                  </div>
                )}
                {!!(aiCoverResult as Record<string, unknown>).description && (
                  <div className="mt-2 text-xs italic text-foreground/70">
                    {String((aiCoverResult as Record<string, unknown>).description)}
                  </div>
                )}
                {Array.isArray((aiCoverResult as Record<string, unknown>).tags) && ((aiCoverResult as Record<string, unknown>).tags as string[]).length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {((aiCoverResult as Record<string, unknown>).tags as string[]).map((tag: string) => (
                      <span key={tag} className="rounded bg-purple-500/15 px-1.5 py-0.5 text-[10px] text-purple-300">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Metadata Scraping */}
            <div>
              <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
                {t.metadata?.scrapeMetadata || "Scrape Metadata"}
              </h3>
              <MetadataSearch
                comicId={comic.id}
                comicTitle={comic.title}
                filename={comic.filename}
                onApplied={() => refetch()}
              />
            </div>

            {/* Similar Comics */}
            <SimilarComics comicId={comic.id} />
          </div>
        </div>
      </main>

      {/* Delete Confirm Modal */}
      {showDeleteConfirm && (
        <>
          <div className="fixed inset-0 z-50 bg-black/60" onClick={() => setShowDeleteConfirm(false)} />
          <div className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-80 -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-zinc-900 p-5 sm:p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-foreground">{t.comicDetail.confirmDelete}</h3>
            <p className="mt-2 text-sm text-muted">
              {t.comicDetail.confirmDeleteMsg.replace("{title}", comic.title)}
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="rounded-lg bg-card px-4 py-2 text-sm text-foreground"
              >
                {t.common.cancel}
              </button>
              <button
                onClick={handleDelete}
                className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white"
              >
                {t.comicDetail.confirmDelete}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
