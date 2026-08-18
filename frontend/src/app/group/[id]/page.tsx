"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
  ImagePlus,
  Tag,
  Layers,
  MoreHorizontal,
  RefreshCw,
  ArrowDownToLine,
  Loader2,
  AlertTriangle,
  Copy,
  ListOrdered,
} from "lucide-react";
import { useTranslation, useLocale } from "@/lib/i18n";
import { useToast } from "@/components/Toast";
import { useAuth } from "@/lib/auth-context";
import { calculateStoredReadingProgress, isStoredReadingFinished } from "@/lib/progress";
import {
  fetchGroupDetail,
  updateGroup,
  updateGroupShelfSettings,
  deleteGroup,
  removeComicFromGroup,
  removeSeriesFromGroup,
  reorderGroupSeries,
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
  fetchGroupCategories,
  setGroupCategories as setGroupCategoriesApi,
  syncGroupCategories,
  aiSuggestGroupCategories,
} from "@/api/groups";
import type { ComicGroupDetail, GroupComicItem } from "@/hooks/useComicTypes";
import type { InheritPreview, GroupTag, GroupCategory } from "@/api/groups";
import { GroupMetadataSearch } from "@/components/GroupMetadataSearch";
import { Sparkles, Brain, FolderOpen } from "lucide-react";
import { useAIStatus } from "@/hooks/useAIStatus";
import { useGlobalSyncEvent } from "@/hooks/useSyncEvent";
import { formatFileSize, formatDuration, isNovelFile, getReaderUrl } from "@/lib/comic-utils";
import { apiPath } from "@/lib/base-path";

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

  // 系列级分类管理状态
  const [groupCategories, setGroupCategories] = useState<GroupCategory[]>([]);
  const [allCategories, setAllCategories] = useState<GroupCategory[]>([]);
  const [categorySaving, setCategorySaving] = useState(false);
  const [categorySyncing, setCategorySyncing] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [aiCategoryLoading, setAiCategoryLoading] = useState(false);
  const [aiSuggestedCategories, setAiSuggestedCategories] = useState<string[]>([]);

  // 系列封面更换状态
  const [showCoverMenu, setShowCoverMenu] = useState(false);
  const [showCoverUrlInput, setShowCoverUrlInput] = useState(false);
  const [coverUrlInput, setCoverUrlInput] = useState("");
  const [coverLoading, setCoverLoading] = useState(false);
  const coverFileRef = useRef<HTMLInputElement>(null);

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

  // 目录作品分区拖拽状态。独立于散本拖拽，避免横向滚动轨道互相干扰。
  const [seriesDragId, setSeriesDragId] = useState<string | null>(null);
  const [seriesDragOverId, setSeriesDragOverId] = useState<string | null>(null);
  const [seriesTouchDragId, setSeriesTouchDragId] = useState<string | null>(null);
  const [seriesReordering, setSeriesReordering] = useState(false);
  const [seriesSavingId, setSeriesSavingId] = useState<string | null>(null);
  const [shelfSettingsSaving, setShelfSettingsSaving] = useState(false);
  const seriesListRef = useRef<HTMLDivElement>(null);

  const loadGroup = useCallback(async () => {
    if (!groupId) return;
    setLoading(true);
    const data = await fetchGroupDetail(groupId, contentType);
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

  const handleShelfSettingsChange = useCallback(async (
    shelfSeries: boolean,
    shelfSortMode: "custom" | "publication" | "volume"
  ) => {
    if (!group || shelfSettingsSaving) return;
    setShelfSettingsSaving(true);
    const previous = group;
    setGroup({ ...group, shelfSeries, shelfSortMode });
    const result = await updateGroupShelfSettings(
      group.id,
      shelfSeries,
      shelfSortMode
    );
    if (result.success) {
      toast.success(shelfSeries ? "书架系列设置已更新" : "已停止参与书架系列排序");
    } else {
      setGroup(previous);
      toast.error(result.error || "更新书架系列设置失败");
    }
    setShelfSettingsSaving(false);
  }, [group, shelfSettingsSaving, toast]);

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

  // 加载系列分类
  const loadGroupCategories = useCallback(async () => {
    if (!groupId) return;
    const cats = await fetchGroupCategories(groupId);
    setGroupCategories(cats);
  }, [groupId]);

  // 加载所有可用分类
  const loadAllCategories = useCallback(async () => {
    try {
      const res = await fetch(apiPath("/api/categories"));
      if (res.ok) {
        const data = await res.json();
        setAllCategories((data.categories || []).map((c: Record<string, unknown>) => ({
          id: c.id as number,
          name: c.name as string,
          slug: c.slug as string,
          icon: c.icon as string,
        })));
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadGroupCategories();
    loadAllCategories();
  }, [loadGroupCategories, loadAllCategories]);

  // 添加/移除系列分类
  const handleToggleCategory = useCallback(async (slug: string) => {
    if (!group) return;
    setCategorySaving(true);
    const currentSlugs = groupCategories.map(c => c.slug);
    const isRemoving = currentSlugs.includes(slug);
    const newSlugs = isRemoving
      ? currentSlugs.filter(s => s !== slug)
      : [...currentSlugs, slug];

    const result = await setGroupCategoriesApi(group.id, newSlugs);
    if (result?.success) {
      const cat = allCategories.find(c => c.slug === slug);
      const catName = cat?.name || slug;
      toast.success(
        isRemoving
          ? `已移除分类「${catName}」`
          : `已添加分类「${catName}」${result.syncedTo > 0 ? `，已同步到 ${result.syncedTo} 卷` : ""}`
      );
      await loadGroupCategories();
    }
    setCategorySaving(false);
  }, [group, groupCategories, allCategories, toast, loadGroupCategories]);

  // 同步分类到所有卷
  const handleSyncCategoriesToVolumes = useCallback(async () => {
    if (!group) return;
    setCategorySyncing(true);
    const result = await syncGroupCategories(group.id);
    if (result?.success) {
      toast.success(`同步完成：${result.syncedVolumes}/${result.totalVolumes} 卷已更新`);
    } else {
      toast.error("同步分类失败");
    }
    setCategorySyncing(false);
  }, [group, toast]);

  // AI 建议分类
  const handleAiSuggestCategories = useCallback(async () => {
    if (!group) return;
    setAiCategoryLoading(true);
    setAiSuggestedCategories([]);
    try {
      const result = await aiSuggestGroupCategories(group.id, locale === "en" ? "en" : "zh");
      if (result?.success && result.suggestedCategories?.length > 0) {
        setAiSuggestedCategories(result.suggestedCategories);
      } else {
        toast.info("AI 未生成新分类建议");
      }
    } catch {
      toast.error("AI 分类建议失败");
    }
    setAiCategoryLoading(false);
  }, [group, locale, toast]);

  // 应用 AI 建议的分类
  const handleApplyAiCategories = useCallback(async (slugs: string[]) => {
    if (!group || slugs.length === 0) return;
    setCategorySaving(true);
    const currentSlugs = groupCategories.map(c => c.slug);
    const newSlugs = [...new Set([...currentSlugs, ...slugs])];
    const result = await setGroupCategoriesApi(group.id, newSlugs);
    if (result?.success) {
      const addedCount = newSlugs.length - currentSlugs.length;
      toast.success(`已添加 ${addedCount} 个分类${result.syncedTo > 0 ? `，已同步到 ${result.syncedTo} 卷` : ""}`);
      await loadGroupCategories();
      setAiSuggestedCategories([]);
    }
    setCategorySaving(false);
  }, [group, groupCategories, toast, loadGroupCategories]);

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
        `同步 ${result.tagsAdded} 个标签`
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

  // 系列封面更换：通过URL
  const handleGroupCoverFromUrl = useCallback(async () => {
    if (!group || !coverUrlInput.trim()) return;
    setCoverLoading(true);
    try {
      const ok = await updateGroupMetadata(group.id, { coverUrl: coverUrlInput.trim() });
      if (ok) {
        setGroup((prev) => prev ? { ...prev, coverUrl: coverUrlInput.trim() } : prev);
        setCoverUrlInput("");
        setShowCoverUrlInput(false);
        setShowCoverMenu(false);
        toast.success("封面已更新");
      } else {
        toast.error("封面更新失败");
      }
    } catch {
      toast.error("封面更新失败");
    } finally {
      setCoverLoading(false);
    }
  }, [group, coverUrlInput, toast]);

  // 系列封面更换：上传本地图片（转为base64后通过metadata API保存）
  const handleGroupCoverUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !group) return;
    setCoverLoading(true);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = reader.result as string;
        const ok = await updateGroupMetadata(group.id, { coverUrl: dataUrl });
        if (ok) {
          setGroup((prev) => prev ? { ...prev, coverUrl: dataUrl } : prev);
          setShowCoverMenu(false);
          toast.success("封面已更新");
        } else {
          toast.error("封面更新失败");
        }
        setCoverLoading(false);
      };
      reader.readAsDataURL(file);
    } catch {
      toast.error("封面更新失败");
      setCoverLoading(false);
    } finally {
      if (coverFileRef.current) coverFileRef.current.value = "";
    }
  }, [group, toast]);

  // 系列封面重置：清除自定义封面，回退到首卷封面
  const handleGroupCoverReset = useCallback(async () => {
    if (!group) return;
    setCoverLoading(true);
    try {
      const ok = await updateGroupMetadata(group.id, { coverUrl: "" });
      if (ok) {
        // 重置后使用首卷封面
        const firstComic = group.comics[0];
        const fallbackCover = firstComic ? apiPath(`/api/comics/${firstComic.id}/thumbnail`) : "";
        setGroup((prev) => prev ? { ...prev, coverUrl: fallbackCover } : prev);
        setShowCoverMenu(false);
        toast.success("已恢复默认封面");
      }
    } catch {
      toast.error("重置封面失败");
    } finally {
      setCoverLoading(false);
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
      const removingLastLogicalEntry =
        group.comics.length === 1 && (group.seriesList?.length || 0) === 0;
      const ok = await removeComicFromGroup(group.id, comicId);
      if (!ok) return;
      if (removingLastLogicalEntry) {
        router.push("/collections");
        return;
      }
      await loadGroup();
    },
    [group, removeConfirmId, router, loadGroup]
  );

  const handleRemoveSeries = useCallback(
    async (seriesId: string) => {
      if (!group) return;
      const confirmKey = `series:${seriesId}`;
      if (removeConfirmId !== confirmKey) {
        setRemoveConfirmId(confirmKey);
        return;
      }
      setRemoveConfirmId(null);
      const removingLastLogicalEntry =
        group.comics.length === 0 && (group.seriesList?.length || 0) === 1;
      const ok = await removeSeriesFromGroup(group.id, seriesId);
      if (!ok) return;
      if (removingLastLogicalEntry) {
        router.push("/collections");
        return;
      }
      await loadGroup();
    },
    [group, removeConfirmId, router, loadGroup]
  );

  // 拖拽排序
  const handleDragEnd = useCallback(async () => {
    if (!group || !dragId || !dragOverId || dragId === dragOverId) {
      setDragId(null);
      setDragOverId(null);
      return;
    }
    const previous = group.comics;
    const items = [...previous];
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

    const ok = await reorderGroupComics(
      group.id,
      items.map((c) => c.id)
    );
    if (!ok) {
      setGroup((current) => (current ? { ...current, comics: previous } : current));
      toast.error("其他作品排序保存失败");
    }
  }, [group, dragId, dragOverId, toast]);

  const persistSeriesOrder = useCallback(async (sourceID: string, targetID: string) => {
    if (!group?.seriesList || sourceID === targetID || seriesReordering) return;
    const previous = group.seriesList;
    const next = [...previous];
    const fromIndex = next.findIndex((series) => series.id === sourceID);
    const toIndex = next.findIndex((series) => series.id === targetID);
    if (fromIndex < 0 || toIndex < 0) return;

    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    setGroup((current) => current ? { ...current, seriesList: next } : current);
    setSeriesReordering(true);
    setSeriesSavingId(sourceID);
    const ok = await reorderGroupSeries(group.id, next.map((series) => series.id));
    if (!ok) {
      setGroup((current) => current ? { ...current, seriesList: previous } : current);
      toast.error("目录作品排序保存失败");
    }
    setSeriesReordering(false);
    setSeriesSavingId(null);
  }, [group, seriesReordering, toast]);

  const handleSeriesTouchMove = useCallback((event: React.TouchEvent) => {
    if (!seriesTouchDragId || !seriesListRef.current) return;
    event.preventDefault();
    const touchY = event.touches[0].clientY;
    const sections = seriesListRef.current.querySelectorAll<HTMLElement>("[data-series-id]");
    for (const section of sections) {
      const rect = section.getBoundingClientRect();
      if (touchY >= rect.top && touchY <= rect.bottom) {
        const targetID = section.dataset.seriesId;
        if (targetID) setSeriesDragOverId(targetID);
        break;
      }
    }
  }, [seriesTouchDragId]);

  const handleSeriesTouchEnd = useCallback(() => {
    const sourceID = seriesTouchDragId;
    const targetID = seriesDragOverId;
    setSeriesTouchDragId(null);
    setSeriesDragOverId(null);
    if (sourceID && targetID) void persistSeriesOrder(sourceID, targetID);
  }, [seriesTouchDragId, seriesDragOverId, persistSeriesOrder]);

  // 搜索漫画用于添加到系列（带防抖）
  const handleAddSearchImmediate = useCallback(async (query: string) => {
    if (!query.trim()) {
      setAddSearchResults([]);
      return;
    }
    setAddSearchLoading(true);
    try {
      const res = await fetch(apiPath(`/api/comics?search=${encodeURIComponent(query)}&page=1&pageSize=20`));
      if (res.ok) {
        const data = await res.json();
        const existingIds = new Set(group?.comics.map(c => c.id) || []);
        setAddSearchResults(
          (data.comics || []).filter((c: any) => !existingIds.has(c.id)).map((c: any) => ({
            id: c.id,
            title: c.title,
            coverUrl: apiPath(`/api/comics/${c.id}/thumbnail`),
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
    const fromSeries = group.comics.length === 0 && (group.seriesList?.length || 0) === 1;
    const ok = await inheritGroupMetadata(group.id);
    if (ok) {
      toast.success(fromSeries ? "已从目录作品继承元数据" : (t.comicGroup?.inheritSuccess || "元数据继承成功"));
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

  // 合集既可以包含散本，也可以包含目录作品；统计时汇总全部阅读单元并按 ID 去重。
  const readingUnits = useMemo(() => {
    const units = new Map<string, GroupComicItem>();
    for (const comic of group?.comics || []) {
      units.set(comic.id, comic);
    }
    for (const series of group?.seriesList || []) {
      for (const comic of series.comics || []) {
        units.set(comic.id, comic);
      }
    }
    return Array.from(units.values());
  }, [group]);

  const totalPages = readingUnits.reduce((sum, comic) => sum + comic.pageCount, 0);
  const totalReadTime = readingUnits.reduce((sum, comic) => sum + comic.totalReadTime, 0);
  const totalSize = readingUnits.reduce((sum, comic) => sum + comic.fileSize, 0);

  // 查找继续阅读的卷
  const continueVolume = readingUnits.find(
    (c) => !!c.lastReadAt && !isStoredReadingFinished(c.lastReadPage, c.pageCount, c.lastReadAt, c.readingStatus)
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

  const directorySeriesCount = group.seriesList?.length || 0;
  const singleSeriesOnly = group.comics.length === 0 && directorySeriesCount === 1;
  const allowGroupMemberSync = directorySeriesCount === 0;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-30 border-b border-border/30 bg-background/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1200px] items-center gap-3 px-4 py-3">
          <button
            onClick={() => {
              // 直接返回首页，避免 back() 可能回到阅读页面导致循环
              router.push("/");
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
              <div className="group/cover relative h-[280px] w-[200px] overflow-hidden rounded-xl shadow-lg shadow-black/20">
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
                <div className="absolute top-2 right-2 rounded-lg bg-accent px-2 py-1 text-xs font-bold text-white shadow-lg z-10">
                  {group.comicCount}
                </div>

                {/* 管理员：封面更换按钮 */}
                {isAdmin && (
                  <div className="absolute inset-0 flex items-end justify-center bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-100 sm:opacity-0 transition-opacity sm:group-hover/cover:opacity-100">
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
                      更换封面
                    </button>
                  </div>
                )}

                {/* 封面更换菜单 */}
                {showCoverMenu && (
                  <div className="absolute bottom-0 left-0 right-0 z-20 rounded-b-xl bg-zinc-900/95 p-3 backdrop-blur-sm">
                    <div className="space-y-1.5">
                      {/* 上传本地图片 */}
                      <button
                        onClick={() => coverFileRef.current?.click()}
                        disabled={coverLoading}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-zinc-200 transition-colors hover:bg-zinc-700/60"
                      >
                        <ImagePlus className="h-3.5 w-3.5" />
                        上传本地图片
                      </button>

                      {/* 输入图片URL */}
                      <button
                        onClick={() => setShowCoverUrlInput(!showCoverUrlInput)}
                        disabled={coverLoading}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-zinc-200 transition-colors hover:bg-zinc-700/60"
                      >
                        <Globe className="h-3.5 w-3.5" />
                        输入图片URL
                      </button>

                      {showCoverUrlInput && (
                        <div className="flex gap-1.5 px-1">
                          <input
                            type="text"
                            value={coverUrlInput}
                            onChange={(e) => setCoverUrlInput(e.target.value)}
                            placeholder="https://..."
                            className="flex-1 rounded-md bg-zinc-800 px-2 py-1.5 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-accent"
                            onKeyDown={(e) => e.key === "Enter" && handleGroupCoverFromUrl()}
                          />
                          <button
                            onClick={handleGroupCoverFromUrl}
                            disabled={coverLoading || !coverUrlInput.trim()}
                            className="rounded-md bg-accent px-2 py-1.5 text-xs text-white disabled:opacity-50"
                          >
                            OK
                          </button>
                        </div>
                      )}

                      {/* 恢复默认封面 */}
                      <button
                        onClick={handleGroupCoverReset}
                        disabled={coverLoading}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-zinc-200 transition-colors hover:bg-zinc-700/60"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        恢复默认封面
                      </button>
                    </div>
                    <button
                      onClick={() => { setShowCoverMenu(false); setShowCoverUrlInput(false); }}
                      className="mt-2 w-full rounded-lg py-1.5 text-xs text-zinc-400 transition-colors hover:text-zinc-200"
                    >
                      取消
                    </button>
                  </div>
                )}
              </div>
              {/* 隐藏的文件上传input */}
              <input
                ref={coverFileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleGroupCoverUpload}
              />
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

              {/* 系列分类管理 */}
              {(groupCategories.length > 0 || isAdmin) && (
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-medium uppercase tracking-wider text-muted flex items-center gap-1.5">
                      <FolderOpen className="h-3 w-3" />
                      分类
                      {groupCategories.length > 0 && (
                        <span className="text-[10px] text-muted/60">({groupCategories.length})</span>
                      )}
                    </h4>
                    {isAdmin && groupCategories.length > 0 && (
                      <button
                        onClick={handleSyncCategoriesToVolumes}
                        disabled={categorySyncing}
                        className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] text-accent/80 transition-colors hover:bg-accent/10"
                        title="将系列分类同步到所有卷"
                      >
                        {categorySyncing ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3 w-3" />
                        )}
                        <span>同步到所有卷</span>
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {groupCategories.map((cat) => (
                      <span
                        key={cat.id}
                        className="group flex items-center gap-1 rounded-lg bg-blue-500/10 px-2.5 py-1 text-xs text-blue-400"
                      >
                        <span className="text-sm">{cat.icon}</span>
                        {cat.name}
                        {isAdmin && (
                          <button
                            onClick={() => handleToggleCategory(cat.slug)}
                            disabled={categorySaving}
                            className="ml-0.5 rounded-full p-0.5 opacity-0 transition-all group-hover:opacity-100 hover:bg-white/10"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </span>
                    ))}
                    {groupCategories.length === 0 && !isAdmin && (
                      <span className="text-xs text-muted/50">暂无分类</span>
                    )}
                  </div>
                  {isAdmin && (
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={() => setShowCategoryPicker(!showCategoryPicker)}
                        className="flex items-center gap-1.5 rounded-lg bg-blue-500/15 px-2.5 py-1.5 text-xs font-medium text-blue-400 transition-colors hover:bg-blue-500/25"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <span>选择分类</span>
                      </button>
                      {aiConfigured && (
                        <button
                          onClick={handleAiSuggestCategories}
                          disabled={aiCategoryLoading}
                          className="flex items-center gap-1.5 rounded-lg bg-purple-500/15 px-2.5 py-1.5 text-xs font-medium text-purple-400 transition-colors hover:bg-purple-500/25 disabled:opacity-50"
                          title="AI 智能分类"
                        >
                          {aiCategoryLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Brain className="h-3.5 w-3.5" />}
                          <span className="hidden sm:inline">{aiCategoryLoading ? "AI 分析中..." : "AI 分类"}</span>
                        </button>
                      )}
                    </div>
                  )}

                  {/* 分类选择器 */}
                  {showCategoryPicker && (
                    <div className="mt-3 rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-medium text-blue-400 flex items-center gap-1.5">
                          <FolderOpen className="h-3.5 w-3.5" />
                          选择分类
                        </span>
                        <button
                          onClick={() => setShowCategoryPicker(false)}
                          className="rounded-md p-0.5 text-muted hover:text-foreground"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {allCategories.length === 0 ? (
                          <span className="text-xs text-muted/50">暂无可用分类，请先在设置中初始化分类</span>
                        ) : (
                          allCategories.map((cat) => {
                            const isSelected = groupCategories.some(gc => gc.slug === cat.slug);
                            return (
                              <button
                                key={cat.slug}
                                onClick={() => handleToggleCategory(cat.slug)}
                                disabled={categorySaving}
                                className={`rounded-md px-2 py-1 text-xs transition-all ${
                                  isSelected
                                    ? "bg-blue-500/20 text-blue-300 ring-1 ring-blue-500/40"
                                    : "bg-card text-muted hover:text-foreground hover:bg-card-hover"
                                }`}
                              >
                                <span className="mr-1">{cat.icon}</span>
                                {cat.name}
                                {isSelected && <Check className="ml-1 inline h-3 w-3" />}
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}

                  {/* AI 建议分类展示 */}
                  {aiSuggestedCategories.length > 0 && (
                    <div className="mt-3 rounded-lg border border-purple-500/20 bg-purple-500/5 p-3">
                      <div className="mb-2 flex items-center gap-2 text-xs text-purple-400">
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>AI 建议分类</span>
                      </div>
                      <div className="mb-3 flex flex-wrap gap-1.5">
                        {aiSuggestedCategories.map((slug) => {
                          const cat = allCategories.find(c => c.slug === slug);
                          return (
                            <span
                              key={slug}
                              className="rounded-md bg-purple-500/20 px-2 py-1 text-xs text-purple-300 ring-1 ring-purple-500/40"
                            >
                              {cat ? `${cat.icon} ${cat.name}` : slug}
                            </span>
                          );
                        })}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleApplyAiCategories(aiSuggestedCategories)}
                          disabled={categorySaving}
                          className="rounded-md bg-purple-500/20 px-3 py-1 text-xs font-medium text-purple-300 transition-colors hover:bg-purple-500/30 disabled:opacity-40"
                        >
                          全部添加 ({aiSuggestedCategories.length})
                        </button>
                        <button
                          onClick={() => setAiSuggestedCategories([])}
                          className="rounded-md px-2 py-1 text-xs text-muted hover:text-foreground"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  )}

                  {isAdmin && groupCategories.length > 0 && (
                    <p className="mt-1.5 text-[10px] text-muted/50 flex items-center gap-1">
                      <ArrowDownToLine className="h-3 w-3" />
                      添加/删除分类时自动同步到系列内所有卷
                    </p>
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
                    {(group.comics.length > 0 || singleSeriesOnly) && (
                      <button
                        onClick={handleInheritMetadata}
                        className={`flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm transition-colors ${
                          singleSeriesOnly
                            ? "bg-accent/10 text-accent hover:bg-accent/20"
                            : "bg-card text-foreground/80 hover:bg-card-hover"
                        }`}
                        title={singleSeriesOnly ? "从唯一的目录作品继承合集展示元数据" : (t.comicGroup?.inheritMetadataDesc || "从系列第一本漫画继承元数据")}
                      >
                        <Download className="h-3.5 w-3.5" />
                        {singleSeriesOnly ? "从目录作品继承" : (t.comicGroup?.inheritMetadata || "从首卷继承")}
                      </button>
                    )}
                    {allowGroupMemberSync && group.comics.length > 1 && (
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
                      className={`flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm transition-colors ${
                        singleSeriesOnly
                          ? "bg-card text-muted hover:bg-card-hover hover:text-foreground"
                          : "bg-purple-500/10 text-purple-400 hover:bg-purple-500/20"
                      }`}
                      title="从在线数据库搜索并获取系列信息，支持 AI 智能识别"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      {singleSeriesOnly ? "在线刮削（高级）" : (t.comicGroup?.scrapeMetadata || "刮削元数据")}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {isAdmin && (
          <section className="mb-7 border-y border-border/40 py-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                  <ListOrdered className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">书架系列排序</div>
                  <p className="mt-1 text-xs leading-5 text-muted">
                    启用后，合集名称决定整个系列在按标题书架中的位置，内部顺序不会随升降序反转。
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 sm:flex-nowrap">
                {group.shelfSeries && (
                  <select
                    value={group.shelfSortMode || "custom"}
                    disabled={shelfSettingsSaving}
                    onChange={(event) => handleShelfSettingsChange(
                      true,
                      event.target.value as "custom" | "publication" | "volume"
                    )}
                    className="h-9 rounded-lg border border-border/60 bg-card px-3 text-sm text-foreground outline-none focus:border-accent/60 disabled:opacity-50"
                    aria-label="系列内部排序方式"
                  >
                    <option value="custom">自定义拖动顺序</option>
                    <option value="publication">出版年份</option>
                    <option value="volume">卷号与标题</option>
                  </select>
                )}
                <button
                  type="button"
                  role="switch"
                  aria-checked={group.shelfSeries}
                  aria-label="作为书架系列排序"
                  disabled={shelfSettingsSaving}
                  onClick={() => handleShelfSettingsChange(!group.shelfSeries, group.shelfSortMode || "custom")}
                  className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                    group.shelfSeries ? "bg-accent" : "bg-border"
                  }`}
                >
                  <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                    group.shelfSeries ? "translate-x-6" : "translate-x-1"
                  }`} />
                </button>
              </div>
            </div>
          </section>
        )}

        {/* 合集内容 */}
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-foreground">
            作品 ({readingUnits.length})
          </h3>
        </div>

        {(group.seriesList?.length || 0) > 0 && (
          <div ref={seriesListRef} className="space-y-7">
            {group.seriesList!.map((series) => {
              const confirmKey = `series:${series.id}`;
              return (
                <section
                  key={series.id}
                  data-series-id={series.id}
                  className={`border-b border-border/50 pb-6 transition-colors ${
                    seriesDragOverId === series.id && seriesDragId !== series.id
                      ? "border-l-2 border-l-accent bg-accent/[0.03] pl-3"
                      : ""
                  }`}
                  onDragOver={isAdmin ? (event) => {
                    event.preventDefault();
                    setSeriesDragOverId(series.id);
                  } : undefined}
                  onDrop={isAdmin ? (event) => {
                    event.preventDefault();
                    const sourceID = seriesDragId;
                    setSeriesDragId(null);
                    setSeriesDragOverId(null);
                    if (sourceID) void persistSeriesOrder(sourceID, series.id);
                  } : undefined}
                >
                  <div className="mb-3 flex min-w-0 items-center gap-2">
                    {isAdmin && group.seriesList!.length > 1 && (
                      <button
                        type="button"
                        draggable={!seriesReordering}
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = "move";
                          setSeriesDragId(series.id);
                          setSeriesDragOverId(series.id);
                        }}
                        onDragEnd={() => {
                          setSeriesDragId(null);
                          setSeriesDragOverId(null);
                        }}
                        onTouchStart={(event) => {
                          event.stopPropagation();
                          setSeriesTouchDragId(series.id);
                          setSeriesDragOverId(series.id);
                        }}
                        onTouchMove={handleSeriesTouchMove}
                        onTouchEnd={handleSeriesTouchEnd}
                        onTouchCancel={() => {
                          setSeriesTouchDragId(null);
                          setSeriesDragOverId(null);
                        }}
                        className="flex h-8 w-8 flex-none cursor-grab items-center justify-center rounded-md text-muted transition-colors hover:bg-card hover:text-foreground active:cursor-grabbing disabled:cursor-wait"
                        style={{ touchAction: "none" }}
                        title="拖动调整目录作品顺序"
                        aria-label="拖动调整目录作品顺序"
                        disabled={seriesReordering}
                      >
                        {seriesSavingId === series.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <GripVertical className="h-4 w-4" />
                        )}
                      </button>
                    )}
                    <Link href={`/series/${series.id}`} className="min-w-0 hover:text-accent">
                      <h4 className="truncate text-sm font-semibold text-foreground sm:text-base" title={series.title}>
                        {series.title}
                      </h4>
                    </Link>
                    <span className="flex-none text-xs text-muted">{series.comics.length} 个阅读单元</span>
                    <div className="flex-1" />
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => handleRemoveSeries(series.id)}
                        onMouseLeave={() => { if (removeConfirmId === confirmKey) setRemoveConfirmId(null); }}
                        className={`flex h-8 flex-none items-center justify-center rounded-md transition-colors ${removeConfirmId === confirmKey ? "w-auto bg-red-500/15 px-2 text-red-400" : "w-8 text-muted hover:bg-red-500/10 hover:text-red-400"}`}
                        title={removeConfirmId === confirmKey ? (t.common?.confirm || "确认") : "从合集中移除目录作品"}
                      >
                        {removeConfirmId === confirmKey ? <span className="text-[10px]">{t.common?.confirm || "确认"}?</span> : <X className="h-4 w-4" />}
                      </button>
                    )}
                  </div>
                  <div className="flex gap-3 overflow-x-auto pb-2">
                    {series.comics.map((comic) => (
                      <HorizontalComicCard key={comic.id} comic={comic} />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}

        {group.comics.length > 0 && (
          <section className={`${(group.seriesList?.length || 0) > 0 ? "mt-7" : ""} pb-4`}>
            <div className="mb-3 flex items-center gap-2">
              <h4 className="text-sm font-semibold text-foreground sm:text-base">其他作品</h4>
              <span className="text-xs text-muted">{group.comics.length} 个阅读单元</span>
            </div>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {group.comics.map((comic) => (
                <HorizontalComicCard
                  key={comic.id}
                  comic={comic}
                  draggable={isAdmin && group.comics.length > 1}
                  dragOver={dragOverId === comic.id && dragId !== comic.id}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    setDragId(comic.id);
                    setDragOverId(comic.id);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragOverId(comic.id);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    void handleDragEnd();
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setDragOverId(null);
                  }}
                  removable={isAdmin}
                  confirmingRemove={removeConfirmId === comic.id}
                  onRemove={() => handleRemoveComic(comic.id)}
                  onRemoveMouseLeave={() => {
                    if (removeConfirmId === comic.id) setRemoveConfirmId(null);
                  }}
                />
              ))}
            </div>
          </section>
        )}

        {group.comics.length === 0 && (group.seriesList?.length || 0) === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-lg bg-card">
              <BookOpen className="h-9 w-9 text-muted/40" />
            </div>
            <p className="text-sm text-muted">
              {t.comicGroup?.emptyGroup || "此系列还没有漫画"}
            </p>
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
                {allowGroupMemberSync
                  ? "从 AniList、Bangumi 等在线数据库搜索系列信息，或使用 AI 智能识别。"
                  : "在线结果只用于合集自身的展示信息，不会覆盖目录作品及其阅读单元。"}
              </p>
              <GroupMetadataSearch
                groupId={group.id}
                groupName={group.name}
                allowMemberSync={allowGroupMemberSync}
                contentType={
                  // 根据系列内漫画的类型自动检测：超过一半是小说则为 novel
                  group.comics.length > 0 &&
                  group.comics.filter((c) => c.type === "novel").length > group.comics.length / 2
                    ? "novel"
                    : "comic"
                }
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

interface HorizontalComicCardProps {
  comic: GroupComicItem;
  draggable?: boolean;
  dragOver?: boolean;
  removable?: boolean;
  confirmingRemove?: boolean;
  onDragStart?: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragOver?: (event: React.DragEvent<HTMLDivElement>) => void;
  onDrop?: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd?: () => void;
  onRemove?: () => void;
  onRemoveMouseLeave?: () => void;
}

function HorizontalComicCard({
  comic,
  draggable = false,
  dragOver = false,
  removable = false,
  confirmingRemove = false,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onRemove,
  onRemoveMouseLeave,
}: HorizontalComicCardProps) {
  const progress = comic.pageCount > 0
    ? calculateStoredReadingProgress(comic.lastReadPage, comic.pageCount, comic.lastReadAt, comic.readingStatus)
    : 0;

  return (
    <div
      className={`group relative w-28 flex-none sm:w-32 ${
        draggable ? "cursor-grab active:cursor-grabbing" : ""
      } ${dragOver ? "rounded-md ring-2 ring-accent" : ""}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      <Link href={`/comic/${comic.id}`} className="block">
        <div className="overflow-hidden rounded-md border border-border/60 bg-card transition-colors group-hover:border-accent/40">
          <div className="relative aspect-[5/7] w-full overflow-hidden bg-background">
            {comic.coverUrl ? (
              <Image
                src={comic.coverUrl}
                alt={comic.title}
                fill
                unoptimized
                draggable={false}
                className="object-cover transition-transform duration-300 group-hover:scale-105"
                sizes="(max-width: 640px) 112px, 128px"
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <BookOpen className="h-8 w-8 text-muted/30" />
              </div>
            )}
            {progress > 0 && (
              <div className="absolute inset-x-0 bottom-0 h-1 bg-black/30">
                <div
                  className={`h-full ${progress >= 100 ? "bg-emerald-400" : "bg-accent"}`}
                  style={{ width: `${Math.min(progress, 100)}%` }}
                />
              </div>
            )}
          </div>
          <div className="min-h-14 p-2">
            <h5 className="line-clamp-2 text-xs font-medium leading-4 text-foreground" title={comic.title}>
              {comic.title}
            </h5>
            <p className="mt-1 text-[10px] text-muted">{comic.pageCount} 页</p>
          </div>
        </div>
      </Link>
      {removable && (
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onRemove?.();
          }}
          onMouseLeave={onRemoveMouseLeave}
          className={`absolute left-1.5 top-1.5 z-10 flex h-6 items-center justify-center rounded-md text-white transition-opacity sm:opacity-0 sm:group-hover:opacity-100 ${
            confirmingRemove ? "w-auto bg-red-500 px-1.5" : "w-6 bg-black/65 hover:bg-red-500"
          }`}
          title={confirmingRemove ? "确认移除" : "从合集中移除"}
        >
          {confirmingRemove ? <span className="text-[9px]">确认?</span> : <X className="h-3 w-3" />}
        </button>
      )}
    </div>
  );
}
