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
  updateComicGroup,
  useCategories,
  addComicCategories,
  removeComicCategory,
  ApiCategory,
} from "@/hooks/useComics";
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
  FolderOpen,
  Layers,
  Trash2,
  Play,
  User,
  Globe,
  Database,
  ImagePlus,
  RefreshCw,
  Download,
} from "lucide-react";
import { useTranslation, useLocale } from "@/lib/i18n";
import { MetadataSearch } from "@/components/MetadataSearch";
import { SimilarComics } from "@/components/Recommendations";

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
  const [editingGroup, setEditingGroup] = useState(false);
  const [groupInput, setGroupInput] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [showCoverMenu, setShowCoverMenu] = useState(false);
  const [coverUrlInput, setCoverUrlInput] = useState("");
  const [showCoverUrlInput, setShowCoverUrlInput] = useState(false);
  const [coverLoading, setCoverLoading] = useState(false);
  const [coverKey, setCoverKey] = useState(0); // force re-render cover image
  const coverFileRef = useRef<HTMLInputElement>(null);

  // Auto-init categories on first load
  useEffect(() => {
    if (allCategories.length === 0) {
      initCategories(locale);
    }
  }, [allCategories.length, initCategories, locale]);

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

  const handleSaveGroup = useCallback(async () => {
    await updateComicGroup(comicId, groupInput.trim());
    setEditingGroup(false);
    refetch();
  }, [comicId, groupInput, refetch]);

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
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-4 px-6">
          <button
            onClick={() => router.back()}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 text-muted transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="truncate text-lg font-bold text-foreground">{comic.title}</h1>
        </div>
      </div>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="grid gap-8 md:grid-cols-[280px_1fr]">
          {/* Cover */}
          <div className="space-y-4">
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
              href={`/reader/${comic.id}`}
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
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-foreground">{comic.title}</h2>
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
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div className="rounded-xl bg-card p-4">
                <div className="flex items-center gap-2 text-muted">
                  <BookOpen className="h-4 w-4" />
                  <span className="text-xs">{t.comicDetail.pages}</span>
                </div>
                <p className="mt-1 text-lg font-semibold text-foreground">{comic.pageCount}</p>
              </div>

              <div className="rounded-xl bg-card p-4">
                <div className="flex items-center gap-2 text-muted">
                  <HardDrive className="h-4 w-4" />
                  <span className="text-xs">{t.comicDetail.fileSize}</span>
                </div>
                <p className="mt-1 text-lg font-semibold text-foreground">
                  {formatFileSize(comic.fileSize)}
                </p>
              </div>

              <div className="rounded-xl bg-card p-4">
                <div className="flex items-center gap-2 text-muted">
                  <Calendar className="h-4 w-4" />
                  <span className="text-xs">{t.comicDetail.addedAt}</span>
                </div>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {new Date(comic.addedAt).toLocaleDateString(locale)}
                </p>
              </div>

              <div className="rounded-xl bg-card p-4">
                <div className="flex items-center gap-2 text-muted">
                  <Clock className="h-4 w-4" />
                  <span className="text-xs">{t.comicDetail.readTime}</span>
                </div>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {formatDuration(comic.totalReadTime || 0)}
                </p>
              </div>

              <div className="rounded-xl bg-card p-4">
                <div className="flex items-center gap-2 text-muted">
                  <BookOpen className="h-4 w-4" />
                  <span className="text-xs">{t.comicDetail.readProgress}</span>
                </div>
                <p className="mt-1 text-lg font-semibold text-foreground">{progress}%</p>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted/20">
                  <div
                    className="h-full rounded-full bg-accent transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>

              {comic.lastReadAt && (
                <div className="rounded-xl bg-card p-4">
                  <div className="flex items-center gap-2 text-muted">
                    <Clock className="h-4 w-4" />
                    <span className="text-xs">{t.comicDetail.lastRead}</span>
                  </div>
                  <p className="mt-1 text-sm font-semibold text-foreground">
                    {new Date(comic.lastReadAt).toLocaleString(locale)}
                  </p>
                </div>
              )}
            </div>

            {/* Tags */}
            <div>
              <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">{t.comicDetail.tagsLabel}</h3>
              <div className="mb-3 flex flex-wrap gap-2">
                {comic.tags.map((tag) => (
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
                {comic.tags.length === 0 && (
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
              </div>
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

            {/* Group */}
            <div>
              <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">{t.comicDetail.groupLabel}</h3>
              {editingGroup ? (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={groupInput}
                    onChange={(e) => setGroupInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSaveGroup()}
                    placeholder={t.comicDetail.groupInputPlaceholder}
                    className="flex-1 rounded-lg bg-card px-3 py-2 text-sm text-foreground placeholder-muted/50 outline-none focus:ring-1 focus:ring-accent/50"
                    autoFocus
                  />
                  <button
                    onClick={handleSaveGroup}
                    className="rounded-lg bg-accent px-3 py-2 text-sm text-white"
                  >
                    {t.common.save}
                  </button>
                  <button
                    onClick={() => setEditingGroup(false)}
                    className="rounded-lg bg-card px-3 py-2 text-sm text-muted"
                  >
                    {t.common.cancel}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setGroupInput(comic.groupName || "");
                    setEditingGroup(true);
                  }}
                  className="flex items-center gap-2 rounded-lg bg-card px-4 py-2.5 text-sm text-foreground transition-colors hover:bg-card-hover"
                >
                  <FolderOpen className="h-4 w-4 text-muted" />
                  {comic.groupName || t.comicDetail.ungrouped} 
                  <span className="text-xs text-muted">{t.comicDetail.clickToEdit}</span>
                </button>
              )}
            </div>

            {/* Metadata Info */}
            {(comic.author || comic.description || comic.publisher || comic.year || comic.genre || comic.seriesName) && (
              <div>
                <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">
                  {t.metadata?.metadataSource || "Metadata"}
                </h3>
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
          <div className="fixed left-1/2 top-1/2 z-50 w-80 -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-zinc-900 p-6 shadow-2xl">
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
