"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Image from "next/image";
import { apiPath } from "@/lib/base-path";
import {
  X,
  User,
  Layers,
  CheckCircle,
  AlertCircle,
  Clock,
  Sparkles,
  BookOpen,
  Loader2,
  Pencil,
  Save,
  ImagePlus,
  Globe,
  RefreshCw,
  Tag,
  Plus,
  Download,
  ArrowDownToLine,
  Copy,
  AlertTriangle,
  Check,
  FolderOpen,
  Brain,
} from "lucide-react";
import {
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
import type { InheritPreview, GroupTag, GroupCategory } from "@/api/groups";
import { loadScraperGroups } from "@/lib/scraper-store";
import type { ScraperGroup } from "@/lib/scraper-store";
import { GroupMetadataSearch } from "./GroupMetadataSearch";
import { useToast } from "@/components/Toast";
import { useAIStatus } from "@/hooks/useAIStatus";
import { useLocale } from "@/lib/i18n/context";
import { useTranslation } from "@/lib/i18n";

/* ── 可编辑字段定义 ── */
interface EditableField {
  key: string;
  label: string;
  type: "text" | "textarea" | "number";
  placeholder?: string;
}

const EDITABLE_FIELDS: EditableField[] = [
  { key: "author", label: "作者", type: "text", placeholder: "输入作者名" },
  { key: "genre", label: "类型", type: "text", placeholder: "如：科幻, 冒险, 幽默" },
  { key: "year", label: "年份", type: "number", placeholder: "如：2002" },
  { key: "publisher", label: "出版社", type: "text", placeholder: "输入出版社" },
  { key: "language", label: "语言", type: "text", placeholder: "如：zh, ja, en" },
  { key: "status", label: "状态", type: "text", placeholder: "如：连载中, 已完结" },
  { key: "description", label: "简介", type: "textarea", placeholder: "输入简介..." },
];

/* ── 内联编辑字段组件 ── */
function InlineEditField({
  label,
  value,
  type,
  placeholder,
  saving,
  onSave,
}: {
  label: string;
  value: string;
  type: "text" | "textarea" | "number";
  placeholder?: string;
  saving: boolean;
  onSave: (newValue: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState(value);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      if (inputRef.current instanceof HTMLTextAreaElement) {
        inputRef.current.style.height = "auto";
        inputRef.current.style.height = inputRef.current.scrollHeight + "px";
      }
    }
  }, [editing]);

  const handleSave = async () => {
    const trimmed = inputValue.trim();
    if (trimmed === value) {
      setEditing(false);
      return;
    }
    await onSave(trimmed);
    setEditing(false);
  };

  const handleCancel = () => {
    setInputValue(value);
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && type !== "textarea") {
      e.preventDefault();
      handleSave();
    }
    if (e.key === "Escape") {
      handleCancel();
    }
  };

  if (editing) {
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-muted/50 text-[11px] font-medium">{label}</span>
          <div className="flex items-center gap-1">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium text-accent bg-accent/10 hover:bg-accent/20 transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Save className="h-2.5 w-2.5" />}
              保存
            </button>
            <button
              onClick={handleCancel}
              disabled={saving}
              className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium text-muted hover:text-foreground bg-card-hover hover:bg-card-hover/80 transition-colors disabled:opacity-50"
            >
              <X className="h-2.5 w-2.5" />
              取消
            </button>
          </div>
        </div>
        {type === "textarea" ? (
          <textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = e.target.scrollHeight + "px";
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") handleCancel();
            }}
            placeholder={placeholder}
            disabled={saving}
            rows={3}
            className="w-full rounded-lg bg-card-hover/60 px-2.5 py-1.5 text-xs text-foreground outline-none border border-accent/40 focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all disabled:opacity-50 resize-none leading-relaxed"
          />
        ) : (
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            type={type}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={saving}
            className="w-full rounded-lg bg-card-hover/60 px-2.5 py-1.5 text-xs text-foreground outline-none border border-accent/40 focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all disabled:opacity-50"
          />
        )}
      </div>
    );
  }

  const hasValue = value !== "" && value !== undefined && value !== null;
  return (
    <div
      className="group/field flex items-start gap-2 text-xs cursor-pointer rounded-lg px-1 py-0.5 -mx-1 hover:bg-card-hover/40 transition-colors"
      onClick={() => setEditing(true)}
      title="点击编辑"
    >
      <span className="text-muted/50 w-12 flex-shrink-0 pt-0.5">{label}</span>
      <span className={`flex-1 min-w-0 ${hasValue ? "text-foreground/70" : "text-muted/30 italic"}`}>
        {hasValue ? (type === "textarea" ? <span className="line-clamp-3">{value}</span> : value) : `未设置`}
      </span>
      <Pencil className="h-3 w-3 text-muted/30 opacity-0 group-hover/field:opacity-100 transition-opacity flex-shrink-0 mt-0.5" />
    </div>
  );
}

