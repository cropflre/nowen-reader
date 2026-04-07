"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  BookOpen,
  GripVertical,
  Trash2,
  Edit3,
  Clock,
  FileText,
  X,
  Check,
  Plus,
  Download,
  User,
  Calendar,
  Globe,
  Tag,
  Layers,
  MoreHorizontal,
  RefreshCw,
  ArrowDownToLine,
  Loader2,
  AlertTriangle,
  Copy,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { useToast } from "@/components/Toast";
import { useAuth } from "@/lib/auth-context";
import {
  fetchGroupDetail,
  updateGroup,
  deleteGroup,
  removeComicFromGroup,
  reorderGroupComics,
  addComicsToGroup,
  updateGroupMetadata,
  inheritGroupMetadata,
  previewInheritMetadata,
  inheritMetadataToVolumes,
  fetchGroupTags,
  setGroupTags as setGroupTagsApi,
  syncGroupTags,
  overrideGroupTagsToVolumes,
  aiSuggestGroupTags,
} from "@/api/groups";
import type { ComicGroupDetail, GroupComicItem } from "@/hooks/useComicTypes";
import type { InheritPreview, GroupTag } from "@/api/groups";
import { GroupMetadataSearch } from "@/components/GroupMetadataSearch";
import { Sparkles, Brain } from "lucide-react";
import { useAIStatus } from "@/hooks/useAIStatus";
import { useLocale } from "@/lib/i18n/context";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

// 判断是否为小说文件
function isNovelFile(filename?: string): boolean {
  if (!filename) return false;
  const ext = filename.toLowerCase();
  return (
    ext.endsWith(".txt") ||
    ext.endsWith(".epub") ||
    ext.endsWith(".mobi") ||
    ext.endsWith(".azw3")
  );
}

// 优先使用数据库 type 字段判断，fallback 到文件后缀
function getReaderUrl(comic: { id: string; filename?: string; type?: string }): string {
  if (comic.type === "comic") return `/reader/${comic.id}`;
  if (comic.type === "novel") return `/novel/${comic.id}`;
  return isNovelFile(comic.filename) ? `/novel/${comic.id}` : `/reader/${comic.id}`;
}

// 自然排序键：将字符串中的数字部分补零对齐，实现数字感知排序
function naturalSortKey(s: string): string {
  return s.replace(/\d+/g, (match) => match.padStart(20, "0")).toLowerCase();
}

