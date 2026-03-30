"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import LazyImage from "@/components/LazyImage";
import Link from "next/link";
import {
  useComicDetail,
  toggleComicFavorite,
  updateComicRating,
  addComicTags,
  removeComicTag,
  clearAllComicTags,
  deleteComicById,
  useCategories,
  addComicCategories,
  removeComicCategory,
  clearAllComicCategories,
  updateComicMetadata,
  ApiCategory,
} from "@/hooks/useComics";
import type { ComicMetadataUpdate } from "@/hooks/useComics";
import { useAuth } from "@/lib/auth-context";
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
  ChevronDown,
} from "lucide-react";
import { useTranslation, useLocale } from "@/lib/i18n";
import { MetadataSearch } from "@/components/MetadataSearch";
import { SimilarComics } from "@/components/Recommendations";
import { useAIStatus } from "@/hooks/useAIStatus";
import { fetchGroupedComicMap, fetchGroupDetail } from "@/api/groups";
import type { ComicGroupDetail, GroupComicItem } from "@/hooks/useComicTypes";
import { invalidateSwCache } from "@/lib/pwa";
import { invalidateComicsCache } from "@/hooks/useComicList";

function formatFileSize(bytes: number): string {
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
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  function formatDuration(seconds: number) {
    if (seconds < 60) return t.duration.seconds.replace("{n}", String(seconds));
    if (seconds < 3600) return t.duration.minutes.replace("{m}", String(Math.floor(seconds / 60))).replace("{s}", String(seconds % 60));
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return t.duration.hours.replace("{h}", String(h)).replace("{m}", String(m));
  }

  const { comic, loading, refetch } = useComicDetail(comicId);
  const { categories: allCategories, refetch: refetchCategories, initCategories } = useCategories();

  // 查询当前漫画所属的合集
  useEffect(() => {
    if (!comicId) return;
    let cancelled = false;
    const loadGroups = async () => {
      setGroupsLoading(true);
      try {
        const map = await fetchGroupedComicMap();
        const groupIds = map[comicId];
        if (!groupIds || groupIds.length === 0) {
          setComicGroups([]);
          return;
        }
        // 并行获取所有分组详情
        const details = await Promise.all(groupIds.map(id => fetchGroupDetail(id)));
        if (!cancelled) {
          setComicGroups(
            details.filter((d): d is ComicGroupDetail => d !== null).map(d => ({
              id: d.id,
              name: d.name,
              coverUrl: d.coverUrl,
              comicCount: d.comicCount,
              comics: d.comics,
            }))
          );
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setGroupsLoading(false);
      }
    };
    loadGroups();
    return () => { cancelled = true; };
  }, [comicId]);
  const [newTag, setNewTag] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteFilesOption, setDeleteFilesOption] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [showCoverMenu, setShowCoverMenu] = useState(false);
  const [coverUrlInput, setCoverUrlInput] = useState("");
  const [showCoverUrlInput, setShowCoverUrlInput] = useState(false);
  const [coverLoading, setCoverLoading] = useState(false);
  const [coverKey, setCoverKey] = useState(() => Date.now()); // unique per page load to bust SW cache
  const coverFileRef = useRef<HTMLInputElement>(null);
  const [showCoverPicker, setShowCoverPicker] = useState(false);
  const [coverPickerPages, setCoverPickerPages] = useState<number>(0);
  const [metadataTranslating, setMetadataTranslating] = useState(false);
  const [translateEngine, setTranslateEngine] = useState<string>("");
  const [showEngineMenu, setShowEngineMenu] = useState(false);
  const [translateEngines, setTranslateEngines] = useState<{id: string; name: string; available: boolean; speed: string; quality: string}[]>([]);
  const [lastTranslateEngine, setLastTranslateEngine] = useState<string>("");

  // AI 功能 state
  const { aiConfigured } = useAIStatus();

  // 合集信息 state
  const [comicGroups, setComicGroups] = useState<{ id: number; name: string; coverUrl: string; comicCount: number; comics: GroupComicItem[] }[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const [aiParseLoading, setAiParseLoading] = useState(false);
  const [aiParsedResult, setAiParsedResult] = useState<Record<string, unknown> | null>(null);
  const [aiSuggestLoading, setAiSuggestLoading] = useState(false);
  const [aiSuggestedTags, setAiSuggestedTags] = useState<string[]>([]);
  const [aiSelectedTags, setAiSelectedTags] = useState<Set<string>>(new Set());
  const [aiCoverLoading, setAiCoverLoading] = useState(false);
  const [aiCoverResult, setAiCoverResult] = useState<Record<string, unknown> | null>(null);
  const [aiCompleteMetaLoading, setAiCompleteMetaLoading] = useState(false);
  const [aiCategoryLoading, setAiCategoryLoading] = useState(false);
  const [aiSuggestedCategories, setAiSuggestedCategories] = useState<string[]>([]);

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

  // 一键清除所有标签
  const handleClearAllTags = useCallback(async () => {
    if (!comic?.tags || comic.tags.length === 0) return;
    if (!window.confirm(t.comicDetail.clearAllTagsConfirm)) return;
    await clearAllComicTags(comicId);
    refetch();
  }, [comic?.tags, comicId, refetch, t.comicDetail.clearAllTagsConfirm]);

  // 一键清除所有分类
  const handleClearAllCategories = useCallback(async () => {
    if (!comic?.categories || comic.categories.length === 0) return;
    if (!window.confirm(t.comicDetail.clearAllCategoriesConfirm)) return;
    await clearAllComicCategories(comicId);
    refetch();
    refetchCategories();
  }, [comic?.categories, comicId, refetch, refetchCategories, t.comicDetail.clearAllCategoriesConfirm]);

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
        invalidateSwCache(`/api/comics/${comicId}/thumbnail`);
        invalidateComicsCache();
        setCoverKey(Date.now());
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
        invalidateSwCache(`/api/comics/${comicId}/thumbnail`);
        invalidateComicsCache();
        setCoverKey(Date.now());
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
        invalidateSwCache(`/api/comics/${comicId}/thumbnail`);
        invalidateComicsCache();
        setCoverKey(Date.now());
        setShowCoverMenu(false);
      }
    } catch (err) {
      console.error("Cover reset failed:", err);
    } finally {
      setCoverLoading(false);
    }
  }, [comicId]);

  const handleOpenCoverPicker = useCallback(async () => {
    setShowCoverMenu(false);
    // Load page count from pages API
    try {
      const res = await fetch(`/api/comics/${comicId}/pages`);
      if (res.ok) {
        const data = await res.json();
        setCoverPickerPages(data.totalPages || 0);
        setShowCoverPicker(true);
      }
    } catch {
      // ignore
    }
  }, [comicId]);

  const handleSelectCoverPage = useCallback(async (pageIndex: number) => {
    setCoverLoading(true);
    try {
      const res = await fetch(`/api/comics/${comicId}/cover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageIndex }),
      });
      if (res.ok) {
        invalidateSwCache(`/api/comics/${comicId}/thumbnail`);
        invalidateComicsCache();
        setCoverKey(Date.now());
        setShowCoverPicker(false);
      }
    } catch (err) {
      console.error("Cover select failed:", err);
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
              invalidateSwCache(`/api/comics/${comicId}/thumbnail`);
              invalidateComicsCache();
              setCoverKey(Date.now());
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

  // AI 元数据补全
  const handleAiCompleteMetadata = useCallback(async () => {
    if (aiCompleteMetaLoading) return;
    setAiCompleteMetaLoading(true);
    try {
      const res = await fetch(`/api/comics/${comicId}/ai-complete-metadata`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetLang: locale, apply: true }),
      });
      if (res.ok) {
        refetch();
      }
    } catch {
      // ignore
    } finally {
      setAiCompleteMetaLoading(false);
    }
  }, [aiCompleteMetaLoading, comicId, locale, refetch]);

  // AI 分类建议
  const handleAiSuggestCategory = useCallback(async () => {
    if (aiCategoryLoading) return;
    setAiCategoryLoading(true);
    setAiSuggestedCategories([]);
    try {
      const res = await fetch("/api/ai/suggest-category", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comicId, targetLang: locale, apply: true }),
      });
      if (res.ok) {
        const data = await res.json();
        setAiSuggestedCategories(data.suggestedCategories || []);
        refetch();
      }
    } catch {
      // ignore
    } finally {
      setAiCategoryLoading(false);
    }
  }, [aiCategoryLoading, comicId, locale, refetch]);

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

  const handleTranslateMetadata = useCallback(async (engine?: string) => {
    if (metadataTranslating) return;
    setMetadataTranslating(true);
    setShowEngineMenu(false);
    try {
      const res = await fetch(`/api/comics/${comicId}/translate-metadata`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetLang: locale, engine: engine || translateEngine || "" }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.engine) setLastTranslateEngine(data.engine);
        refetch();
      }
    } catch {
      // ignore
    } finally {
      setMetadataTranslating(false);
    }
  }, [metadataTranslating, comicId, locale, refetch, translateEngine]);

  // 加载可用翻译引擎
  useEffect(() => {
    fetch("/api/translate/engines")
      .then(r => r.json())
      .then(data => {
        if (data.engines) setTranslateEngines(data.engines);
      })
      .catch(() => {});
  }, []);

  const handleDelete = useCallback(async () => {
    const result = await deleteComicById(comicId, deleteFilesOption);
    if (result.success) {
      router.push("/");
    } else {
      const msg = t.comicDetail?.deleteError || "删除失败：";
      alert(msg.replace("{{error}}", result.error || "Unknown error"));
    }
  }, [comicId, router, t, deleteFilesOption]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        {/* Header skeleton */}
        <div className="sticky top-0 z-50 border-b border-border/50 bg-background/70 backdrop-blur-xl">
          <div className="mx-auto flex h-14 sm:h-16 max-w-5xl items-center gap-3 sm:gap-4 px-3 sm:px-6">
            <div className="skeleton-shimmer h-9 w-9 rounded-lg" />
            <div className="skeleton-shimmer h-5 w-48 rounded-md" />
          </div>
        </div>
        <main className="mx-auto max-w-5xl px-3 sm:px-6 py-4 sm:py-8">
          <div className="grid gap-5 sm:gap-8 md:grid-cols-[280px_1fr]">
            {/* Cover skeleton */}
            <div className="space-y-3 sm:space-y-4 mx-auto w-full max-w-[240px] md:max-w-none">
              <div className="skeleton-shimmer aspect-[5/7] w-full rounded-xl" />
              <div className="skeleton-shimmer h-12 w-full rounded-xl" />
              <div className="skeleton-shimmer h-10 w-full rounded-xl" />
            </div>
            {/* Info skeleton */}
            <div className="space-y-6">
              {/* Title */}
              <div className="space-y-2">
                <div className="skeleton-shimmer h-7 w-3/4 rounded-md" />
                <div className="skeleton-shimmer h-4 w-1/2 rounded-md" />
              </div>
              {/* Rating */}
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="skeleton-shimmer h-7 w-7 rounded-md" />
                ))}
              </div>
              {/* Meta Info Grid */}
              <div className="grid grid-cols-2 gap-2.5 sm:gap-4 sm:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="rounded-xl bg-card p-3 sm:p-4 space-y-2">
                    <div className="skeleton-shimmer h-3 w-16 rounded" />
                    <div className="skeleton-shimmer h-5 w-12 rounded" />
                  </div>
                ))}
              </div>
              {/* Tags */}
              <div className="space-y-2">
                <div className="skeleton-shimmer h-3 w-12 rounded" />
                <div className="flex gap-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="skeleton-shimmer h-7 w-16 rounded-lg" />
                  ))}
                </div>
              </div>
              {/* Metadata */}
              <div className="space-y-2 rounded-xl bg-card p-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="skeleton-shimmer h-4 w-full rounded" />
                ))}
              </div>
            </div>
          </div>
        </main>
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
    <div className="min-h-screen bg-background overflow-x-hidden">
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
              <LazyImage
                src={`/api/comics/${comic.id}/thumbnail?v=${coverKey}`}
                alt={comic.title}
                wrapperClassName="absolute inset-0"
                className="h-full w-full object-cover"
                blurEffect={true}
              />
              {/* Cover overlay buttons */}
              <div className="absolute inset-0 flex items-end justify-center bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-100 sm:opacity-0 transition-opacity sm:group-hover:opacity-100">
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

                    {/* Select from archive pages (P4) */}
                    {!isNovelFile(comic.filename) && (
                    <button
                      onClick={handleOpenCoverPicker}
                      disabled={coverLoading}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-zinc-200 transition-colors hover:bg-zinc-700/60"
                    >
                      <Layers className="h-3.5 w-3.5" />
                      {t.comicDetail?.coverFromArchive || "从内页选择"}
                    </button>
                    )}

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
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3 text-sm font-medium text-white transition-all hover:bg-accent-hover hover:shadow-lg hover:shadow-accent/25 btn-press"
            >
              <Play className="h-4 w-4" />
              {comic.lastReadPage > 0 ? t.comicDetail.continueReading.replace("{page}", String(comic.lastReadPage + 1)) : t.comicDetail.startReading}
            </Link>

            {/* Delete */}
            {user?.role === "admin" && (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-500/30 py-2.5 text-sm text-red-400 transition-all hover:bg-red-500/10 btn-press"
            >
              <Trash2 className="h-4 w-4" />
              {t.comicDetail.deleteComic}
            </button>
            )}
          </div>

          {/* Info */}
          <div className="space-y-6">
            {/* Title & Favorite */}
              <div className="flex items-start justify-between gap-2 sm:gap-4">
              <div className="flex-1 min-w-0">
                {editingTitle ? (
                  <div className="flex items-center gap-2">
                    {isAdmin ? (
                    <>
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
                    </>
                    ) : (
                      <h2 className="text-xl sm:text-2xl font-bold text-foreground break-words line-clamp-2">{comic.title}</h2>
                    )}
                  </div>
                ) : (
                  <div className="group/title flex items-center gap-2 min-w-0">
                  <h2 className="text-xl sm:text-2xl font-bold text-foreground break-words line-clamp-2">{comic.title}</h2>
                    {isAdmin && (
                    <button
                      onClick={startEditTitle}
                      className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-muted/40 opacity-100 sm:opacity-0 transition-all hover:text-foreground sm:group-hover/title:opacity-100"
                      title={t.comicDetail.editTitle || "Edit Title"}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    )}
                  </div>
                )}
                <p className="mt-1 text-sm text-muted truncate">{comic.filename}</p>
              </div>
              {/* Favorite — 仅管理员可操作 */}
              {isAdmin && (
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
              )}
            </div>

            {/* Rating — 仅管理员可操作 */}
            {isAdmin && (
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
            )}

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

            {/* Collection / 合集信息 */}
            {comicGroups.length > 0 && comicGroups.map((group) => {
              // 当前漫画在合集中的位置
              const currentIdx = group.comics.findIndex(c => c.id === comicId);
              const totalComics = group.comics.length;
              const completedCount = group.comics.filter(c => c.pageCount > 0 && c.lastReadPage >= c.pageCount).length;
              const overallProgress = totalComics > 0 ? Math.round((completedCount / totalComics) * 100) : 0;
              // 上一卷/下一卷
              const prevComic = currentIdx > 0 ? group.comics[currentIdx - 1] : null;
              const nextComic = currentIdx >= 0 && currentIdx < totalComics - 1 ? group.comics[currentIdx + 1] : null;
              // 继续阅读的下一未读卷
              const nextUnread = group.comics.find(c => c.id !== comicId && c.pageCount > 0 && c.lastReadPage < c.pageCount);

              return (
                <div key={group.id} className="rounded-xl border border-border/40 bg-card/50 overflow-hidden">
                  {/* 合集头部 */}
                  <Link
                    href={`/group/${group.id}${comic?.type ? `?contentType=${comic.type}` : ''}`}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-card-hover"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10">
                      <Layers className="h-5 w-5 text-accent" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-semibold text-foreground truncate">{group.name}</h3>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted">{totalComics} {t.comicGroup?.volumes || "卷"}</span>
                        {currentIdx >= 0 && (
                          <span className="text-xs text-accent font-medium">
                            #{currentIdx + 1}
                          </span>
                        )}
                        <span className="text-xs text-muted">·</span>
                        <span className={`text-xs font-medium ${overallProgress >= 100 ? "text-emerald-400" : "text-muted"}`}>
                          {overallProgress}%
                        </span>
                      </div>
                    </div>
                    <ArrowLeft className="h-4 w-4 text-muted rotate-180" />
                  </Link>

                  {/* 合集进度条 */}
                  <div className="px-4 pb-3">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/15">
                      <div
                        className={`h-full rounded-full transition-all ${overallProgress >= 100 ? "bg-emerald-400" : "bg-accent"}`}
                        style={{ width: `${Math.min(overallProgress, 100)}%` }}
                      />
                    </div>
                  </div>

                  {/* 前后卷快捷导航 */}
                  {(prevComic || nextComic) && (
                    <div className="flex items-center gap-2 border-t border-border/30 px-4 py-2.5">
                      {prevComic ? (
                        <Link
                          href={isNovelFile(prevComic.filename) ? `/novel/${prevComic.id}` : `/comic/${prevComic.id}`}
                          className="flex flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors hover:bg-card-hover"
                        >
                          <ArrowLeft className="h-3 w-3 text-muted flex-shrink-0" />
                          <span className="truncate text-muted hover:text-foreground">{prevComic.title}</span>
                        </Link>
                      ) : <div className="flex-1" />}
                      {nextComic ? (
                        <Link
                          href={isNovelFile(nextComic.filename) ? `/novel/${nextComic.id}` : `/comic/${nextComic.id}`}
                          className="flex flex-1 items-center justify-end gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors hover:bg-card-hover"
                        >
                          <span className="truncate text-muted hover:text-foreground text-right">{nextComic.title}</span>
                          <ArrowLeft className="h-3 w-3 text-muted rotate-180 flex-shrink-0" />
                        </Link>
                      ) : <div className="flex-1" />}
                    </div>
                  )}

                  {/* 连续阅读提示 */}
                  {nextUnread && nextUnread.id !== (nextComic?.id) && (
                    <div className="border-t border-border/30 px-4 py-2.5">
                      <Link
                        href={isNovelFile(nextUnread.filename) ? `/novel/${nextUnread.id}` : `/reader/${nextUnread.id}`}
                        className="flex items-center gap-2 text-xs text-accent transition-colors hover:text-accent-hover"
                      >
                        <Play className="h-3 w-3" />
                        <span>{t.comicGroup?.continueReading || "继续阅读"}: {nextUnread.title}</span>
                      </Link>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Tags — 仅管理员可编辑 */}
            {isAdmin && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-xs font-medium uppercase tracking-wider text-muted">{t.comicDetail.tagsLabel}</h3>
                {(comic.tags || []).length > 0 && (
                  <button
                    onClick={handleClearAllTags}
                    className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] text-muted transition-colors hover:bg-destructive/10 hover:text-destructive"
                    title={t.comicDetail.clearAllTags}
                  >
                    <Trash2 className="h-3 w-3" />
                    <span>{t.comicDetail.clearAllTags}</span>
                  </button>
                )}
              </div>
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
            )}

            {/* Categories — 仅管理员可编辑 */}
            {isAdmin && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-xs font-medium uppercase tracking-wider text-muted">
                  {t.categoryFilter?.label || "分类"}
                </h3>
                {(comic.categories || []).length > 0 && (
                  <button
                    onClick={handleClearAllCategories}
                    className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] text-muted transition-colors hover:bg-destructive/10 hover:text-destructive"
                    title={t.comicDetail.clearAllCategories}
                  >
                    <Trash2 className="h-3 w-3" />
                    <span>{t.comicDetail.clearAllCategories}</span>
                  </button>
                )}
              </div>
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
            )}


            {/* Metadata Info */}
            <div>
                  <div className="mb-3 flex flex-wrap items-center gap-1.5 sm:gap-2">
                <h3 className="text-xs font-medium uppercase tracking-wider text-muted">
                  {t.metadata?.metadataSource || "Metadata"}
                </h3>
                {!editingMetadata && isAdmin && (
                  <>
                    <button
                      onClick={startEditMetadata}
                      className="flex items-center gap-1 rounded-md border border-border/40 bg-card/50 px-1.5 py-0.5 text-[10px] font-medium text-muted transition-all hover:text-foreground hover:border-border"
                      title={t.metadata?.editMetadata || "Edit"}
                    >
                      <Pencil className="h-3 w-3" />
                      <span>{t.metadata?.editMetadata || "Edit"}</span>
                    </button>
                    <div className="relative">
                      <div className="flex items-center gap-0">
                        <button
                          onClick={() => handleTranslateMetadata()}
                          disabled={metadataTranslating}
                          className="flex items-center gap-1 rounded-l-md border border-r-0 border-border/40 bg-card/50 px-1.5 py-0.5 text-[10px] font-medium text-muted transition-all hover:text-foreground hover:border-border disabled:opacity-50 disabled:pointer-events-none"
                          title={t.metadata?.translateMetadata || "Translate Metadata"}
                        >
                          <Languages className="h-3 w-3" />
                          <span>{metadataTranslating ? (t.metadata?.translatingMetadata || "Translating...") : (lastTranslateEngine ? `${t.metadata?.translateMetadata || "Translate"} (${lastTranslateEngine})` : (t.metadata?.translateMetadata || "Translate"))}</span>
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
                    {aiConfigured && (
                      <button
                        onClick={handleAiCompleteMetadata}
                        disabled={aiCompleteMetaLoading}
                        className="flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400 transition-all hover:bg-amber-500/20 hover:border-amber-500/50 disabled:opacity-50 disabled:pointer-events-none"
                        title={t.comicDetail.aiCompleteMetadata || "AI 元数据补全"}
                      >
                        {aiCompleteMetaLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                        <span>{aiCompleteMetaLoading ? (t.comicDetail.aiCompleteMetadataLoading || "补全中...") : (t.comicDetail.aiCompleteMetadata || "AI 补全")}</span>
                      </button>
                    )}
                    {aiConfigured && (
                      <button
                        onClick={handleAiSuggestCategory}
                        disabled={aiCategoryLoading}
                        className="flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400 transition-all hover:bg-emerald-500/20 hover:border-emerald-500/50 disabled:opacity-50 disabled:pointer-events-none"
                        title={t.comicDetail.aiSuggestCategory || "AI 自动分类"}
                      >
                        {aiCategoryLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Layers className="h-3 w-3" />}
                        <span>{aiCategoryLoading ? (t.comicDetail.aiSuggestCategoryLoading || "分析中...") : (t.comicDetail.aiSuggestCategory || "AI 分类")}</span>
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
              ) : (comic.author || comic.description || comic.publisher || comic.year || comic.genre) ? (
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
                      <span className="w-20 sm:w-24 shrink-0 text-muted">{key}:</span>
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
          <div className="fixed inset-0 z-50 bg-black/60 animate-backdrop-in" onClick={() => setShowDeleteConfirm(false)} />
          <div className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-96 -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-zinc-900 p-5 sm:p-6 shadow-2xl animate-modal-in">
            <h3 className="text-lg font-semibold text-foreground">{t.comicDetail.confirmDelete}</h3>
            <p className="mt-2 text-sm text-muted">
              {t.comicDetail.confirmDeleteMsg.replace("{title}", comic.title)}
            </p>
            {/* Delete mode options */}
            <div className="mt-4 space-y-2">
              <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border/60 p-3 transition-colors hover:bg-card/80" onClick={() => setDeleteFilesOption(false)}>
                <div className={`h-4 w-4 rounded-full border-2 flex items-center justify-center ${!deleteFilesOption ? "border-accent" : "border-muted/50"}`}>
                  {!deleteFilesOption && <div className="h-2 w-2 rounded-full bg-accent" />}
                </div>
                <div>
                  <div className="text-sm font-medium text-foreground">{t.comicDetail?.deleteRecordOnly || "仅移除记录"}</div>
                  <div className="text-xs text-muted">{t.comicDetail?.deleteRecordOnlyDesc || "从书库移除，保留磁盘文件"}</div>
                </div>
              </label>
              <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-red-500/30 p-3 transition-colors hover:bg-red-500/5" onClick={() => setDeleteFilesOption(true)}>
                <div className={`h-4 w-4 rounded-full border-2 flex items-center justify-center ${deleteFilesOption ? "border-red-500" : "border-muted/50"}`}>
                  {deleteFilesOption && <div className="h-2 w-2 rounded-full bg-red-500" />}
                </div>
                <div>
                  <div className="text-sm font-medium text-red-400">{t.comicDetail?.deleteWithFiles || "同时删除文件"}</div>
                  <div className="text-xs text-muted">{t.comicDetail?.deleteWithFilesDesc || "从书库移除并删除磁盘上的文件，不可恢复"}</div>
                </div>
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => { setShowDeleteConfirm(false); setDeleteFilesOption(false); }}
                className="rounded-lg bg-card px-4 py-2 text-sm text-foreground"
              >
                {t.common.cancel}
              </button>
              <button
                onClick={handleDelete}
                className={`rounded-lg px-4 py-2 text-sm font-medium text-white ${deleteFilesOption ? "bg-red-600 hover:bg-red-700" : "bg-red-500 hover:bg-red-600"}`}
              >
                {deleteFilesOption ? (t.comicDetail?.deleteWithFiles || "删除文件") : t.comicDetail.confirmDelete}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Cover Picker Modal (P4) */}
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
                    className="group relative aspect-[5/7] overflow-hidden rounded-lg border-2 border-transparent bg-zinc-800 transition-all hover:border-accent hover:shadow-lg"
                  >
                    <img
                      src={`/api/comics/${comicId}/page/${i}`}
                      alt={`Page ${i + 1}`}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/30">
                      <span className="rounded-full bg-black/60 px-2 py-0.5 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
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