/* ── 可编辑标题组件 ── */
function EditableTitle({
  value,
  saving,
  onSave,
}: {
  value: string;
  saving: boolean;
  onSave: (newValue: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState(value);

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  const handleSave = async () => {
    const trimmed = inputValue.trim();
    if (!trimmed || trimmed === value) {
      setEditing(false);
      setInputValue(value);
      return;
    }
    await onSave(trimmed);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="space-y-1.5">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape") { setEditing(false); setInputValue(value); }
          }}
          autoFocus
          disabled={saving}
          className="w-full rounded-lg bg-card-hover/60 px-2.5 py-1.5 text-sm font-bold text-foreground outline-none border border-accent/40 focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all disabled:opacity-50"
        />
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-[10px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <CheckCircle className="h-2.5 w-2.5" />}
            保存
          </button>
          <button
            onClick={() => { setEditing(false); setInputValue(value); }}
            disabled={saving}
            className="flex items-center gap-1 rounded-md bg-card-hover px-2 py-0.5 text-[10px] font-medium text-muted transition-colors hover:text-foreground disabled:opacity-50"
          >
            <X className="h-2.5 w-2.5" />
            取消
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="group flex items-start gap-1 cursor-pointer"
      onClick={() => { setInputValue(value); setEditing(true); }}
      title="点击编辑系列名称"
    >
      <h4 className="text-base font-bold text-foreground leading-tight line-clamp-2 flex-1">{value}</h4>
      <span className="opacity-0 group-hover:opacity-100 transition-opacity mt-0.5 flex-shrink-0">
        <Pencil className="h-3.5 w-3.5 text-muted" />
      </span>
    </div>
  );
}