export default function GroupDetailPage() {
  const params = useParams();
  const router = useRouter();
  const t = useTranslation();
  const toast = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const groupId = Number(params?.id);
  const searchParams = useSearchParams();
  const contentType = searchParams?.get("contentType") || undefined;

  const [group, setGroup] = useState<ComicGroupDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [editName, setEditName] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [showAddComics, setShowAddComics] = useState(false);
  const [addSearchQuery, setAddSearchQuery] = useState("");
  const [addSearchResults, setAddSearchResults] = useState<{id: string; title: string; coverUrl: string}[]>([]);
  const [addSearchLoading, setAddSearchLoading] = useState(false);
  const [removeConfirmId, setRemoveConfirmId] = useState<string | null>(null);
  const addSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 系列级标签管理状态
  const [groupTags, setGroupTags] = useState<GroupTag[]>([]);
  const [newTagInput, setNewTagInput] = useState("");
  const [tagSyncing, setTagSyncing] = useState(false);
  const [tagSaving, setTagSaving] = useState(false);
  const [showTagManager, setShowTagManager] = useState(false);
  const [showScraper, setShowScraper] = useState(false);

  // AI 标签建议状态
  const { aiConfigured } = useAIStatus();
  const { locale } = useLocale();
  const [aiSuggestLoading, setAiSuggestLoading] = useState(false);
  const [aiSuggestedTags, setAiSuggestedTags] = useState<string[]>([]);
  const [aiSelectedTags, setAiSelectedTags] = useState<Set<string>>(new Set());

  // 标签覆盖状态
  const [overrideConfirm, setOverrideConfirm] = useState(false);
  const [overrideLoading, setOverrideLoading] = useState(false);

  // 元数据编辑状态
  const [showMetadataEdit, setShowMetadataEdit] = useState(false);
  const [showInheritPreview, setShowInheritPreview] = useState(false);
  const [inheritPreview, setInheritPreview] = useState<InheritPreview | null>(null);
  const [inheritLoading, setInheritLoading] = useState(false);
  const [metaForm, setMetaForm] = useState({
    author: "",
    description: "",
    tags: "",
    year: "" as string,
    publisher: "",
    language: "",
    genre: "",
    status: "",
  });

  // 触摸拖拽状态
  const [touchDragId, setTouchDragId] = useState<string | null>(null);
  const touchStartY = useRef<number>(0);
  const comicListRef = useRef<HTMLDivElement>(null);

  // 视图模式：grid（网格）或 list（列表）
  const [viewMode, setViewMode] = useState<"grid" | "list">(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("seriesViewMode") as "grid" | "list") || "grid";
    }
    return "grid";
  });

  useEffect(() => {
    localStorage.setItem("seriesViewMode", viewMode);
  }, [viewMode]);

  const loadGroup = useCallback(async () => {
    if (!groupId) return;
    setLoading(true);
    const data = await fetchGroupDetail(groupId, contentType);
    if (data && data.comics.length > 1) {
      // 按标题自然排序（数字感知），修复字符串排序导致 "3" 排在 "29" 后面的问题
      data.comics.sort((a: GroupComicItem, b: GroupComicItem) =>
        naturalSortKey(a.title).localeCompare(naturalSortKey(b.title))
      );
    }
    setGroup(data);
    if (data) {
      setEditName(data.name);
      setMetaForm({
        author: data.author || "",
        description: data.description || "",
        tags: data.tags || "",
        year: data.year != null ? String(data.year) : "",
        publisher: data.publisher || "",
        language: data.language || "",
        genre: data.genre || "",
        status: data.status || "",
      });
    }
    setLoading(false);
  }, [groupId, contentType]);

  useEffect(() => {
    loadGroup();
  }, [loadGroup]);

  // 加载系列标签
  const loadGroupTags = useCallback(async () => {
    if (!groupId) return;
    const tags = await fetchGroupTags(groupId);
    setGroupTags(tags);
  }, [groupId]);

  useEffect(() => {
    loadGroupTags();
  }, [loadGroupTags]);

  // 添加系列标签
  const handleAddGroupTag = useCallback(async () => {
    if (!group || !newTagInput.trim()) return;
    setTagSaving(true);
    const currentNames = groupTags.map(t => t.name);
    // 支持逗号分隔批量添加
    const newNames = newTagInput.split(",").map(s => s.trim()).filter(Boolean);
    const allNames = [...new Set([...currentNames, ...newNames])];
    const result = await setGroupTagsApi(group.id, allNames);
    if (result?.success) {
      const addedCount = result.added?.length || 0;
      const syncedTo = result.syncedTo || 0;
      toast.success(
        addedCount > 0
          ? `已添加 ${addedCount} 个标签${syncedTo > 0 ? `，已同步到 ${syncedTo} 卷` : ""}`
          : "标签未变化"
      );
      setNewTagInput("");
      await loadGroupTags();
    }
    setTagSaving(false);
  }, [group, newTagInput, groupTags, toast, loadGroupTags]);

  // 删除系列标签
  const handleRemoveGroupTag = useCallback(async (tagName: string) => {
    if (!group) return;
    setTagSaving(true);
    const newNames = groupTags.filter(t => t.name !== tagName).map(t => t.name);
    const result = await setGroupTagsApi(group.id, newNames);
    if (result?.success) {
      const syncedTo = result.syncedTo || 0;
      toast.success(
        `已移除标签「${tagName}」${syncedTo > 0 ? `，已从 ${syncedTo} 卷中移除` : ""}`
      );      await loadGroupTags();
    }
    setTagSaving(false);
  }, [group, groupTags, toast, loadGroupTags]);

  // 完整同步标签到所有卷
  // AI 建议标签
  const handleAiSuggestTags = useCallback(async () => {
    if (!group || aiSuggestLoading) return;
    setAiSuggestLoading(true);
    setAiSuggestedTags([]);
    setAiSelectedTags(new Set());
    try {
      const result = await aiSuggestGroupTags(group.id, locale === "en" ? "en" : "zh");
      if (result?.success && result.suggestedTags?.length > 0) {
        setAiSuggestedTags(result.suggestedTags);
        setAiSelectedTags(new Set(result.suggestedTags));
      } else {
        toast.info(t.comicGroup?.aiSuggestTagsEmpty || "AI 未生成新标签建议");
      }
    } catch {
      toast.error("AI 标签建议失败");
    } finally {
      setAiSuggestLoading(false);
    }
  }, [group, aiSuggestLoading, locale, toast, t.comicGroup]);

  // 应用 AI 建议的标签
  const handleApplyAiTags = useCallback(async (tagsToAdd: string[]) => {
    if (!group || tagsToAdd.length === 0) return;
    setTagSaving(true);
    const currentNames = groupTags.map(t => t.name);
    const allNames = [...new Set([...currentNames, ...tagsToAdd])];
    const result = await setGroupTagsApi(group.id, allNames);
    if (result?.success) {
      const addedCount = result.added?.length || 0;
      const syncedTo = result.syncedTo || 0;
      toast.success(
        (t.comicGroup?.aiSuggestTagsSuccess || "已添加 {count} 个 AI 建议标签").replace("{count}", String(addedCount))        + (syncedTo > 0 ? `，已同步到 ${syncedTo} 卷` : "")
      );
      setAiSuggestedTags([]);
      setAiSelectedTags(new Set());
      await loadGroupTags();
    }
    setTagSaving(false);
  }, [group, groupTags, toast, loadGroupTags, t.comicGroup]);

  const handleSyncTagsToVolumes = useCallback(async () => {
    if (!group) return;
    setTagSyncing(true);
    const result = await syncGroupTags(group.id);
    if (result?.success) {
      toast.success(
        `同步完成：${result.syncedVolumes}/${result.totalVolumes} 卷已更新，` +
        `添加 ${result.tagsAdded} 个、移除 ${result.tagsRemoved} 个标签关联`
      );
    } else {
      toast.error("同步失败");
    }
    setTagSyncing(false);
  }, [group, toast]);

  // 覆盖标签到所有卷（先清除卷标签再设置为系列标签）
  const handleOverrideTagsToVolumes = useCallback(async () => {
    if (!group) return;
    setOverrideLoading(true);
    try {
      const result = await overrideGroupTagsToVolumes(group.id);
      if (result?.success) {
        toast.success(
          `覆盖完成：${result.syncedVolumes}/${result.totalVolumes} 卷已更新，` +
          `每卷设置 ${result.tagsSet} 个标签`
        );
      } else {
        toast.error("覆盖标签失败");
      }
    } catch {
      toast.error("覆盖标签失败");
    } finally {
      setOverrideLoading(false);
      setOverrideConfirm(false);
    }
  }, [group, toast]);

  // 保存编辑
  const handleSaveName = useCallback(async () => {
    if (!group || !editName.trim()) return;
    const ok = await updateGroup(group.id, editName.trim(), group.coverUrl);
    if (ok) {
      setGroup((prev) => (prev ? { ...prev, name: editName.trim() } : prev));
      setEditMode(false);
      toast.success(t.common.save);
    }
  }, [group, editName, toast, t]);

  // 删除系列
  const handleDelete = useCallback(async () => {
    if (!group) return;
    const ok = await deleteGroup(group.id);
    if (ok) {
      router.push("/");
    }
  }, [group, router]);

  // 移除漫画（需二次确认）
  const handleRemoveComic = useCallback(
    async (comicId: string) => {
      if (!group) return;
      if (removeConfirmId !== comicId) {
        setRemoveConfirmId(comicId);
        return;
      }
      setRemoveConfirmId(null);
      const ok = await removeComicFromGroup(group.id, comicId);
      if (ok) {
        setGroup((prev) =>
          prev
            ? {
                ...prev,
                comics: prev.comics.filter((c) => c.id !== comicId),
                comicCount: prev.comicCount - 1,
              }
            : prev
        );
      }
    },
    [group, removeConfirmId]
  );

  // 触摸拖拽排序
  const handleTouchStart = useCallback((comicId: string, e: React.TouchEvent) => {
    setTouchDragId(comicId);
    touchStartY.current = e.touches[0].clientY;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchDragId || !group || !comicListRef.current) return;
    const touchY = e.touches[0].clientY;
    const elements = comicListRef.current.querySelectorAll('[data-comic-id]');
    for (const el of elements) {
      const rect = el.getBoundingClientRect();
      if (touchY >= rect.top && touchY <= rect.bottom) {
        const overId = el.getAttribute('data-comic-id');
        if (overId && overId !== touchDragId) {
          setDragOverId(overId);
        }
        break;
      }
    }
  }, [touchDragId, group]);

  const handleTouchEnd = useCallback(async () => {
    if (!touchDragId || !dragOverId || touchDragId === dragOverId || !group) {
      setTouchDragId(null);
      setDragOverId(null);
      return;
    }
    const items = [...group.comics];
    const fromIdx = items.findIndex((c) => c.id === touchDragId);
    const toIdx = items.findIndex((c) => c.id === dragOverId);
    if (fromIdx === -1 || toIdx === -1) {
      setTouchDragId(null);
      setDragOverId(null);
      return;
    }
    const [moved] = items.splice(fromIdx, 1);
    items.splice(toIdx, 0, moved);
    setGroup((prev) => (prev ? { ...prev, comics: items } : prev));
    setTouchDragId(null);
    setDragOverId(null);
    await reorderGroupComics(group.id, items.map((c) => c.id));
  }, [touchDragId, dragOverId, group]);

  // 拖拽排序
  const handleDragEnd = useCallback(async () => {
    if (!group || !dragId || !dragOverId || dragId === dragOverId) {
      setDragId(null);
      setDragOverId(null);
      return;
    }
    const items = [...group.comics];
    const fromIdx = items.findIndex((c) => c.id === dragId);
    const toIdx = items.findIndex((c) => c.id === dragOverId);
    if (fromIdx === -1 || toIdx === -1) {
      setDragId(null);
      setDragOverId(null);
      return;
    }
    const [moved] = items.splice(fromIdx, 1);
    items.splice(toIdx, 0, moved);
    setGroup((prev) => (prev ? { ...prev, comics: items } : prev));
    setDragId(null);
    setDragOverId(null);

    await reorderGroupComics(
      group.id,
      items.map((c) => c.id)
    );
  }, [group, dragId, dragOverId]);

  // 搜索漫画用于添加到系列（带防抖）
  const handleAddSearchImmediate = useCallback(async (query: string) => {
    if (!query.trim()) {
      setAddSearchResults([]);
      return;
    }
    setAddSearchLoading(true);
    try {
      const res = await fetch(`/api/comics?search=${encodeURIComponent(query)}&page=1&pageSize=20`);
      if (res.ok) {
        const data = await res.json();
        const existingIds = new Set(group?.comics.map(c => c.id) || []);
        setAddSearchResults(
          (data.comics || []).filter((c: any) => !existingIds.has(c.id)).map((c: any) => ({
            id: c.id,
            title: c.title,
            coverUrl: `/api/comics/${c.id}/thumbnail`,
          }))
        );
      }
    } catch { /* ignore */ }
    finally { setAddSearchLoading(false); }
  }, [group]);

  const handleAddSearch = useCallback((query: string) => {
    if (addSearchTimerRef.current) {
      clearTimeout(addSearchTimerRef.current);
    }
    if (!query.trim()) {
      setAddSearchResults([]);
      return;
    }
    addSearchTimerRef.current = setTimeout(() => {
      handleAddSearchImmediate(query);
    }, 300);
  }, [handleAddSearchImmediate]);

  const handleAddComicToGroup = useCallback(async (comicId: string) => {
    if (!group) return;
    const ok = await addComicsToGroup(group.id, [comicId]);
    if (ok) {
      setAddSearchResults(prev => prev.filter(c => c.id !== comicId));
      await loadGroup();
      toast.success(t.comicGroup?.addToGroup || "已添加");
    }
  }, [group, loadGroup, toast, t]);

  // 保存元数据
  const handleSaveMetadata = useCallback(async () => {
    if (!group) return;
    const ok = await updateGroupMetadata(group.id, {
      author: metaForm.author,
      description: metaForm.description,
      tags: metaForm.tags,
      year: metaForm.year ? parseInt(metaForm.year) : undefined,
      publisher: metaForm.publisher,
      language: metaForm.language,
      genre: metaForm.genre,
      status: metaForm.status,
    });
    if (ok) {
      toast.success(t.comicGroup?.saveSuccess || "元数据保存成功");
      setShowMetadataEdit(false);
      await loadGroup();
    }
  }, [group, metaForm, toast, t, loadGroup]);

  // 从首卷继承元数据（仅继承到系列）
  const handleInheritMetadata = useCallback(async () => {
    if (!group) return;
    const ok = await inheritGroupMetadata(group.id);
    if (ok) {
      toast.success(t.comicGroup?.inheritSuccess || "元数据继承成功");
      await loadGroup();
    }
  }, [group, toast, t, loadGroup]);

  // 预览继承到所有卷
  const handlePreviewInherit = useCallback(async () => {
    if (!group) return;
    setInheritLoading(true);
    const preview = await previewInheritMetadata(group.id);
    setInheritPreview(preview);
    setShowInheritPreview(true);
    setInheritLoading(false);
  }, [group]);

  // 确认继承到所有卷
  const handleConfirmInheritToVolumes = useCallback(async () => {
    if (!group) return;
    setInheritLoading(true);
    const ok = await inheritMetadataToVolumes(group.id);
    if (ok) {
      toast.success(t.comicGroup?.inheritToVolumesSuccess || "元数据已继承到所有卷");
      setShowInheritPreview(false);
      setInheritPreview(null);
      await loadGroup();
    }
    setInheritLoading(false);
  }, [group, toast, t, loadGroup]);

  // 计算统计
  const totalPages = group?.comics.reduce((s, c) => s + c.pageCount, 0) || 0;
  const totalReadTime =
    group?.comics.reduce((s, c) => s + c.totalReadTime, 0) || 0;
  const totalSize =
    group?.comics.reduce((s, c) => s + c.fileSize, 0) || 0;

  // 查找继续阅读的卷
  const continueVolume = group?.comics.find(
    (c) => c.lastReadPage > 0 && c.lastReadPage < c.pageCount
  );

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-accent" />
      </div>
    );
  }

  if (!group) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background">
        <p className="mb-4 text-muted">{t.comicDetail?.comicNotFound || "系列不存在"}</p>
        <Link
          href="/"
          className="flex items-center gap-2 text-accent hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          {t.comicGroup?.backToLibrary || "返回书库"}
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-30 border-b border-border/30 bg-background/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1200px] items-center gap-3 px-4 py-3">
          <button
            onClick={() => {
              if (window.history.length > 1) {
                router.back();
              } else {
                router.push("/");
              }
            }}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-card hover:text-foreground"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>

          {editMode ? (
            <div className="flex flex-1 items-center gap-2">
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSaveName()}
                className="flex-1 rounded-lg bg-card px-3 py-1.5 text-lg font-semibold text-foreground outline-none focus:ring-1 focus:ring-accent/50"
                autoFocus
              />
              <button
                onClick={handleSaveName}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white"
              >
                <Check className="h-4 w-4" />
              </button>
              <button
                onClick={() => {
                  setEditMode(false);
                  setEditName(group.name);
                }}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-card text-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="flex flex-1 items-center gap-2">
              <h1 className="text-lg font-semibold text-foreground">
                {group.name}
              </h1>
              <span className="rounded-md bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
                {group.comicCount} {t.comicGroup?.volumes || "卷"}
              </span>
            </div>
          )}

          {!editMode && isAdmin && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => setShowAddComics(true)}
                className="flex h-8 items-center gap-1 rounded-lg px-2 text-muted transition-colors hover:bg-accent/10 hover:text-accent"
                title={t.comicGroup?.addToGroup || "添加漫画"}
              >
                <Plus className="h-4 w-4" />
              </button>
              <button
                onClick={() => setEditMode(true)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-card hover:text-foreground"
                title={t.comicGroup?.editGroup}
              >
                <Edit3 className="h-4 w-4" />
              </button>
              <button
                onClick={() => setDeleteConfirm(true)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-red-500/10 hover:text-red-400"
                title={t.comicGroup?.deleteGroup}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <main className="mx-auto max-w-[1200px] px-4 py-6">
        {/* ═══════════════════════════════════════════════════════
            系列元数据区域（类似 Komga/Kavita 的布局）
            ═══════════════════════════════════════════════════════ */}
        <div className="mb-8 rounded-2xl bg-card/50 p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row gap-5 sm:gap-6">
            {/* 系列封面 */}
            <div className="flex-shrink-0 self-center sm:self-start">
              <div className="relative h-[280px] w-[200px] overflow-hidden rounded-xl shadow-lg shadow-black/20">
                {group.coverUrl ? (
                  <Image
                    src={group.coverUrl}
                    alt={group.name}
                    fill
                    unoptimized
                    className="object-cover"
                    sizes="200px"
                    priority
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-accent/20 to-accent/5">
                    <Layers className="h-16 w-16 text-accent/40" />
                  </div>
                )}
                {/* 卷数角标 */}
                <div className="absolute top-2 right-2 rounded-lg bg-accent px-2 py-1 text-xs font-bold text-white shadow-lg">
                  {group.comicCount}
                </div>
              </div>
            </div>

            {/* 系列信息 */}
            <div className="flex-1 min-w-0">
              <h2 className="text-2xl font-bold text-foreground mb-2">{group.name}</h2>

              {/* 元数据标签行 */}
              <div className="flex flex-wrap items-center gap-2 mb-3">
                {group.status && (
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    group.status === "completed" ? "bg-emerald-500/15 text-emerald-400" :
                    group.status === "ongoing" ? "bg-blue-500/15 text-blue-400" :
                    "bg-amber-500/15 text-amber-400"
                  }`}>
                    {group.status === "ongoing" ? (t.comicGroup?.statusOngoing || "连载中") :
                     group.status === "completed" ? (t.comicGroup?.statusCompleted || "已完结") :
                     group.status === "hiatus" ? (t.comicGroup?.statusHiatus || "休刊中") :
                     group.status}
                  </span>
                )}
                {group.language && (
                  <span className="rounded-full bg-purple-500/10 px-2.5 py-0.5 text-xs font-medium text-purple-400">
                    {group.language}
                  </span>
                )}
                {group.year != null && (
                  <span className="text-sm text-muted">{group.year}年</span>
                )}
              </div>

              {/* 统计信息 */}
              <div className="flex flex-wrap items-center gap-4 mb-4 text-sm text-muted">
                <span className="flex items-center gap-1.5">
                  <FileText className="h-4 w-4" />
                  {totalPages.toLocaleString()} {t.comicGroup?.totalPages || "页"}
                </span>
                {totalReadTime > 0 && (
                  <span className="flex items-center gap-1.5">
                    <Clock className="h-4 w-4" />
                    {formatDuration(totalReadTime)}
                  </span>
                )}
                <span>{formatFileSize(totalSize)}</span>
              </div>

              {/* 作者/出版商 */}
              <div className="space-y-1.5 mb-4">
                {group.author && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted w-14 flex-shrink-0">{t.comicGroup?.author || "作者"}</span>
                    <span className="text-foreground">{group.author}</span>
                  </div>
                )}
                {group.publisher && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted w-14 flex-shrink-0">{t.comicGroup?.publisher || "出版商"}</span>
                    <span className="text-foreground">{group.publisher}</span>
                  </div>
                )}
                {group.genre && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted w-14 flex-shrink-0">{t.comicGroup?.genre || "类型"}</span>
                    <span className="text-foreground">{group.genre}</span>
                  </div>
                )}
              </div>

              {/* 简介 */}
              {group.description && (
                <p className="text-sm text-muted/80 leading-relaxed mb-4 line-clamp-4">
                  {group.description}
                </p>
              )}

              {/* 系列标签管理 */}
              {(groupTags.length > 0 || isAdmin) && (
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-medium uppercase tracking-wider text-muted flex items-center gap-1.5">
                      <Tag className="h-3 w-3" />
                      {t.comicGroup?.tags || "标签"}
                      {groupTags.length > 0 && (
                        <span className="text-[10px] text-muted/60">({groupTags.length})</span>
                      )}
                    </h4>
                    {isAdmin && groupTags.length > 0 && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleSyncTagsToVolumes}
                          disabled={tagSyncing}
                          className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] text-accent/80 transition-colors hover:bg-accent/10"
                          title="将系列标签增量同步到所有卷（仅添加缺少的标签）"
                        >
                          {tagSyncing ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3 w-3" />
                          )}
                          <span>同步到所有卷</span>
                        </button>
                        <button
                          onClick={() => setOverrideConfirm(true)}
                          disabled={overrideLoading}
                          className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] text-orange-400/80 transition-colors hover:bg-orange-400/10"
                          title="将系列标签覆盖到所有卷（先清除卷的所有标签，再设置为系列标签）"
                        >
                          {overrideLoading ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                          <span>覆盖到所有卷</span>
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {groupTags.map((tag) => (
                      <span
                        key={tag.id}
                        className="group flex items-center gap-1 rounded-lg bg-accent/10 px-2.5 py-1 text-xs text-accent"
                      >
                        <Tag className="h-3 w-3 flex-shrink-0" />
                        {tag.name}
                        {isAdmin && (
                          <button
                            onClick={() => handleRemoveGroupTag(tag.name)}
                            disabled={tagSaving}
                            className="ml-0.5 rounded-full p-0.5 opacity-0 transition-all group-hover:opacity-100 hover:bg-white/10"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </span>
                    ))}
                    {groupTags.length === 0 && !isAdmin && (
                      <span className="text-xs text-muted/50">暂无标签</span>
                    )}
                  </div>
                  {isAdmin && (
                    <div className="mt-2 flex gap-2">
                      <input
                        type="text"
                        value={newTagInput}
                        onChange={(e) => setNewTagInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleAddGroupTag()}
                        placeholder="添加标签（多个用逗号分隔）"
                        className="flex-1 rounded-lg bg-card px-3 py-1.5 text-xs text-foreground placeholder-muted/50 outline-none focus:ring-1 focus:ring-accent/30"
                      />
                      <button
                        onClick={handleAddGroupTag}
                        disabled={!newTagInput.trim() || tagSaving}
                        className="rounded-lg bg-accent/20 px-2.5 py-1.5 text-accent transition-colors hover:bg-accent/30 disabled:opacity-30"
                      >
                        {tagSaving ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Plus className="h-3.5 w-3.5" />
                        )}
                      </button>
                      {aiConfigured && (
                        <button
                          onClick={handleAiSuggestTags}
                          disabled={aiSuggestLoading}
                          className="flex items-center gap-1.5 rounded-lg bg-purple-500/15 px-2.5 py-1.5 text-xs font-medium text-purple-400 transition-colors hover:bg-purple-500/25 disabled:opacity-50"
                          title={t.comicGroup?.aiSuggestTags || "AI 标签"}
                        >
                          {aiSuggestLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Brain className="h-3.5 w-3.5" />}
                          <span className="hidden sm:inline">{aiSuggestLoading ? (t.comicGroup?.aiSuggestTagsLoading || "AI 分析中...") : (t.comicGroup?.aiSuggestTags || "AI 标签")}</span>
                        </button>
                      )}
                    </div>
                  )}

                  {/* AI 建议标签展示 */}
                  {aiSuggestedTags.length > 0 && (
                    <div className="mt-3 rounded-lg border border-purple-500/20 bg-purple-500/5 p-3">
                      <div className="mb-2 flex items-center gap-2 text-xs text-purple-400">
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>{t.comicGroup?.aiSuggestTagsTitle || "AI 建议标签"}</span>
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
                          onClick={() => handleApplyAiTags(Array.from(aiSelectedTags))}
                          disabled={aiSelectedTags.size === 0 || tagSaving}
                          className="rounded-md bg-purple-500/20 px-3 py-1 text-xs font-medium text-purple-300 transition-colors hover:bg-purple-500/30 disabled:opacity-40"
                        >
                          {t.comicGroup?.aiAddSelected || "添加选中"} ({aiSelectedTags.size})
                        </button>
                        <button
                          onClick={() => handleApplyAiTags(aiSuggestedTags)}
                          disabled={tagSaving}
                          className="rounded-md bg-card px-3 py-1 text-xs text-muted transition-colors hover:text-foreground"
                        >
                          {t.comicGroup?.aiAddAll || "全部添加"}
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
                  {isAdmin && groupTags.length > 0 && (
                    <p className="mt-1.5 text-[10px] text-muted/50 flex items-center gap-1">
                      <ArrowDownToLine className="h-3 w-3" />
                      添加/删除标签时自动同步到系列内所有卷
                    </p>
                  )}

                  {/* 覆盖确认对话框 */}
                  {overrideConfirm && (
                    <div className="mt-3 rounded-lg border border-orange-500/30 bg-orange-500/5 p-3">
                      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-orange-400">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        <span>确认覆盖标签</span>
                      </div>
                      <p className="mb-3 text-[11px] text-muted/70 leading-relaxed">
                        此操作将<strong className="text-orange-400">清除</strong>系列内所有卷的现有标签，
                        然后将当前系列的 <strong className="text-orange-400">{groupTags.length}</strong> 个标签设置到每一卷。
                        此操作不可撤销，请确认是否继续？
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={handleOverrideTagsToVolumes}
                          disabled={overrideLoading}
                          className="flex items-center gap-1.5 rounded-md bg-orange-500/20 px-3 py-1 text-xs font-medium text-orange-300 transition-colors hover:bg-orange-500/30 disabled:opacity-40"
                        >
                          {overrideLoading ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Check className="h-3 w-3" />
                          )}
                          {overrideLoading ? "覆盖中..." : "确认覆盖"}
                        </button>
                        <button
                          onClick={() => setOverrideConfirm(false)}
                          disabled={overrideLoading}
                          className="rounded-md px-3 py-1 text-xs text-muted transition-colors hover:text-foreground disabled:opacity-40"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 操作按钮 */}
              <div className="flex flex-wrap items-center gap-2">
                {continueVolume && (
                  <Link
                    href={
                      getReaderUrl(continueVolume)
                    }
                    className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-accent/20 transition-all hover:bg-accent-hover hover:shadow-accent/30"
                  >
                    <BookOpen className="h-4 w-4" />
                    {t.comicGroup?.continueReading || "继续阅读"}
                  </Link>
                )}
                {isAdmin && (
                  <>
                    <button
                      onClick={() => {
                        setMetaForm({
                          author: group.author || "",
                          description: group.description || "",
                          tags: group.tags || "",
                          year: group.year != null ? String(group.year) : "",
                          publisher: group.publisher || "",
                          language: group.language || "",
                          genre: group.genre || "",
                          status: group.status || "",
                        });
                        setShowMetadataEdit(true);
                      }}
                      className="flex items-center gap-1.5 rounded-xl bg-card px-4 py-2.5 text-sm text-foreground/80 transition-colors hover:bg-card-hover"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                      {t.comicGroup?.editMetadata || "编辑元数据"}
                    </button>
                    {group.comics.length > 0 && (
                      <button
                        onClick={handleInheritMetadata}
                        className="flex items-center gap-1.5 rounded-xl bg-card px-4 py-2.5 text-sm text-foreground/80 transition-colors hover:bg-card-hover"
                        title={t.comicGroup?.inheritMetadataDesc || "从系列第一本漫画继承元数据"}
                      >
                        <Download className="h-3.5 w-3.5" />
                        {t.comicGroup?.inheritMetadata || "从首卷继承"}
                      </button>
                    )}
                    {group.comics.length > 1 && (
                      <button
                        onClick={handlePreviewInherit}
                        disabled={inheritLoading}
                        className="flex items-center gap-1.5 rounded-xl bg-accent/10 px-4 py-2.5 text-sm text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
                        title={t.comicGroup?.inheritToVolumesDesc || "将首卷的元数据继承到系列中所有卷"}
                      >
                        <Layers className="h-3.5 w-3.5" />
                        {t.comicGroup?.inheritToVolumes || "继承到所有卷"}
                      </button>
                    )}
                    <button
                      onClick={() => setShowScraper(true)}
                      className="flex items-center gap-1.5 rounded-xl bg-purple-500/10 px-4 py-2.5 text-sm text-purple-400 transition-colors hover:bg-purple-500/20"
                      title="从在线数据库搜索并获取系列信息，支持 AI 智能识别"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      {t.comicGroup?.scrapeMetadata || "刮削元数据"}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════
            卷列表区域
            ═══════════════════════════════════════════════════════ */}
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-foreground">
            {t.comicGroup?.volumes || "卷"} ({group.comicCount})
          </h3>
          <div className="flex items-center rounded-lg border border-border/60 bg-card/50 p-0.5">
            <button
              onClick={() => setViewMode("grid")}
              className={`flex h-7 w-7 items-center justify-center rounded-md transition-all duration-200 ${
                viewMode === "grid"
                  ? "bg-accent text-white shadow-sm"
                  : "text-muted hover:text-foreground"
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`flex h-7 w-7 items-center justify-center rounded-md transition-all duration-200 ${
                viewMode === "list"
                  ? "bg-accent text-white shadow-sm"
                  : "text-muted hover:text-foreground"
              }`}
            >
              <GripVertical className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {group.comics.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-card">
              <span className="text-4xl">📚</span>
            </div>
            <p className="text-sm text-muted">
              {t.comicGroup?.emptyGroup || "此系列还没有漫画"}
            </p>
          </div>
        ) : viewMode === "grid" ? (
          /* ── 网格视图（类似 Komga/Kavita 的卷封面网格）── */
          <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6" ref={comicListRef}>
            {group.comics.map((comic, index) => {
              const progress =
                comic.pageCount > 0
                  ? Math.round((comic.lastReadPage / comic.pageCount) * 100)
                  : 0;
              const readerUrl = getReaderUrl(comic);

              return (
                <div
                  key={comic.id}
                  data-comic-id={comic.id}
                  className={`group relative ${
                    dragOverId === comic.id ? "ring-2 ring-accent rounded-xl" : ""
                  }`}
                  draggable={isAdmin}
                  onDragStart={isAdmin ? (e) => {
                    e.dataTransfer.effectAllowed = "move";
                    setDragId(comic.id);
                  } : undefined}
                  onDragOver={isAdmin ? (e) => {
                    e.preventDefault();
                    setDragOverId(comic.id);
                  } : undefined}
                  onDrop={isAdmin ? (e) => {
                    e.preventDefault();
                    handleDragEnd();
                  } : undefined}
                >
                  <Link href={`/comic/${comic.id}`} className="block">
                    <div className="relative overflow-hidden rounded-xl bg-card transition-all duration-300 ease-out group-hover:scale-[1.03] group-hover:shadow-2xl group-hover:shadow-accent/10">
                      <div className="relative aspect-[5/7] w-full overflow-hidden">
                        <Image
                          src={comic.coverUrl}
                          alt={comic.title}
                          fill
                          unoptimized
                          className="object-cover transition-all duration-500 group-hover:scale-110"
                          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 16vw"
                        />
                        {/* 渐变遮罩 */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-80" />
                        {/* 进度条 */}
                        {progress > 0 && (
                          <div className="absolute bottom-0 left-0 right-0 h-1">
                            <div
                              className={`h-full ${progress >= 100 ? "bg-emerald-400" : "bg-accent"}`}
                              style={{ width: `${Math.min(progress, 100)}%` }}
                            />
                          </div>
                        )}
                        {/* Hover 阅读按钮 */}
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-all duration-300 group-hover:opacity-100">
                          <Link
                            href={readerUrl}
                            className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/90 shadow-lg shadow-accent/30 backdrop-blur-sm transition-transform duration-300 hover:scale-110"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <BookOpen className="h-5 w-5 text-white" />
                          </Link>
                        </div>
                      </div>
                      <div className="p-2.5">
                        <h4 className="truncate text-xs font-medium text-foreground/90 group-hover:text-foreground">
                          {comic.title}
                        </h4>
                        <p className="mt-0.5 text-[10px] text-muted">
                          {comic.pageCount} {t.comicGroup?.totalPages ? "页" : "p"}
                        </p>
                      </div>
                    </div>
                  </Link>
                  {/* 管理员移除按钮 */}
                  {isAdmin && (
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleRemoveComic(comic.id);
                      }}
                      onMouseLeave={() => {
                        if (removeConfirmId === comic.id) setRemoveConfirmId(null);
                      }}
                      className={`absolute top-1.5 left-1.5 z-10 flex items-center justify-center rounded-lg transition-all opacity-0 group-hover:opacity-100 ${
                        removeConfirmId === comic.id
                          ? "h-6 w-auto px-1.5 bg-red-500/90 text-white"
                          : "h-6 w-6 bg-black/50 text-white/80 hover:bg-red-500/80"
                      }`}
                    >
                      {removeConfirmId === comic.id ? (
                        <span className="text-[9px] font-medium whitespace-nowrap">{t.common?.confirm || "确认"}</span>
                      ) : (
                        <X className="h-3 w-3" />
                      )}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          /* ── 列表视图（保留原有的列表模式）── */
          <div className="space-y-2" ref={comicListRef}>
            {group.comics.map((comic, index) => {
              const progress =
                comic.pageCount > 0
                  ? Math.round((comic.lastReadPage / comic.pageCount) * 100)
                  : 0;
              const readerUrl = getReaderUrl(comic);

              return (
                <div
                  key={comic.id}
                  data-comic-id={comic.id}
                  className={`group flex items-center gap-3 rounded-xl bg-card p-3 transition-all ${
                    dragOverId === comic.id
                      ? "ring-2 ring-accent"
                      : touchDragId === comic.id
                      ? "opacity-60 scale-[0.98]"
                      : "hover:bg-card-hover"
                  }`}
                  draggable={isAdmin}
                  onDragStart={isAdmin ? (e) => {
                    e.dataTransfer.effectAllowed = "move";
                    setDragId(comic.id);
                  } : undefined}
                  onDragOver={isAdmin ? (e) => {
                    e.preventDefault();
                    setDragOverId(comic.id);
                  } : undefined}
                  onDrop={isAdmin ? (e) => {
                    e.preventDefault();
                    handleDragEnd();
                  } : undefined}
                  onTouchStart={isAdmin ? (e) => handleTouchStart(comic.id, e) : undefined}
                  onTouchMove={isAdmin ? handleTouchMove : undefined}
                  onTouchEnd={isAdmin ? handleTouchEnd : undefined}
                >
                  {/* 拖拽手柄 — 仅管理员可见 */}
                  {isAdmin && (
                  <div className="flex-shrink-0 cursor-grab text-muted/30 hover:text-muted active:cursor-grabbing">
                    <GripVertical className="h-4 w-4" />
                  </div>
                  )}

                  {/* 卷号 */}
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-accent/10 text-xs font-bold text-accent">
                    {index + 1}
                  </div>

                  {/* 封面缩略图 */}
                  <div className="relative h-16 w-12 flex-shrink-0 overflow-hidden rounded-lg">
                    <Image
                      src={comic.coverUrl}
                      alt={comic.title}
                      fill
                      unoptimized
                      className="object-cover"
                      sizes="48px"
                    />
                  </div>

                  {/* 信息 */}
                  <Link href={`/comic/${comic.id}`} className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-medium text-foreground/90 group-hover:text-foreground">
                      {comic.title}
                    </h3>
                    <div className="mt-1 flex items-center gap-3 text-xs text-muted/70">
                      <span>{comic.pageCount}p</span>
                      <span>{formatFileSize(comic.fileSize)}</span>
                      {comic.totalReadTime > 0 && (
                        <span className="flex items-center gap-0.5">
                          <Clock className="h-3 w-3" />
                          {formatDuration(comic.totalReadTime)}
                        </span>
                      )}
                    </div>
                  </Link>

                  {/* 进度 */}
                  {progress > 0 && (
                    <div className="flex flex-shrink-0 items-center gap-2">
                      <div className="h-1.5 w-12 sm:w-16 overflow-hidden rounded-full bg-muted/20">
                        <div
                          className={`h-full rounded-full transition-all ${
                            progress >= 100 ? "bg-emerald-400" : "bg-accent"
                          }`}
                          style={{ width: `${Math.min(progress, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted">
                        {progress}%
                      </span>
                    </div>
                  )}

                  {/* 阅读按钮 */}
                  <Link
                    href={readerUrl}
                    className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-muted opacity-100 sm:opacity-0 transition-all hover:bg-accent/10 hover:text-accent group-hover:opacity-100"
                  >
                    <BookOpen className="h-4 w-4" />
                  </Link>

                  {/* 移除按钮 — 仅管理员可见 */}
                  {isAdmin && (
                  <button
                    onClick={() => handleRemoveComic(comic.id)}
                    onMouseLeave={() => {
                      if (removeConfirmId === comic.id) setRemoveConfirmId(null);
                    }}
                    className={`flex h-8 flex-shrink-0 items-center justify-center rounded-lg transition-all sm:group-hover:opacity-100 ${
                      removeConfirmId === comic.id
                        ? "w-auto px-2 bg-red-500/15 text-red-400 opacity-100"
                        : "w-8 text-muted opacity-100 sm:opacity-0 hover:bg-red-500/10 hover:text-red-400"
                    }`}
                    title={removeConfirmId === comic.id ? (t.common?.confirm || "确认") : t.comicGroup?.removeFromGroup}
                  >
                    {removeConfirmId === comic.id ? (
                      <span className="text-[10px] font-medium whitespace-nowrap">{t.common?.confirm || "确认"} ?</span>
                    ) : (
                      <X className="h-4 w-4" />
                    )}
                  </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* 删除确认弹窗 */}
      {deleteConfirm && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 animate-backdrop-in" onClick={() => setDeleteConfirm(false)}>
          <div className="w-80 rounded-2xl border border-border bg-card p-6 shadow-2xl animate-modal-in" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-foreground">
              {t.comicGroup?.confirmDelete || "确认删除系列"}
            </h3>
            <p className="mt-2 text-sm text-muted">
              {(t.comicGroup?.confirmDeleteMsg || "确定要删除系列「{name}」吗？系列内的漫画不会被删除。").replace(
                "{name}",
                group.name
              )}
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirm(false)}
                className="rounded-lg bg-card px-4 py-2 text-sm text-foreground"
              >
                {t.common.cancel}
              </button>
              <button
                onClick={handleDelete}
                className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white"
              >
                {t.common.delete}
              </button>
            </div>
          </div>
          </div>
      )}

      {/* 刮削元数据弹窗 */}
      {showScraper && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 animate-backdrop-in" onClick={() => setShowScraper(false)}>
          <div className="w-[90vw] max-w-2xl rounded-2xl border border-border bg-card shadow-2xl animate-modal-in max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border/30 bg-card px-5 py-3 rounded-t-2xl">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-purple-400" />
                <h3 className="text-base font-semibold text-foreground">
                  {t.comicGroup?.scrapeMetadata || "刮削元数据"}
                </h3>
              </div>
              <button
                onClick={() => setShowScraper(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-card-hover"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5">
              <p className="mb-4 text-xs text-muted">
                从 AniList、Bangumi 等在线数据库搜索系列信息，或使用 AI 智能识别。支持选择性应用字段和标签同步。
              </p>
              <GroupMetadataSearch
                groupId={group.id}
                groupName={group.name}
                onApplied={async (success, message) => {
                  if (success) {
                    await loadGroup();
                    await loadGroupTags();
                    setShowScraper(false);
                    toast.success(message || t.comicGroup?.scrapeApplySuccess || "元数据应用成功");
                  }
                }}
              />
            </div>
          </div>
          </div>
      )}

      {/* 元数据编辑弹窗 */}
      {showMetadataEdit && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 animate-backdrop-in" onClick={() => setShowMetadataEdit(false)}>
          <div className="w-[90vw] max-w-lg rounded-2xl border border-border bg-card shadow-2xl animate-modal-in max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border/30 bg-card px-5 py-3 rounded-t-2xl">
              <h3 className="text-base font-semibold text-foreground">
                {t.comicGroup?.editMetadata || "编辑系列元数据"}
              </h3>
              <button
                onClick={() => setShowMetadataEdit(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-card-hover"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {/* 作者 */}
              <div>
                <label className="mb-1 block text-xs font-medium text-muted">{t.comicGroup?.author || "作者"}</label>
                <input
                  type="text"
                  value={metaForm.author}
                  onChange={(e) => setMetaForm(f => ({ ...f, author: e.target.value }))}
                  className="w-full rounded-lg bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-accent/30"
                />
              </div>
              {/* 出版商 */}
              <div>
                <label className="mb-1 block text-xs font-medium text-muted">{t.comicGroup?.publisher || "出版商"}</label>
                <input
                  type="text"
                  value={metaForm.publisher}
                  onChange={(e) => setMetaForm(f => ({ ...f, publisher: e.target.value }))}
                  className="w-full rounded-lg bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-accent/30"
                />
              </div>
              {/* 年份 + 语言 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">{t.comicGroup?.year || "年份"}</label>
                  <input
                    type="number"
                    value={metaForm.year}
                    onChange={(e) => setMetaForm(f => ({ ...f, year: e.target.value }))}
                    placeholder="2024"
                    className="w-full rounded-lg bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-accent/30"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">{t.comicGroup?.language || "语言"}</label>
                  <input
                    type="text"
                    value={metaForm.language}
                    onChange={(e) => setMetaForm(f => ({ ...f, language: e.target.value }))}
                    placeholder="Chinese"
                    className="w-full rounded-lg bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-accent/30"
                  />
                </div>
              </div>
              {/* 类型 */}
              <div>
                <label className="mb-1 block text-xs font-medium text-muted">{t.comicGroup?.genre || "类型"}</label>
                <input
                  type="text"
                  value={metaForm.genre}
                  onChange={(e) => setMetaForm(f => ({ ...f, genre: e.target.value }))}
                  className="w-full rounded-lg bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-accent/30"
                />
              </div>
              {/* 状态 */}
              <div>
                <label className="mb-1 block text-xs font-medium text-muted">{t.comicGroup?.status || "状态"}</label>
                <select
                  value={metaForm.status}
                  onChange={(e) => setMetaForm(f => ({ ...f, status: e.target.value }))}
                  className="w-full rounded-lg bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-accent/30"
                >
                  <option value="">--</option>
                  <option value="ongoing">{t.comicGroup?.statusOngoing || "连载中"}</option>
                  <option value="completed">{t.comicGroup?.statusCompleted || "已完结"}</option>
                  <option value="hiatus">{t.comicGroup?.statusHiatus || "休刊中"}</option>
                </select>
              </div>
              {/* 标签 */}
              <div>
                <label className="mb-1 block text-xs font-medium text-muted">{t.comicGroup?.tags || "标签"}</label>
                <div className="rounded-lg bg-background/50 border border-border/20 px-3 py-2.5">
                  {groupTags.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {groupTags.map((tag) => (
                        <span key={tag.id} className="flex items-center gap-1 rounded-md bg-accent/10 px-2 py-0.5 text-xs text-accent">
                          <Tag className="h-3 w-3" />
                          {tag.name}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted/50 mb-2">暂无标签</p>
                  )}
                  <p className="text-[10px] text-muted/60 flex items-center gap-1">
                    <ArrowDownToLine className="h-3 w-3" />
                    标签通过系列详情页的标签管理器管理，添加/删除时自动同步到所有卷
                  </p>
                </div>
              </div>
              {/* 简介 */}
              <div>
                <label className="mb-1 block text-xs font-medium text-muted">{t.comicGroup?.description || "简介"}</label>
                <textarea
                  value={metaForm.description}
                  onChange={(e) => setMetaForm(f => ({ ...f, description: e.target.value }))}
                  rows={4}
                  className="w-full rounded-lg bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-accent/30 resize-none"
                />
              </div>
            </div>
            <div className="sticky bottom-0 flex justify-end gap-3 border-t border-border/30 bg-card px-5 py-3 rounded-b-2xl">
              <button
                onClick={() => setShowMetadataEdit(false)}
                className="rounded-lg bg-background px-4 py-2 text-sm text-foreground"
              >
                {t.common.cancel}
              </button>
              <button
                onClick={handleSaveMetadata}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white"
              >
                {t.common.save}
              </button>
            </div>
          </div>
          </div>
      )}

      {/* 添加漫画弹窗 */}
      {showAddComics && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 animate-backdrop-in" onClick={() => { setShowAddComics(false); setAddSearchQuery(""); setAddSearchResults([]); }}>
          <div className="w-[90vw] max-w-md rounded-2xl border border-border bg-card shadow-2xl animate-modal-in" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border/30 px-5 py-3">
              <div className="flex items-center gap-2">
                <Plus className="h-5 w-5 text-accent" />
                <h3 className="text-base font-semibold text-foreground">
                  {t.comicGroup?.addToGroup || "添加漫画"}
                </h3>
              </div>
              <button
                onClick={() => {
                  setShowAddComics(false);
                  setAddSearchQuery("");
                  setAddSearchResults([]);
                }}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-card-hover"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-5 pt-4">
              <input
                type="text"
                value={addSearchQuery}
                onChange={(e) => {
                  setAddSearchQuery(e.target.value);
                  handleAddSearch(e.target.value);
                }}
                placeholder={t.navbar?.searchPlaceholder || "搜索漫画名称..."}
                className="w-full rounded-xl bg-background py-2.5 px-4 text-sm text-foreground placeholder-muted/50 outline-none focus:ring-1 focus:ring-accent/30"
                autoFocus
              />
            </div>
            <div className="max-h-72 overflow-y-auto px-5 py-3">
              {addSearchLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-accent" />
                </div>
              ) : addSearchResults.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8">
                  <p className="text-xs text-muted">
                    {addSearchQuery
                      ? (t.home?.noMatchingComics || "无匹配结果")
                      : (t.comicGroup?.searchComicHint || "输入关键词搜索漫画")}
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {addSearchResults.map((comic) => (
                    <button
                      key={comic.id}
                      onClick={() => handleAddComicToGroup(comic.id)}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-accent/10"
                    >
                      <div className="relative h-10 w-8 flex-shrink-0 overflow-hidden rounded-md bg-muted/10">
                        <Image
                          src={comic.coverUrl}
                          alt={comic.title}
                          fill
                          unoptimized
                          className="object-cover"
                          sizes="32px"
                        />
                      </div>
                      <span className="truncate text-sm text-foreground">{comic.title}</span>
                      <Plus className="h-4 w-4 flex-shrink-0 text-accent/50" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          </div>
      )}

      {/* 继承预览确认弹窗 */}
      {showInheritPreview && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 animate-backdrop-in" onClick={() => { setShowInheritPreview(false); setInheritPreview(null); }}>
          <div className="w-[90vw] max-w-lg rounded-2xl border border-border bg-card shadow-2xl animate-modal-in max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border/30 bg-card px-5 py-3 rounded-t-2xl">
              <div className="flex items-center gap-2">
                <Layers className="h-5 w-5 text-accent" />
                <h3 className="text-base font-semibold text-foreground">
                  {t.comicGroup?.inheritPreviewTitle || "继承预览"}
                </h3>
              </div>
              <button
                onClick={() => {
                  setShowInheritPreview(false);
                  setInheritPreview(null);
                }}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-card-hover"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {inheritPreview ? (
              <div className="p-5 space-y-5">
                {/* 数据来源 */}
                <div className="rounded-xl bg-accent/5 border border-accent/20 px-4 py-3">
                  <p className="text-xs text-muted mb-1">{t.comicGroup?.inheritSource || "数据来源（首卷）"}</p>
                  <p className="text-sm font-medium text-foreground">{inheritPreview.sourceComicTitle}</p>
                </div>

                {/* 系列级别变更 */}
                {inheritPreview.groupChanges?.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
                      <Tag className="h-3.5 w-3.5 text-accent" />
                      {t.comicGroup?.groupLevelChanges || "系列级别变更"}
                    </h4>
                    <div className="space-y-2">
                      {inheritPreview.groupChanges.map((change) => (
                        <div key={change.field} className="flex items-center gap-3 rounded-lg bg-card/80 px-3 py-2">
                          <span className="text-xs text-muted w-14 flex-shrink-0">{change.label}</span>
                          <span className="text-xs text-muted/50 line-through flex-shrink-0">
                            {change.oldValue || "（空）"}
                          </span>
                          <span className="text-xs text-muted mx-1">→</span>
                          <span className="text-xs text-accent font-medium truncate">{change.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 卷级别变更 */}
                {inheritPreview.volumeChanges?.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
                      <BookOpen className="h-3.5 w-3.5 text-accent" />
                      {t.comicGroup?.volumeLevelChanges || "卷级别变更"}
                      <span className="text-xs text-muted font-normal">
                        ({(t.comicGroup?.affectedVolumes || "{count} 卷将受影响").replace("{count}", String(inheritPreview.volumeCount))})
                      </span>
                    </h4>
                    <div className="space-y-2">
                      {inheritPreview.volumeChanges.map((change) => (
                        <div key={change.field} className="flex items-center gap-3 rounded-lg bg-card/80 px-3 py-2">
                          <span className="text-xs text-muted w-14 flex-shrink-0">{change.label}</span>
                          <span className="text-xs text-accent font-medium truncate">{change.value}</span>
                          <span className="text-[10px] text-muted ml-auto flex-shrink-0">{change.oldValue}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 无变更提示 */}
                {(inheritPreview.groupChanges?.length ?? 0) === 0 && (inheritPreview.volumeChanges?.length ?? 0) === 0 && (
                  <div className="flex flex-col items-center justify-center py-8">
                    <Check className="h-10 w-10 text-emerald-400 mb-3" />
                    <p className="text-sm text-foreground/80">
                      {t.comicGroup?.noChangesNeeded || "所有字段已填充，无需继承"}
                    </p>
                  </div>
                )}

                {/* 提示说明 */}
                <p className="text-[10px] text-muted/60 leading-relaxed">
                  {t.comicGroup?.inheritNote || "注意：仅填充为空的字段，不会覆盖已有数据。继承后可在各卷详情页手动调整。"}
                </p>
              </div>
            ) : (
              <div className="flex items-center justify-center py-12">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-accent" />
              </div>
            )}

            {/* 底部按钮 */}
            <div className="sticky bottom-0 flex justify-end gap-3 border-t border-border/30 bg-card px-5 py-3 rounded-b-2xl">
              <button
                onClick={() => {
                  setShowInheritPreview(false);
                  setInheritPreview(null);
                }}
                className="rounded-lg bg-background px-4 py-2 text-sm text-foreground"
              >
                {t.common.cancel}
              </button>
              {inheritPreview && (inheritPreview.groupChanges?.length > 0 || inheritPreview.volumeChanges?.length > 0) && (
                <button
                  onClick={handleConfirmInheritToVolumes}
                  disabled={inheritLoading}
                  className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {inheritLoading ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  {t.comicGroup?.confirmInherit || "确认继承"}
                </button>
              )}
            </div>
          </div>
          </div>
      )}
    </div>
  );
}