/* ── 系列详情面板主组件 ── */
export default function GroupDetailPanel({
  group,
  onClose,
}: {
  group: ScraperGroup;
  onClose: () => void;
}) {
  const toast = useToast();
  const t = useTranslation();
  const { aiConfigured } = useAIStatus();
  const { locale } = useLocale();

  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  // 封面更换状态
  const [showCoverMenu, setShowCoverMenu] = useState(false);
  const [showCoverUrlInput, setShowCoverUrlInput] = useState(false);
  const [coverUrlInput, setCoverUrlInput] = useState("");
  const [coverLoading, setCoverLoading] = useState(false);
  const [localCoverUrl, setLocalCoverUrl] = useState(group.coverUrl);
  const coverFileRef = useRef<HTMLInputElement>(null);

  // 标签管理状态
  const [groupTags, setGroupTags] = useState<GroupTag[]>([]);
  const [newTagInput, setNewTagInput] = useState("");
  const [tagSaving, setTagSaving] = useState(false);
  const [tagSyncing, setTagSyncing] = useState(false);
  const [overrideConfirm, setOverrideConfirm] = useState(false);
  const [overrideLoading, setOverrideLoading] = useState(false);
  const [aiSuggestLoading, setAiSuggestLoading] = useState(false);
  const [aiSuggestedTags, setAiSuggestedTags] = useState<string[]>([]);
  const [aiSelectedTags, setAiSelectedTags] = useState<Set<string>>(new Set());

  // 分类管理状态
  const [groupCategories, setGroupCategories] = useState<GroupCategory[]>([]);
  const [allCategories, setAllCategories] = useState<GroupCategory[]>([]);
  const [categorySaving, setCategorySaving] = useState(false);
  const [categorySyncing, setCategorySyncing] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [aiCategoryLoading, setAiCategoryLoading] = useState(false);
  const [aiSuggestedCategories, setAiSuggestedCategories] = useState<string[]>([]);

  // 继承元数据状态
  const [inheritLoading, setInheritLoading] = useState(false);
  const [showInheritPreview, setShowInheritPreview] = useState(false);
  const [inheritPreview, setInheritPreview] = useState<InheritPreview | null>(null);

  // 清除保存成功提示
  useEffect(() => {
    if (saveSuccess) {
      const timer = setTimeout(() => setSaveSuccess(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [saveSuccess]);

  // 同步封面URL
  useEffect(() => {
    setLocalCoverUrl(group.coverUrl);
  }, [group.coverUrl]);

  // 加载标签
  const loadTags = useCallback(async () => {
    const tags = await fetchGroupTags(group.id);
    setGroupTags(tags);
  }, [group.id]);

  useEffect(() => { loadTags(); }, [loadTags]);

  // 加载分类
  const loadCategories = useCallback(async () => {
    const cats = await fetchGroupCategories(group.id);
    setGroupCategories(cats);
  }, [group.id]);

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
    loadCategories();
    loadAllCategories();
  }, [loadCategories, loadAllCategories]);

  // ── 保存单个字段 ──
  const handleSaveField = useCallback(async (fieldKey: string, newValue: string) => {
    setSaving(true);
    try {
      const metadata: Record<string, unknown> = {};
      if (fieldKey === "year") {
        const num = parseInt(newValue, 10);
        metadata[fieldKey] = isNaN(num) ? null : num;
      } else {
        metadata[fieldKey] = newValue;
      }
      const ok = await updateGroupMetadata(group.id, metadata);
      if (ok) {
        setSaveSuccess(fieldKey);
        loadScraperGroups();
      }
    } finally {
      setSaving(false);
    }
  }, [group.id]);

  // 获取字段当前值
  const getFieldValue = (key: string): string => {
    switch (key) {
      case "author": return group.author || "";
      case "genre": return group.genre || "";
      case "year": return group.year != null ? String(group.year) : "";
      case "publisher": return group.publisher || "";
      case "language": return group.language || "";
      case "status": return group.status || "";
      case "description": return group.description || "";
      default: return "";
    }
  };

  // ── 封面更换：通过URL ──
  const handleCoverFromUrl = useCallback(async () => {
    if (!coverUrlInput.trim()) return;
    setCoverLoading(true);
    try {
      const ok = await updateGroupMetadata(group.id, { coverUrl: coverUrlInput.trim() });
      if (ok) {
        setLocalCoverUrl(coverUrlInput.trim());
        setCoverUrlInput("");
        setShowCoverUrlInput(false);
        setShowCoverMenu(false);
        toast.success("封面已更新");
        loadScraperGroups();
      } else {
        toast.error("封面更新失败");
      }
    } catch {
      toast.error("封面更新失败");
    } finally {
      setCoverLoading(false);
    }
  }, [group.id, coverUrlInput, toast]);

  // ── 封面更换：上传本地图片 ──
  const handleCoverUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCoverLoading(true);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = reader.result as string;
        const ok = await updateGroupMetadata(group.id, { coverUrl: dataUrl });
        if (ok) {
          setLocalCoverUrl(dataUrl);
          setShowCoverMenu(false);
          toast.success("封面已更新");
          loadScraperGroups();
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
  }, [group.id, toast]);

  // ── 封面重置 ──
  const handleCoverReset = useCallback(async () => {
    setCoverLoading(true);
    try {
      const ok = await updateGroupMetadata(group.id, { coverUrl: "" });
      if (ok) {
        setLocalCoverUrl("");
        setShowCoverMenu(false);
        toast.success("已恢复默认封面");
        loadScraperGroups();
      }
    } catch {
      toast.error("重置封面失败");
    } finally {
      setCoverLoading(false);
    }
  }, [group.id, toast]);

  // ── 标签管理 ──
  const handleAddTag = useCallback(async () => {
    if (!newTagInput.trim()) return;
    setTagSaving(true);
    const currentNames = groupTags.map(t => t.name);
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
      await loadTags();
    }
    setTagSaving(false);
  }, [group.id, newTagInput, groupTags, toast, loadTags]);

  const handleRemoveTag = useCallback(async (tagName: string) => {
    setTagSaving(true);
    const newNames = groupTags.filter(t => t.name !== tagName).map(t => t.name);
    const result = await setGroupTagsApi(group.id, newNames);
    if (result?.success) {
      const syncedTo = result.syncedTo || 0;
      toast.success(`已移除标签「${tagName}」${syncedTo > 0 ? `，已从 ${syncedTo} 卷中移除` : ""}`);
      await loadTags();
    }
    setTagSaving(false);
  }, [group.id, groupTags, toast, loadTags]);

  const handleSyncTags = useCallback(async () => {
    setTagSyncing(true);
    const result = await syncGroupTags(group.id);
    if (result?.success) {
      toast.success(`同步完成：${result.syncedVolumes}/${result.totalVolumes} 卷已更新，同步 ${result.tagsAdded} 个标签`);
    } else {
      toast.error("同步失败");
    }
    setTagSyncing(false);
  }, [group.id, toast]);

  const handleOverrideTags = useCallback(async () => {
    setOverrideLoading(true);
    try {
      const result = await overrideGroupTagsToVolumes(group.id);
      if (result?.success) {
        toast.success(`覆盖完成：${result.syncedVolumes}/${result.totalVolumes} 卷已更新，每卷设置 ${result.tagsSet} 个标签`);
      } else {
        toast.error("覆盖标签失败");
      }
    } catch {
      toast.error("覆盖标签失败");
    } finally {
      setOverrideLoading(false);
      setOverrideConfirm(false);
    }
  }, [group.id, toast]);

  // ── AI 建议标签 ──
  const handleAiSuggestTags = useCallback(async () => {
    if (aiSuggestLoading) return;
    setAiSuggestLoading(true);
    setAiSuggestedTags([]);
    setAiSelectedTags(new Set());
    try {
      const result = await aiSuggestGroupTags(group.id, locale === "en" ? "en" : "zh");
      if (result?.success && result.suggestedTags?.length > 0) {
        setAiSuggestedTags(result.suggestedTags);
        setAiSelectedTags(new Set(result.suggestedTags));
      } else {
        toast.info("AI 未生成新标签建议");
      }
    } catch {
      toast.error("AI 标签建议失败");
    } finally {
      setAiSuggestLoading(false);
    }
  }, [aiSuggestLoading, group.id, locale, toast]);

  const handleApplyAiTags = useCallback(async (tagsToAdd: string[]) => {
    if (tagsToAdd.length === 0) return;
    setTagSaving(true);
    const currentNames = groupTags.map(t => t.name);
    const allNames = [...new Set([...currentNames, ...tagsToAdd])];
    const result = await setGroupTagsApi(group.id, allNames);
    if (result?.success) {
      const addedCount = result.added?.length || 0;
      const syncedTo = result.syncedTo || 0;
      toast.success(`已添加 ${addedCount} 个 AI 建议标签${syncedTo > 0 ? `，已同步到 ${syncedTo} 卷` : ""}`);
      setAiSuggestedTags([]);
      setAiSelectedTags(new Set());
      await loadTags();
    }
    setTagSaving(false);
  }, [group.id, groupTags, toast, loadTags]);

  // ── 分类管理 ──
  const handleToggleCategory = useCallback(async (slug: string) => {
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
      await loadCategories();
    }
    setCategorySaving(false);
  }, [group.id, groupCategories, allCategories, toast, loadCategories]);

  const handleSyncCategories = useCallback(async () => {
    setCategorySyncing(true);
    const result = await syncGroupCategories(group.id);
    if (result?.success) {
      toast.success(`同步完成：${result.syncedVolumes}/${result.totalVolumes} 卷已更新`);
    } else {
      toast.error("同步分类失败");
    }
    setCategorySyncing(false);
  }, [group.id, toast]);

  // ── AI 建议分类 ──
  const handleAiSuggestCategories = useCallback(async () => {
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
  }, [group.id, locale, toast]);

  const handleApplyAiCategories = useCallback(async (slugs: string[]) => {
    if (slugs.length === 0) return;
    setCategorySaving(true);
    const currentSlugs = groupCategories.map(c => c.slug);
    const newSlugs = [...new Set([...currentSlugs, ...slugs])];
    const result = await setGroupCategoriesApi(group.id, newSlugs);
    if (result?.success) {
      const addedCount = newSlugs.length - currentSlugs.length;
      toast.success(`已添加 ${addedCount} 个分类${result.syncedTo > 0 ? `，已同步到 ${result.syncedTo} 卷` : ""}`);
      await loadCategories();
      setAiSuggestedCategories([]);
    }
    setCategorySaving(false);
  }, [group.id, groupCategories, toast, loadCategories]);

  // ── 从首卷继承元数据 ──
  const handleInheritMetadata = useCallback(async () => {
    setInheritLoading(true);
    const ok = await inheritGroupMetadata(group.id);
    if (ok) {
      toast.success("元数据继承成功");
      loadScraperGroups();
      await loadTags();
    } else {
      toast.error("继承失败");
    }
    setInheritLoading(false);
  }, [group.id, toast, loadTags]);

  // ── 预览继承到所有卷 ──
  const handlePreviewInherit = useCallback(async () => {
    setInheritLoading(true);
    const preview = await previewInheritMetadata(group.id);
    setInheritPreview(preview);
    setShowInheritPreview(true);
    setInheritLoading(false);
  }, [group.id]);

  // ── 确认继承到所有卷 ──
  const handleConfirmInheritToVolumes = useCallback(async () => {
    setInheritLoading(true);
    const ok = await inheritMetadataToVolumes(group.id);
    if (ok) {
      toast.success("元数据已继承到所有卷");
      setShowInheritPreview(false);
      setInheritPreview(null);
      loadScraperGroups();
      await loadTags();
    }
    setInheritLoading(false);
  }, [group.id, toast, loadTags]);

  return (
    <div className="flex flex-col h-full">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/30 flex-shrink-0">
        <h3 className="text-sm font-semibold text-foreground truncate flex-1 mr-2">
          系列详情
        </h3>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setEditMode(!editMode)}
            className={`flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-medium transition-colors ${
              editMode
                ? "bg-accent/20 text-accent"
                : "text-muted hover:text-foreground hover:bg-card-hover"
            }`}
            title={editMode ? "退出编辑模式" : "进入编辑模式"}
          >
            <Pencil className="h-3 w-3" />
            {editMode ? "编辑中" : "编辑"}
          </button>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:text-foreground hover:bg-card-hover transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* 保存成功提示 */}
        {saveSuccess && (
          <div className="flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-3 py-1.5 text-[11px] text-emerald-400 animate-in fade-in slide-in-from-top-1 duration-200">
            <CheckCircle className="h-3 w-3" />
            已保存
          </div>
        )}

        {/* 封面 + 基本信息 */}
        <div className="flex gap-4">
          <div className="relative h-36 w-24 flex-shrink-0 overflow-hidden rounded-xl border border-border/40 bg-muted/10 shadow-lg group/cover">
            {localCoverUrl ? (
              <Image
                src={localCoverUrl}
                alt=""
                fill
                className="object-cover"
                sizes="96px"
                unoptimized
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <Layers className="h-8 w-8 text-muted/40" />
              </div>
            )}
            {/* 封面更换按钮 */}
            <div className="absolute inset-0 flex items-end justify-center bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 transition-opacity group-hover/cover:opacity-100">
              <button
                onClick={() => setShowCoverMenu(!showCoverMenu)}
                disabled={coverLoading}
                className="mb-2 flex items-center gap-1 rounded-lg bg-white/20 px-2 py-1 text-[10px] font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/30"
              >
                {coverLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImagePlus className="h-3 w-3" />}
                更换
              </button>
            </div>
            {/* 封面更换菜单 */}
            {showCoverMenu && (
              <div className="absolute bottom-0 left-0 right-0 z-20 rounded-b-xl bg-zinc-900/95 p-2 backdrop-blur-sm">
                <div className="space-y-1">
                  <button
                    onClick={() => coverFileRef.current?.click()}
                    disabled={coverLoading}
                    className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-[10px] text-zinc-200 transition-colors hover:bg-zinc-700/60"
                  >
                    <ImagePlus className="h-3 w-3" />
                    上传图片
                  </button>
                  <button
                    onClick={() => setShowCoverUrlInput(!showCoverUrlInput)}
                    disabled={coverLoading}
                    className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-[10px] text-zinc-200 transition-colors hover:bg-zinc-700/60"
                  >
                    <Globe className="h-3 w-3" />
                    图片URL
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
                    onClick={handleCoverReset}
                    disabled={coverLoading}
                    className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-[10px] text-zinc-200 transition-colors hover:bg-zinc-700/60"
                  >
                    <RefreshCw className="h-3 w-3" />
                    恢复默认
                  </button>
                </div>
                <button
                  onClick={() => { setShowCoverMenu(false); setShowCoverUrlInput(false); }}
                  className="mt-1.5 w-full rounded-md py-1 text-[10px] text-zinc-400 transition-colors hover:text-zinc-200"
                >
                  取消
                </button>
              </div>
            )}
            <input ref={coverFileRef} type="file" accept="image/*" className="hidden" onChange={handleCoverUpload} />
          </div>
          <div className="flex-1 min-w-0 space-y-2">
            {/* 可编辑标题 */}
            {editMode ? (
              <EditableTitle
                value={group.name}
                saving={saving}
                onSave={async (v) => handleSaveField("name", v)}
              />
            ) : (
              <h4 className="text-base font-bold text-foreground leading-tight line-clamp-2">{group.name}</h4>
            )}

            {/* 作者（非编辑模式下显示） */}
            {!editMode && group.author && (
              <p className="text-xs text-muted/60 flex items-center gap-1">
                <User className="h-3 w-3" />
                {group.author}
              </p>
            )}

            <div className="flex flex-wrap gap-1.5">
              <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ${
                group.contentType === "novel"
                  ? "bg-emerald-500/10 text-emerald-400"
                  : "bg-blue-500/10 text-blue-400"
              }`}>
                {group.contentType === "novel" ? "📚 小说" : "📖 漫画"}
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-purple-500/10 px-2 py-0.5 text-[11px] font-medium text-purple-400">
                <Layers className="h-3 w-3" />
                {group.comicCount} 卷
              </span>
              {group.hasMetadata ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
                  <CheckCircle className="h-3 w-3" />
                  已有元数据
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-400">
                  <AlertCircle className="h-3 w-3" />
                  缺失元数据
                </span>
              )}
              {!editMode && group.status && (
                <span className="inline-flex items-center gap-1 rounded-md bg-blue-500/10 px-2 py-0.5 text-[11px] font-medium text-blue-400">
                  {group.status}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* 编辑模式：所有字段可编辑 */}
        {editMode ? (
          <div className="rounded-xl border border-accent/20 bg-accent/5 p-3 space-y-2">
            <div className="flex items-center gap-1.5 mb-1">
              <Pencil className="h-3 w-3 text-accent" />
              <span className="text-[11px] font-medium text-accent">元数据编辑</span>
              <span className="text-[10px] text-muted/50 ml-auto">点击字段即可编辑</span>
            </div>
            {EDITABLE_FIELDS.map((field) => (
              <InlineEditField
                key={field.key}
                label={field.label}
                value={getFieldValue(field.key)}
                type={field.type}
                placeholder={field.placeholder}
                saving={saving}
                onSave={async (v) => handleSaveField(field.key, v)}
              />
            ))}
          </div>
        ) : (
          <>
            {/* 元数据详情（只读模式） */}
            {(group.genre || group.year || group.publisher || group.language) && (
              <div className="rounded-xl bg-card-hover/30 p-3 space-y-1.5">
                {group.genre && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted/50 w-12 flex-shrink-0">类型</span>
                    <span className="text-foreground/70">{group.genre}</span>
                  </div>
                )}
                {group.year && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted/50 w-12 flex-shrink-0">年份</span>
                    <span className="text-foreground/70">{group.year}</span>
                  </div>
                )}
                {group.publisher && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted/50 w-12 flex-shrink-0">出版社</span>
                    <span className="text-foreground/70">{group.publisher}</span>
                  </div>
                )}
                {group.language && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted/50 w-12 flex-shrink-0">语言</span>
                    <span className="text-foreground/70">{group.language}</span>
                  </div>
                )}
              </div>
            )}

            {group.description && (
              <div className="rounded-xl bg-card-hover/30 p-3">
                <p className="text-xs text-foreground/70 leading-relaxed line-clamp-6">{group.description}</p>
              </div>
            )}
          </>
        )}

        {/* ── 标签管理 ── */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted flex items-center gap-1">
              <Tag className="h-3 w-3" />
              标签
              {groupTags.length > 0 && (
                <span className="text-[10px] text-muted/60">({groupTags.length})</span>
              )}
            </h4>
            {groupTags.length > 0 && (
              <div className="flex items-center gap-1">
                <button
                  onClick={handleSyncTags}
                  disabled={tagSyncing}
                  className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] text-accent/80 transition-colors hover:bg-accent/10"
                  title="将系列标签增量同步到所有卷"
                >
                  {tagSyncing ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <RefreshCw className="h-2.5 w-2.5" />}
                  同步
                </button>
                <button
                  onClick={() => setOverrideConfirm(true)}
                  disabled={overrideLoading}
                  className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] text-orange-400/80 transition-colors hover:bg-orange-400/10"
                  title="覆盖到所有卷（先清除再设置）"
                >
                  {overrideLoading ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Copy className="h-2.5 w-2.5" />}
                  覆盖
                </button>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            {groupTags.map((tag) => (
              <span
                key={tag.id}
                className="group/tag inline-flex items-center gap-0.5 rounded-lg px-2 py-1 text-[10px] font-medium bg-accent/15 text-accent"
              >
                {tag.name}
                <button
                  onClick={() => handleRemoveTag(tag.name)}
                  disabled={tagSaving}
                  className="ml-0.5 rounded-full p-0.5 opacity-0 transition-all group-hover/tag:opacity-100 hover:bg-white/10"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
            {groupTags.length === 0 && (
              <span className="text-[10px] text-muted/40">暂无标签</span>
            )}
          </div>
          <div className="flex gap-1.5">
            <input
              type="text"
              value={newTagInput}
              onChange={(e) => setNewTagInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddTag()}
              placeholder="添加标签（逗号分隔）"
              className="flex-1 rounded-lg bg-card px-2.5 py-1.5 text-[11px] text-foreground placeholder-muted/50 outline-none focus:ring-1 focus:ring-accent/30"
            />
            <button
              onClick={handleAddTag}
              disabled={!newTagInput.trim() || tagSaving}
              className="rounded-lg bg-accent/20 px-2 py-1.5 text-accent transition-colors hover:bg-accent/30 disabled:opacity-30"
            >
              {tagSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            </button>
            {aiConfigured && (
              <button
                onClick={handleAiSuggestTags}
                disabled={aiSuggestLoading}
                className="flex items-center gap-1 rounded-lg bg-purple-500/15 px-2 py-1.5 text-[10px] font-medium text-purple-400 transition-colors hover:bg-purple-500/25 disabled:opacity-50"
                title="AI 标签建议"
              >
                {aiSuggestLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Brain className="h-3 w-3" />}
                <span className="hidden sm:inline">AI</span>
              </button>
            )}
          </div>

          {/* AI 建议标签 */}
          {aiSuggestedTags.length > 0 && (
            <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-2.5">
              <div className="mb-1.5 flex items-center gap-1.5 text-[10px] text-purple-400">
                <Sparkles className="h-3 w-3" />
                AI 建议标签
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
                  onClick={() => handleApplyAiTags(Array.from(aiSelectedTags))}
                  disabled={aiSelectedTags.size === 0 || tagSaving}
                  className="rounded-md bg-purple-500/20 px-2 py-0.5 text-[10px] font-medium text-purple-300 transition-colors hover:bg-purple-500/30 disabled:opacity-40"
                >
                  添加选中 ({aiSelectedTags.size})
                </button>
                <button
                  onClick={() => handleApplyAiTags(aiSuggestedTags)}
                  disabled={tagSaving}
                  className="rounded-md bg-card px-2 py-0.5 text-[10px] text-muted transition-colors hover:text-foreground"
                >
                  全部添加
                </button>
                <button
                  onClick={() => { setAiSuggestedTags([]); setAiSelectedTags(new Set()); }}
                  className="rounded-md px-1 py-0.5 text-[10px] text-muted hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
          )}

          {/* 覆盖确认 */}
          {overrideConfirm && (
            <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-2.5">
              <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium text-orange-400">
                <AlertTriangle className="h-3 w-3" />
                确认覆盖标签
              </div>
              <p className="mb-2 text-[10px] text-muted/70 leading-relaxed">
                此操作将<strong className="text-orange-400">清除</strong>所有卷的现有标签，
                然后设置当前系列的 <strong className="text-orange-400">{groupTags.length}</strong> 个标签。不可撤销。
              </p>
              <div className="flex gap-1.5">
                <button
                  onClick={handleOverrideTags}
                  disabled={overrideLoading}
                  className="flex items-center gap-1 rounded-md bg-orange-500/20 px-2 py-0.5 text-[10px] font-medium text-orange-300 transition-colors hover:bg-orange-500/30 disabled:opacity-40"
                >
                  {overrideLoading ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Check className="h-2.5 w-2.5" />}
                  确认覆盖
                </button>
                <button
                  onClick={() => setOverrideConfirm(false)}
                  disabled={overrideLoading}
                  className="rounded-md px-2 py-0.5 text-[10px] text-muted transition-colors hover:text-foreground disabled:opacity-40"
                >
                  取消
                </button>
              </div>
            </div>
          )}

          <p className="text-[9px] text-muted/40 flex items-center gap-0.5">
            <ArrowDownToLine className="h-2.5 w-2.5" />
            添加/删除标签时自动同步到所有卷
          </p>
        </div>

        {/* ── 分类管理 ── */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted flex items-center gap-1">
              <FolderOpen className="h-3 w-3" />
              分类
              {groupCategories.length > 0 && (
                <span className="text-[10px] text-muted/60">({groupCategories.length})</span>
              )}
            </h4>
            {groupCategories.length > 0 && (
              <button
                onClick={handleSyncCategories}
                disabled={categorySyncing}
                className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] text-accent/80 transition-colors hover:bg-accent/10"
                title="将系列分类同步到所有卷"
              >
                {categorySyncing ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <RefreshCw className="h-2.5 w-2.5" />}
                同步
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            {groupCategories.map((cat) => (
              <span
                key={cat.id}
                className="group/cat inline-flex items-center gap-0.5 rounded-lg bg-blue-500/10 px-2 py-1 text-[10px] text-blue-400"
              >
                <span className="text-xs">{cat.icon}</span>
                {cat.name}
                <button
                  onClick={() => handleToggleCategory(cat.slug)}
                  disabled={categorySaving}
                  className="ml-0.5 rounded-full p-0.5 opacity-0 transition-all group-hover/cat:opacity-100 hover:bg-white/10"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
            {groupCategories.length === 0 && (
              <span className="text-[10px] text-muted/40">暂无分类</span>
            )}
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={() => setShowCategoryPicker(!showCategoryPicker)}
              className="flex items-center gap-1 rounded-lg bg-blue-500/15 px-2 py-1.5 text-[10px] font-medium text-blue-400 transition-colors hover:bg-blue-500/25"
            >
              <Plus className="h-3 w-3" />
              选择分类
            </button>
            {aiConfigured && (
              <button
                onClick={handleAiSuggestCategories}
                disabled={aiCategoryLoading}
                className="flex items-center gap-1 rounded-lg bg-purple-500/15 px-2 py-1.5 text-[10px] font-medium text-purple-400 transition-colors hover:bg-purple-500/25 disabled:opacity-50"
                title="AI 智能分类"
              >
                {aiCategoryLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Brain className="h-3 w-3" />}
                <span className="hidden sm:inline">AI</span>
              </button>
            )}
          </div>

          {/* 分类选择器 */}
          {showCategoryPicker && (
            <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-2.5">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[10px] font-medium text-blue-400 flex items-center gap-1">
                  <FolderOpen className="h-3 w-3" />
                  选择分类
                </span>
                <button onClick={() => setShowCategoryPicker(false)} className="rounded-md p-0.5 text-muted hover:text-foreground">
                  <X className="h-3 w-3" />
                </button>
              </div>
              <div className="flex flex-wrap gap-1">
                {allCategories.length === 0 ? (
                  <span className="text-[10px] text-muted/50">暂无可用分类，请先在设置中初始化</span>
                ) : (
                  allCategories.map((cat) => {
                    const isSelected = groupCategories.some(gc => gc.slug === cat.slug);
                    return (
                      <button
                        key={cat.slug}
                        onClick={() => handleToggleCategory(cat.slug)}
                        disabled={categorySaving}
                        className={`rounded-md px-1.5 py-0.5 text-[10px] transition-all ${
                          isSelected
                            ? "bg-blue-500/20 text-blue-300 ring-1 ring-blue-500/40"
                            : "bg-card text-muted hover:text-foreground hover:bg-card-hover"
                        }`}
                      >
                        <span className="mr-0.5">{cat.icon}</span>
                        {cat.name}
                        {isSelected && <Check className="ml-0.5 inline h-2.5 w-2.5" />}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* AI 建议分类 */}
          {aiSuggestedCategories.length > 0 && (
            <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-2.5">
              <div className="mb-1.5 flex items-center gap-1.5 text-[10px] text-purple-400">
                <Sparkles className="h-3 w-3" />
                AI 建议分类
              </div>
              <div className="mb-2 flex flex-wrap gap-1">
                {aiSuggestedCategories.map((slug) => {
                  const cat = allCategories.find(c => c.slug === slug);
                  return (
                    <span key={slug} className="rounded-md bg-purple-500/20 px-1.5 py-0.5 text-[10px] text-purple-300 ring-1 ring-purple-500/40">
                      {cat ? `${cat.icon} ${cat.name}` : slug}
                    </span>
                  );
                })}
              </div>
              <div className="flex gap-1.5">
                <button
                  onClick={() => handleApplyAiCategories(aiSuggestedCategories)}
                  disabled={categorySaving}
                  className="rounded-md bg-purple-500/20 px-2 py-0.5 text-[10px] font-medium text-purple-300 transition-colors hover:bg-purple-500/30 disabled:opacity-40"
                >
                  全部添加 ({aiSuggestedCategories.length})
                </button>
                <button
                  onClick={() => setAiSuggestedCategories([])}
                  className="rounded-md px-1 py-0.5 text-[10px] text-muted hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
          )}

          <p className="text-[9px] text-muted/40 flex items-center gap-0.5">
            <ArrowDownToLine className="h-2.5 w-2.5" />
            添加/删除分类时自动同步到所有卷
          </p>
        </div>

        {group.updatedAt && (
          <div className="flex items-center gap-1.5 text-[11px] text-muted/40">
            <Clock className="h-3 w-3" />
            最后更新: {new Date(group.updatedAt).toLocaleString()}
          </div>
        )}

        {/* ── 继承元数据操作 ── */}
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={handleInheritMetadata}
            disabled={inheritLoading}
            className="flex items-center gap-1 rounded-lg bg-card-hover/50 px-2.5 py-1.5 text-[11px] text-muted hover:text-foreground transition-colors disabled:opacity-50"
            title="从系列第一本漫画继承元数据"
          >
            {inheritLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
            从首卷继承
          </button>
          <button
            onClick={handlePreviewInherit}
            disabled={inheritLoading}
            className="flex items-center gap-1 rounded-lg bg-accent/10 px-2.5 py-1.5 text-[11px] text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
            title="将首卷的元数据继承到系列中所有卷"
          >
            <Layers className="h-3 w-3" />
            继承到所有卷
          </button>
          <a
            href={`/group/${group.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 rounded-lg bg-card-hover/50 px-2.5 py-1.5 text-[11px] text-muted hover:text-foreground transition-colors"
          >
            <BookOpen className="h-3 w-3" />
            查看详情
          </a>
        </div>

        {/* 系列刮削入口 */}
        <div className="rounded-xl border border-border/40 bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-400" />
            <h3 className="text-sm font-semibold text-foreground">系列元数据刮削</h3>
          </div>
          <p className="text-xs text-muted">
            从 AniList、Bangumi 等在线数据库搜索系列信息，或使用 AI 智能识别。支持选择性应用字段和标签同步。
          </p>
          <GroupMetadataSearch
            key={group.id}
            groupId={group.id}
            groupName={group.name}
            contentType={group.contentType}
            onApplied={async (success) => {
              if (success) {
                loadScraperGroups();
                await loadTags();
                await loadCategories();
              }
            }}
          />
        </div>
      </div>

      {/* ── 继承预览弹窗 ── */}
      {showInheritPreview && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60" onClick={() => { setShowInheritPreview(false); setInheritPreview(null); }}>
          <div className="w-[90vw] max-w-lg rounded-2xl border border-border bg-card shadow-2xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border/30 bg-card px-5 py-3 rounded-t-2xl">
              <div className="flex items-center gap-2">
                <Layers className="h-5 w-5 text-accent" />
                <h3 className="text-base font-semibold text-foreground">继承预览</h3>
              </div>
              <button
                onClick={() => { setShowInheritPreview(false); setInheritPreview(null); }}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-card-hover"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {inheritPreview ? (
              <div className="p-5 space-y-5">
                <div className="rounded-xl bg-accent/5 border border-accent/20 px-4 py-3">
                  <p className="text-xs text-muted mb-1">数据来源（首卷）</p>
                  <p className="text-sm font-medium text-foreground">{inheritPreview.sourceComicTitle}</p>
                </div>

                {inheritPreview.groupChanges?.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
                      <Tag className="h-3.5 w-3.5 text-accent" />
                      系列级别变更
                    </h4>
                    <div className="space-y-2">
                      {inheritPreview.groupChanges.map((change) => (
                        <div key={change.field} className="flex items-center gap-3 rounded-lg bg-card/80 px-3 py-2">
                          <span className="text-xs text-muted w-14 flex-shrink-0">{change.label}</span>
                          <span className="text-xs text-muted/50 line-through flex-shrink-0">{change.oldValue || "（空）"}</span>
                          <span className="text-xs text-muted mx-1">→</span>
                          <span className="text-xs text-accent font-medium truncate">{change.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {inheritPreview.volumeChanges?.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
                      <BookOpen className="h-3.5 w-3.5 text-accent" />
                      卷级别变更
                      <span className="text-xs text-muted font-normal">({inheritPreview.volumeCount} 卷将受影响)</span>
                    </h4>
                    <div className="space-y-2">
                      {inheritPreview.volumeChanges.map((change) => (
                        <div key={change.field} className="flex items-center gap-3 rounded-lg bg-card/80 px-3 py-2">
                          <span className="text-xs text-muted w-14 flex-shrink-0">{change.label}</span>
                          <span className="text-xs text-muted/50 line-through flex-shrink-0">{change.oldValue || "（空）"}</span>
                          <span className="text-xs text-muted mx-1">→</span>
                          <span className="text-xs text-accent font-medium truncate">{change.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(!inheritPreview.groupChanges?.length && !inheritPreview.volumeChanges?.length) && (
                  <p className="text-sm text-muted text-center py-4">没有需要变更的字段</p>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-accent" />
              </div>
            )}

            <div className="sticky bottom-0 flex justify-end gap-3 border-t border-border/30 bg-card px-5 py-3 rounded-b-2xl">
              <button
                onClick={() => { setShowInheritPreview(false); setInheritPreview(null); }}
                className="rounded-lg bg-background px-4 py-2 text-sm text-foreground"
              >
                取消
              </button>
              <button
                onClick={handleConfirmInheritToVolumes}
                disabled={inheritLoading || !inheritPreview}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {inheritLoading ? (
                  <span className="flex items-center gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    继承中...
                  </span>
                ) : (
                  "确认继承"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
