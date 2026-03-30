"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Tag,
  Layers,
  Pencil,
  Trash2,
  Merge,
  Search,
  Check,
  X,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Palette,
  CheckSquare,
  Square,
  RefreshCw,
  Plus,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";

interface TagItem {
  id: number;
  name: string;
  color: string;
  count: number;
}

interface CategoryItem {
  id: number;
  name: string;
  slug: string;
  icon: string;
  count: number;
}

// ── API helpers (with error handling) ──

async function fetchTags(): Promise<TagItem[]> {
  try {
    const res = await fetch("/api/tags");
    if (!res.ok) return [];
    const data = await res.json();
    return data.tags || [];
  } catch {
    return [];
  }
}

async function fetchCategories(): Promise<CategoryItem[]> {
  try {
    const res = await fetch("/api/categories");
    if (!res.ok) return [];
    const data = await res.json();
    return data.categories || [];
  } catch {
    return [];
  }
}

async function apiRenameTag(oldName: string, newName: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/tags/rename", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oldName, newName }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

async function apiDeleteTag(name: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/tags", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

async function apiMergeTags(sourceNames: string[], targetName: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/tags/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceNames, targetName }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

async function apiUpdateTagColor(name: string, color: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/tags/color", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, color }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

async function apiUpdateCategory(slug: string, name: string, icon: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/categories/${slug}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, icon }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

async function apiDeleteCategory(slug: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/categories/${slug}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

async function apiCreateTag(name: string): Promise<{ ok: boolean; error?: string }> {
  try {
    // 利用 rename 接口创建标签（将一个新名字 rename 到自己不可行，用 add tags to a dummy？）
    // 实际上后端没有 createTag 单独接口，但可以利用 color 接口间接创建
    const res = await fetch("/api/tags/color", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, color: "default" }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** Resolve a tag color: DB default is "default", treat it as null */
function resolveTagColor(color: string | undefined): string {
  if (!color || color === "default") return "#6b7280";
  return color;
}

// ── Color presets ──
const COLOR_PRESETS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4",
  "#3b82f6", "#8b5cf6", "#ec4899", "#6b7280", "#14b8a6",
];

type SortField = "name" | "count";
type SortDir = "asc" | "desc";

const PAGE_SIZE_OPTIONS = [20, 50, 100];

// ── Pagination Component ──
function Pagination({
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
  t,
}: {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  t: ReturnType<typeof useTranslation>;
}) {
  const [jumpInput, setJumpInput] = useState("");

  // Generate visible page numbers with ellipsis
  const pageNumbers = useMemo(() => {
    const pages: (number | "...")[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (currentPage > 3) pages.push("...");
      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);
      for (let i = start; i <= end; i++) pages.push(i);
      if (currentPage < totalPages - 2) pages.push("...");
      pages.push(totalPages);
    }
    return pages;
  }, [currentPage, totalPages]);

  if (totalPages <= 1 && totalItems <= PAGE_SIZE_OPTIONS[0]) return null;

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 pb-2">
      {/* Left: total info + page size selector */}
      <div className="flex items-center gap-3 text-xs text-muted">
        <span>
          {t.tagManager?.total || "共"} <span className="font-medium text-foreground">{totalItems}</span> {t.tagManager?.items || "项"}
        </span>
        <div className="flex items-center gap-1.5">
          <span>{t.tagManager?.perPage || "每页"}</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="rounded-md border border-border/50 bg-card px-1.5 py-0.5 text-xs text-foreground outline-none focus:border-accent/50"
          >
            {PAGE_SIZE_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Right: page navigation */}
      <div className="flex items-center gap-1">
        {/* First page */}
        <button
          onClick={() => onPageChange(1)}
          disabled={currentPage === 1}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-card hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
          title={t.home?.firstPage || "首页"}
        >
          <ChevronsLeft className="h-3.5 w-3.5" />
        </button>
        {/* Prev page */}
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-card hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
          title={t.home?.prevPage || "上一页"}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>

        {/* Page numbers */}
        {pageNumbers.map((p, i) =>
          p === "..." ? (
            <span key={`dots-${i}`} className="px-1 text-xs text-muted select-none">…</span>
          ) : (
            <button
              key={p}
              onClick={() => onPageChange(p as number)}
              className={`flex h-7 min-w-[1.75rem] items-center justify-center rounded-lg px-1.5 text-xs font-medium transition-colors ${
                currentPage === p
                  ? "bg-accent text-white"
                  : "text-muted hover:bg-card hover:text-foreground"
              }`}
            >
              {p}
            </button>
          )
        )}

        {/* Next page */}
        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-card hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
          title={t.home?.nextPage || "下一页"}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
        {/* Last page */}
        <button
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage === totalPages}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-card hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
          title={t.home?.lastPage || "末页"}
        >
          <ChevronsRight className="h-3.5 w-3.5" />
        </button>

        {/* Jump to page */}
        {totalPages > 5 && (
          <div className="ml-2 flex items-center gap-1">
            <input
              type="text"
              value={jumpInput}
              onChange={(e) => setJumpInput(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const p = parseInt(jumpInput);
                  if (p >= 1 && p <= totalPages) {
                    onPageChange(p);
                    setJumpInput("");
                  }
                }
              }}
              placeholder={t.home?.pageInputPlaceholder || "页码"}
              className="w-12 rounded-md border border-border/50 bg-card px-1.5 py-0.5 text-center text-xs text-foreground outline-none focus:border-accent/50"
            />
            <button
              onClick={() => {
                const p = parseInt(jumpInput);
                if (p >= 1 && p <= totalPages) {
                  onPageChange(p);
                  setJumpInput("");
                }
              }}
              className="rounded-md bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent hover:bg-accent/20"
            >
              {t.home?.goToPage || "跳转"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function TagManagerPage() {
  const router = useRouter();
  const t = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const isAdmin = user?.role === "admin";

  const [activeTab, setActiveTab] = useState<"tags" | "categories">("tags");
  const [tags, setTags] = useState<TagItem[]>([]);
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  // Pagination
  const [tagPage, setTagPage] = useState(1);
  const [catPage, setCatPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // Sorting
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Toast / error feedback
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const showToast = useCallback((message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  // Confirm dialog state
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  // Tag editing states
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [showMerge, setShowMerge] = useState(false);
  const [mergeTarget, setMergeTarget] = useState("");
  const [colorPickerTag, setColorPickerTag] = useState<string | null>(null);
  const [batchColorPicker, setBatchColorPicker] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [showNewTagInput, setShowNewTagInput] = useState(false);

  // Category editing & selection states
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editCatName, setEditCatName] = useState("");
  const [editCatIcon, setEditCatIcon] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());

  // Batch operation loading
  const [batchLoading, setBatchLoading] = useState(false);

  // Prevent double-submit from onBlur + onKeyDown
  const renamingRef = useRef(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [tagsData, catsData] = await Promise.all([fetchTags(), fetchCategories()]);
    setTags(tagsData);
    setCategories(catsData);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!authLoading) {
      loadData();
    }
  }, [loadData, authLoading]);

  // Reset page when search changes
  useEffect(() => {
    setTagPage(1);
    setCatPage(1);
  }, [search]);

  // ── Sorting & filtering logic ──

  const sortItems = useCallback(<T extends { name: string; count: number }>(items: T[]): T[] => {
    return [...items].sort((a, b) => {
      let cmp = 0;
      if (sortField === "name") {
        cmp = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      } else {
        cmp = a.count - b.count;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [sortField, sortDir]);

  const filteredTags = useMemo(() => {
    const q = search.toLowerCase();
    const filtered = tags.filter((item) => item.name.toLowerCase().includes(q));
    return sortItems(filtered);
  }, [tags, search, sortItems]);

  const filteredCategories = useMemo(() => {
    const q = search.toLowerCase();
    const filtered = categories.filter(
      (item) => item.name.toLowerCase().includes(q) || item.slug.toLowerCase().includes(q)
    );
    return sortItems(filtered);
  }, [categories, search, sortItems]);

  // ── Pagination logic ──

  const tagTotalPages = Math.max(1, Math.ceil(filteredTags.length / pageSize));
  const catTotalPages = Math.max(1, Math.ceil(filteredCategories.length / pageSize));

  const pagedTags = useMemo(() => {
    const start = (tagPage - 1) * pageSize;
    return filteredTags.slice(start, start + pageSize);
  }, [filteredTags, tagPage, pageSize]);

  const pagedCategories = useMemo(() => {
    const start = (catPage - 1) * pageSize;
    return filteredCategories.slice(start, start + pageSize);
  }, [filteredCategories, catPage, pageSize]);

  // Clamp pages when data changes
  useEffect(() => {
    if (tagPage > tagTotalPages) setTagPage(Math.max(1, tagTotalPages));
  }, [tagPage, tagTotalPages]);

  useEffect(() => {
    if (catPage > catTotalPages) setCatPage(Math.max(1, catTotalPages));
  }, [catPage, catTotalPages]);

  // ── Toggle sort ──
  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="h-3 w-3 opacity-40" />;
    return sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
  };

  // ── Tag actions ──

  const handleRenameTag = async (oldName: string) => {
    if (renamingRef.current) return;
    if (!editValue.trim() || editValue.trim() === oldName) {
      setEditingTag(null);
      return;
    }
    renamingRef.current = true;
    const result = await apiRenameTag(oldName, editValue.trim());
    renamingRef.current = false;
    setEditingTag(null);
    if (result.ok) {
      showToast(t.tagManager?.rename || "重命名成功", "success");
      await loadData();
    } else {
      showToast(result.error || "操作失败", "error");
    }
  };

  const handleDeleteTag = async (name: string) => {
    setConfirmAction({
      title: t.common?.delete || "删除",
      message: `${t.tagManager?.confirmDeleteTag || "确认删除标签"} "${name}"？`,
      onConfirm: async () => {
        setConfirmAction(null);
        const result = await apiDeleteTag(name);
        if (result.ok) {
          setSelectedTags((prev) => { const next = new Set(prev); next.delete(name); return next; });
          showToast(`${t.common?.delete || "删除"}成功`, "success");
          await loadData();
        } else {
          showToast(result.error || "操作失败", "error");
        }
      },
    });
  };

  const handleBatchDeleteTags = async () => {
    if (selectedTags.size === 0) return;
    setConfirmAction({
      title: t.tagManager?.batchDelete || "批量删除",
      message: `${t.tagManager?.confirmBatchDeleteTags || "确认删除选中的"} ${selectedTags.size} ${t.tagManager?.tags || "个标签"}？${t.tagManager?.batchDeleteWarning || "此操作将从所有漫画中移除这些标签，不可撤销。"}`,
      onConfirm: async () => {
        setConfirmAction(null);
        setBatchLoading(true);
        let successCount = 0;
        let failCount = 0;
        for (const name of selectedTags) {
          const result = await apiDeleteTag(name);
          if (result.ok) successCount++;
          else failCount++;
        }
        setBatchLoading(false);
        setSelectedTags(new Set());
        if (failCount > 0) {
          showToast(`${t.tagManager?.batchDeletePartial || "删除完成"}：${successCount} ${t.tagManager?.success || "成功"}, ${failCount} ${t.tagManager?.failed || "失败"}`, "error");
        } else {
          showToast(`${t.tagManager?.batchDeleteDone || "已删除"} ${successCount} ${t.tagManager?.tags || "个标签"}`, "success");
        }
        await loadData();
      },
    });
  };

  const handleBatchColorChange = async (color: string) => {
    if (selectedTags.size === 0) return;
    setBatchColorPicker(false);
    setBatchLoading(true);
    let successCount = 0;
    for (const name of selectedTags) {
      const result = await apiUpdateTagColor(name, color);
      if (result.ok) successCount++;
    }
    setBatchLoading(false);
    showToast(`${t.tagManager?.colorChanged || "已更新"} ${successCount} ${t.tagManager?.tagsColor || "个标签颜色"}`, "success");
    await loadData();
  };

  const handleMergeTags = async () => {
    if (!mergeTarget.trim() || selectedTags.size < 2) return;
    const result = await apiMergeTags(Array.from(selectedTags), mergeTarget.trim());
    if (result.ok) {
      setSelectedTags(new Set());
      setShowMerge(false);
      setMergeTarget("");
      showToast(t.tagManager?.merge || "合并成功", "success");
      await loadData();
    } else {
      showToast(result.error || "操作失败", "error");
    }
  };

  const handleColorChange = async (name: string, color: string) => {
    const result = await apiUpdateTagColor(name, color);
    setColorPickerTag(null);
    if (result.ok) {
      await loadData();
    } else {
      showToast(result.error || "操作失败", "error");
    }
  };

  const toggleTagSelect = (name: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  // Select all tags on current page
  const selectAllPageTags = () => {
    const allOnPage = new Set(pagedTags.map((t) => t.name));
    const allSelected = pagedTags.every((t) => selectedTags.has(t.name));
    if (allSelected) {
      // Deselect all on this page
      setSelectedTags((prev) => {
        const next = new Set(prev);
        for (const name of allOnPage) next.delete(name);
        return next;
      });
    } else {
      // Select all on this page
      setSelectedTags((prev) => {
        const next = new Set(prev);
        for (const name of allOnPage) next.add(name);
        return next;
      });
    }
  };

  const handleCreateTag = async () => {
    if (!newTagName.trim()) return;
    const result = await apiCreateTag(newTagName.trim());
    if (result.ok) {
      showToast(t.tagManager?.createSuccess || "标签已创建", "success");
      setNewTagName("");
      setShowNewTagInput(false);
      await loadData();
    } else {
      showToast(result.error || "创建失败", "error");
    }
  };

  // ── Category actions ──

  const handleSaveCategory = async (slug: string) => {
    if (!editCatName.trim()) {
      setEditingCategory(null);
      return;
    }
    const result = await apiUpdateCategory(slug, editCatName.trim(), editCatIcon.trim());
    setEditingCategory(null);
    if (result.ok) {
      showToast(t.tagManager?.edit || "更新成功", "success");
      await loadData();
    } else {
      showToast(result.error || "操作失败", "error");
    }
  };

  const handleDeleteCategory = async (slug: string) => {
    const cat = categories.find((c) => c.slug === slug);
    setConfirmAction({
      title: t.common?.delete || "删除",
      message: `${t.tagManager?.confirmDeleteCategory || "确认删除分类"} "${cat?.name || slug}"？`,
      onConfirm: async () => {
        setConfirmAction(null);
        const result = await apiDeleteCategory(slug);
        if (result.ok) {
          setSelectedCategories((prev) => { const next = new Set(prev); next.delete(slug); return next; });
          showToast(`${t.common?.delete || "删除"}成功`, "success");
          await loadData();
        } else {
          showToast(result.error || "操作失败", "error");
        }
      },
    });
  };

  const handleBatchDeleteCategories = async () => {
    if (selectedCategories.size === 0) return;
    setConfirmAction({
      title: t.tagManager?.batchDelete || "批量删除",
      message: `${t.tagManager?.confirmBatchDeleteCats || "确认删除选中的"} ${selectedCategories.size} ${t.tagManager?.categoriesUnit || "个分类"}？${t.tagManager?.batchDeleteCatsWarning || "此操作将从所有漫画中移除这些分类。"}`,
      onConfirm: async () => {
        setConfirmAction(null);
        setBatchLoading(true);
        let successCount = 0;
        let failCount = 0;
        for (const slug of selectedCategories) {
          const result = await apiDeleteCategory(slug);
          if (result.ok) successCount++;
          else failCount++;
        }
        setBatchLoading(false);
        setSelectedCategories(new Set());
        if (failCount > 0) {
          showToast(`${t.tagManager?.batchDeletePartial || "删除完成"}：${successCount} ${t.tagManager?.success || "成功"}, ${failCount} ${t.tagManager?.failed || "失败"}`, "error");
        } else {
          showToast(`${t.tagManager?.batchDeleteDone || "已删除"} ${successCount} ${t.tagManager?.categoriesUnit || "个分类"}`, "success");
        }
        await loadData();
      },
    });
  };

  const toggleCategorySelect = (slug: string) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const selectAllPageCategories = () => {
    const allOnPage = new Set(pagedCategories.map((c) => c.slug));
    const allSelected = pagedCategories.every((c) => selectedCategories.has(c.slug));
    if (allSelected) {
      setSelectedCategories((prev) => {
        const next = new Set(prev);
        for (const slug of allOnPage) next.delete(slug);
        return next;
      });
    } else {
      setSelectedCategories((prev) => {
        const next = new Set(prev);
        for (const slug of allOnPage) next.add(slug);
        return next;
      });
    }
  };

  // Check if all items on current page are selected
  const allPageTagsSelected = pagedTags.length > 0 && pagedTags.every((t) => selectedTags.has(t.name));
  const allPageCatsSelected = pagedCategories.length > 0 && pagedCategories.every((c) => selectedCategories.has(c.slug));

  return (
    <div className="min-h-screen bg-background pb-20 sm:pb-6">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-2xl">
        <div className="mx-auto flex h-14 sm:h-16 max-w-5xl items-center gap-3 px-3 sm:px-6">
          <button
            onClick={() => router.push("/")}
            className="group flex h-8 w-8 items-center justify-center rounded-xl border border-border/50 text-muted transition-all hover:border-accent/40 hover:text-accent"
          >
            <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          </button>
          <h1 className="text-lg font-bold text-foreground">
            {t.tagManager?.title || "标签与分类管理"}
          </h1>
          <div className="flex-1" />
          <button
            onClick={() => { loadData(); showToast(t.tagManager?.refreshed || "已刷新", "success"); }}
            className="flex h-8 w-8 items-center justify-center rounded-xl border border-border/50 text-muted transition-all hover:border-accent/40 hover:text-accent"
            title={t.tagManager?.refresh || "刷新"}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-3 sm:px-6 pt-4 sm:pt-6">
        {/* Tab Switcher */}
        <div className="flex gap-1 rounded-xl bg-card p-1 mb-4">
          <button
            onClick={() => { setActiveTab("tags"); setSelectedCategories(new Set()); }}
            className={`flex-1 flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-colors ${
              activeTab === "tags" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-foreground"
            }`}
          >
            <Tag className="h-4 w-4" />
            {t.tagManager?.tagsTab || "标签"} ({tags.length})
          </button>
          <button
            onClick={() => { setActiveTab("categories"); setSelectedTags(new Set()); }}
            className={`flex-1 flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-colors ${
              activeTab === "categories" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-foreground"
            }`}
          >
            <Layers className="h-4 w-4" />
            {t.tagManager?.categoriesTab || "分类"} ({categories.length})
          </button>
        </div>

        {/* Search + Sort + Actions Bar */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.tagManager?.searchPlaceholder || "搜索..."}
              className="w-full rounded-xl border border-border/50 bg-card py-2.5 pl-10 pr-4 text-sm text-foreground placeholder-muted/50 outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/30"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Sort buttons */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => toggleSort("name")}
              className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors ${
                sortField === "name" ? "border-accent/40 bg-accent/5 text-accent" : "border-border/50 bg-card text-muted hover:text-foreground"
              }`}
            >
              <SortIcon field="name" />
              {t.tagManager?.sortByName || "名称"}
            </button>
            <button
              onClick={() => toggleSort("count")}
              className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors ${
                sortField === "count" ? "border-accent/40 bg-accent/5 text-accent" : "border-border/50 bg-card text-muted hover:text-foreground"
              }`}
            >
              <SortIcon field="count" />
              {t.tagManager?.sortByCount || "使用量"}
            </button>

            {/* Add new tag button */}
            {activeTab === "tags" && isAdmin && (
              <button
                onClick={() => setShowNewTagInput(!showNewTagInput)}
                className="flex h-9 items-center gap-1.5 rounded-lg border border-border/50 bg-card px-3 text-xs font-medium text-accent transition-colors hover:bg-accent/5 hover:border-accent/40"
                title={t.tagManager?.createTag || "新建标签"}
              >
                <Plus className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t.tagManager?.createTag || "新建"}</span>
              </button>
            )}
          </div>
        </div>

        {/* New tag input */}
        {showNewTagInput && activeTab === "tags" && isAdmin && (
          <div className="mb-4 flex items-center gap-2 rounded-xl bg-card border border-border/50 p-3">
            <Tag className="h-4 w-4 text-accent shrink-0" />
            <input
              type="text"
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreateTag(); if (e.key === "Escape") { setShowNewTagInput(false); setNewTagName(""); } }}
              placeholder={t.tagManager?.newTagPlaceholder || "输入新标签名称..."}
              className="flex-1 bg-transparent text-sm text-foreground placeholder-muted/50 outline-none"
              autoFocus
            />
            <button
              onClick={handleCreateTag}
              disabled={!newTagName.trim()}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              {t.tagManager?.create || "创建"}
            </button>
            <button
              onClick={() => { setShowNewTagInput(false); setNewTagName(""); }}
              className="rounded-lg p-1.5 text-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Batch actions bar for tags */}
        {activeTab === "tags" && selectedTags.size > 0 && isAdmin && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl bg-accent/10 border border-accent/20 p-3 animate-in fade-in duration-200">
            <span className="text-sm text-accent font-medium">
              {t.tagManager?.selected || "已选择"} {selectedTags.size} {t.tagManager?.tags || "个标签"}
            </span>
            <div className="flex flex-wrap items-center gap-1.5 ml-auto">
              {/* Merge (requires 2+) */}
              {selectedTags.size >= 2 && (
                <button
                  onClick={() => { setShowMerge(true); setMergeTarget(Array.from(selectedTags)[0]); }}
                  disabled={batchLoading}
                  className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                >
                  <Merge className="h-3.5 w-3.5" />
                  {t.tagManager?.merge || "合并"}
                </button>
              )}
              {/* Batch color */}
              <div className="relative">
                <button
                  onClick={() => setBatchColorPicker(!batchColorPicker)}
                  disabled={batchLoading}
                  className="flex items-center gap-1.5 rounded-lg bg-card border border-border/50 px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground disabled:opacity-50"
                >
                  <Palette className="h-3.5 w-3.5" />
                  {t.tagManager?.batchColor || "批量改色"}
                </button>
                {batchColorPicker && (
                  <div className="absolute left-0 top-9 z-20 flex flex-wrap gap-1.5 rounded-xl border border-border bg-card p-2.5 shadow-xl w-[200px]">
                    {COLOR_PRESETS.map((c) => (
                      <button
                        key={c}
                        onClick={() => handleBatchColorChange(c)}
                        className="h-7 w-7 rounded-full border-2 border-transparent transition-transform hover:scale-110 hover:border-white/50"
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                )}
              </div>
              {/* Batch delete */}
              <button
                onClick={handleBatchDeleteTags}
                disabled={batchLoading}
                className="flex items-center gap-1.5 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/20 disabled:opacity-50"
              >
                {batchLoading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                {t.tagManager?.batchDelete || "批量删除"}
              </button>
              {/* Clear selection */}
              <button
                onClick={() => setSelectedTags(new Set())}
                className="rounded-lg p-1.5 text-muted hover:text-foreground"
                title={t.tagManager?.clearSelection || "取消选择"}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* Batch actions bar for categories */}
        {activeTab === "categories" && selectedCategories.size > 0 && isAdmin && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl bg-accent/10 border border-accent/20 p-3 animate-in fade-in duration-200">
            <span className="text-sm text-accent font-medium">
              {t.tagManager?.selected || "已选择"} {selectedCategories.size} {t.tagManager?.categoriesUnit || "个分类"}
            </span>
            <div className="flex flex-wrap items-center gap-1.5 ml-auto">
              <button
                onClick={handleBatchDeleteCategories}
                disabled={batchLoading}
                className="flex items-center gap-1.5 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/20 disabled:opacity-50"
              >
                {batchLoading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                {t.tagManager?.batchDelete || "批量删除"}
              </button>
              <button
                onClick={() => setSelectedCategories(new Set())}
                className="rounded-lg p-1.5 text-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-card" />
            ))}
          </div>
        ) : activeTab === "tags" ? (
          /* ── Tags List ── */
          <div>
            {/* Select all header */}
            {isAdmin && filteredTags.length > 0 && (
              <div className="flex items-center gap-3 mb-2 px-1">
                <button
                  onClick={selectAllPageTags}
                  className="flex items-center gap-2 text-xs text-muted hover:text-foreground transition-colors"
                >
                  {allPageTagsSelected ? (
                    <CheckSquare className="h-4 w-4 text-accent" />
                  ) : (
                    <Square className="h-4 w-4" />
                  )}
                  {allPageTagsSelected
                    ? (t.tagManager?.deselectAll || "取消全选")
                    : (t.tagManager?.selectAllPage || "全选当页")}
                </button>
                <span className="text-xs text-muted">
                  {t.tagManager?.showing || "当前"} {pagedTags.length} / {filteredTags.length}
                </span>
              </div>
            )}

            <div className="space-y-2">
              {pagedTags.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted">
                  {search ? (t.tagManager?.noSearchResults || "未找到匹配的标签") : (t.tagManager?.noTags || "暂无标签")}
                </div>
              ) : (
                pagedTags.map((tag) => (
                  <div
                    key={tag.id}
                    className={`group flex items-center gap-3 rounded-xl border p-3 transition-colors ${
                      selectedTags.has(tag.name)
                        ? "border-accent/40 bg-accent/5"
                        : "border-border/40 bg-card hover:border-border/60"
                    }`}
                  >
                    {/* Checkbox for multi-select */}
                    {isAdmin && (
                      <button
                        onClick={() => toggleTagSelect(tag.name)}
                        className={`h-5 w-5 shrink-0 rounded border-2 flex items-center justify-center transition-colors ${
                          selectedTags.has(tag.name)
                            ? "border-accent bg-accent text-white"
                            : "border-muted/40 hover:border-accent/60"
                        }`}
                      >
                        {selectedTags.has(tag.name) && <Check className="h-3 w-3" />}
                      </button>
                    )}

                    {/* Color dot */}
                    <div className="relative shrink-0">
                      <button
                        onClick={() => isAdmin && setColorPickerTag(colorPickerTag === tag.name ? null : tag.name)}
                        className="h-4 w-4 rounded-full border border-border/50 transition-transform hover:scale-125"
                        style={{ backgroundColor: resolveTagColor(tag.color) }}
                      />
                      {/* Color picker popover */}
                      {colorPickerTag === tag.name && isAdmin && (
                        <div className="absolute left-0 top-7 z-10 flex flex-wrap gap-1.5 rounded-xl border border-border bg-card p-2 shadow-xl w-[180px]">
                          {COLOR_PRESETS.map((c) => (
                            <button
                              key={c}
                              onClick={() => handleColorChange(tag.name, c)}
                              className="h-6 w-6 rounded-full border-2 transition-transform hover:scale-110"
                              style={{
                                backgroundColor: c,
                                borderColor: resolveTagColor(tag.color) === c ? "white" : "transparent",
                              }}
                            />
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Name (editable) */}
                    {editingTag === tag.name ? (
                      <input
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.currentTarget.blur();
                          }
                          if (e.key === "Escape") {
                            setEditingTag(null);
                          }
                        }}
                        onBlur={() => handleRenameTag(tag.name)}
                        className="flex-1 min-w-0 rounded-lg bg-background px-2 py-1 text-sm text-foreground outline-none ring-1 ring-accent/50"
                        autoFocus
                      />
                    ) : (
                      <span className="flex-1 min-w-0 truncate text-sm font-medium text-foreground">{tag.name}</span>
                    )}

                    {/* Count badge */}
                    <span className="shrink-0 rounded-full bg-background px-2 py-0.5 text-xs text-muted">
                      {tag.count}
                    </span>

                    {/* Actions — always visible on mobile, hover on desktop */}
                    {isAdmin && (
                      <div className="flex shrink-0 items-center gap-1 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => { setEditingTag(tag.name); setEditValue(tag.name); }}
                          className="rounded-lg p-1.5 text-muted hover:bg-card-hover hover:text-foreground"
                          title={t.tagManager?.rename || "重命名"}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteTag(tag.name)}
                          className="rounded-lg p-1.5 text-muted hover:bg-red-500/10 hover:text-red-400"
                          title={t.common?.delete || "删除"}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Tags Pagination */}
            <Pagination
              currentPage={tagPage}
              totalPages={tagTotalPages}
              totalItems={filteredTags.length}
              pageSize={pageSize}
              onPageChange={setTagPage}
              onPageSizeChange={(s) => { setPageSize(s); setTagPage(1); setCatPage(1); }}
              t={t}
            />
          </div>
        ) : (
          /* ── Categories List ── */
          <div>
            {/* Select all header */}
            {isAdmin && filteredCategories.length > 0 && (
              <div className="flex items-center gap-3 mb-2 px-1">
                <button
                  onClick={selectAllPageCategories}
                  className="flex items-center gap-2 text-xs text-muted hover:text-foreground transition-colors"
                >
                  {allPageCatsSelected ? (
                    <CheckSquare className="h-4 w-4 text-accent" />
                  ) : (
                    <Square className="h-4 w-4" />
                  )}
                  {allPageCatsSelected
                    ? (t.tagManager?.deselectAll || "取消全选")
                    : (t.tagManager?.selectAllPage || "全选当页")}
                </button>
                <span className="text-xs text-muted">
                  {t.tagManager?.showing || "当前"} {pagedCategories.length} / {filteredCategories.length}
                </span>
              </div>
            )}

            <div className="space-y-2">
              {pagedCategories.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted">
                  {search ? (t.tagManager?.noSearchResults || "未找到匹配的分类") : (t.tagManager?.noCategories || "暂无分类")}
                </div>
              ) : (
                pagedCategories.map((cat) => (
                  <div
                    key={cat.id}
                    className={`group flex items-center gap-3 rounded-xl border p-3 transition-colors ${
                      selectedCategories.has(cat.slug)
                        ? "border-accent/40 bg-accent/5"
                        : "border-border/40 bg-card hover:border-border/60"
                    }`}
                  >
                    {/* Checkbox for multi-select */}
                    {isAdmin && (
                      <button
                        onClick={() => toggleCategorySelect(cat.slug)}
                        className={`h-5 w-5 shrink-0 rounded border-2 flex items-center justify-center transition-colors ${
                          selectedCategories.has(cat.slug)
                            ? "border-accent bg-accent text-white"
                            : "border-muted/40 hover:border-accent/60"
                        }`}
                      >
                        {selectedCategories.has(cat.slug) && <Check className="h-3 w-3" />}
                      </button>
                    )}

                    {/* Icon */}
                    {editingCategory === cat.slug ? (
                      <input
                        value={editCatIcon}
                        onChange={(e) => setEditCatIcon(e.target.value)}
                        className="w-10 shrink-0 rounded-lg bg-background px-1 py-1 text-center text-lg outline-none ring-1 ring-accent/50"
                      />
                    ) : (
                      <span className="text-xl w-8 shrink-0 text-center">{cat.icon}</span>
                    )}

                    {/* Name (editable) */}
                    {editingCategory === cat.slug ? (
                      <input
                        value={editCatName}
                        onChange={(e) => setEditCatName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveCategory(cat.slug);
                          if (e.key === "Escape") setEditingCategory(null);
                        }}
                        className="flex-1 min-w-0 rounded-lg bg-background px-2 py-1 text-sm text-foreground outline-none ring-1 ring-accent/50"
                        autoFocus
                      />
                    ) : (
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-foreground">{cat.name}</span>
                        <span className="ml-2 text-xs text-muted">{cat.slug}</span>
                      </div>
                    )}

                    {/* Count badge */}
                    <span className="shrink-0 rounded-full bg-background px-2 py-0.5 text-xs text-muted">
                      {cat.count}
                    </span>

                    {/* Actions — always visible on mobile, hover on desktop */}
                    {isAdmin && (
                      <div className="flex shrink-0 items-center gap-1 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                        {editingCategory === cat.slug ? (
                          <>
                            <button
                              onClick={() => handleSaveCategory(cat.slug)}
                              className="rounded-lg p-1.5 text-accent hover:bg-accent/10"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => setEditingCategory(null)}
                              className="rounded-lg p-1.5 text-muted hover:text-foreground"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => {
                                setEditingCategory(cat.slug);
                                setEditCatName(cat.name);
                                setEditCatIcon(cat.icon);
                              }}
                              className="rounded-lg p-1.5 text-muted hover:bg-card-hover hover:text-foreground"
                              title={t.tagManager?.edit || "编辑"}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteCategory(cat.slug)}
                              className="rounded-lg p-1.5 text-muted hover:bg-red-500/10 hover:text-red-400"
                              title={t.common?.delete || "删除"}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Categories Pagination */}
            <Pagination
              currentPage={catPage}
              totalPages={catTotalPages}
              totalItems={filteredCategories.length}
              pageSize={pageSize}
              onPageChange={setCatPage}
              onPageSizeChange={(s) => { setPageSize(s); setTagPage(1); setCatPage(1); }}
              t={t}
            />
          </div>
        )}
      </main>

      {/* Merge Tags Modal */}
      {showMerge && (
        <>
          <div className="fixed inset-0 z-50 bg-black/60 animate-backdrop-in" onClick={() => setShowMerge(false)} />
          <div className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-96 -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-card border border-border p-6 shadow-2xl animate-modal-in">
            <h3 className="text-lg font-semibold text-foreground">
              {t.tagManager?.mergeTitle || "合并标签"}
            </h3>
            <p className="mt-2 text-sm text-muted">
              {t.tagManager?.mergeDesc || "将选中的标签合并为一个。所有漫画将使用目标标签名称。"}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
              {Array.from(selectedTags).map((name) => (
                <span key={name} className="rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-medium text-accent">
                  {name}
                </span>
              ))}
            </div>
            <div className="mt-4">
              <label className="text-xs font-medium text-muted mb-1 block">
                {t.tagManager?.mergeTargetLabel || "目标标签名称"}
              </label>
              <input
                value={mergeTarget}
                onChange={(e) => setMergeTarget(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleMergeTags(); }}
                className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent/50"
                autoFocus
              />
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => setShowMerge(false)}
                className="rounded-lg bg-card px-4 py-2 text-sm text-foreground"
              >
                {t.common?.cancel || "取消"}
              </button>
              <button
                onClick={handleMergeTags}
                disabled={!mergeTarget.trim()}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {t.tagManager?.merge || "合并"}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Confirm Delete Dialog */}
      {confirmAction && (
        <>
          <div className="fixed inset-0 z-50 bg-black/60 animate-backdrop-in" onClick={() => setConfirmAction(null)} />
          <div className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-96 -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-card border border-border p-6 shadow-2xl animate-modal-in">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/10">
                <AlertTriangle className="h-5 w-5 text-red-400" />
              </div>
              <h3 className="text-lg font-semibold text-foreground">{confirmAction.title}</h3>
            </div>
            <p className="text-sm text-muted">{confirmAction.message}</p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => setConfirmAction(null)}
                className="rounded-lg border border-border/50 bg-card px-4 py-2 text-sm text-foreground hover:bg-card-hover"
              >
                {t.common?.cancel || "取消"}
              </button>
              <button
                onClick={confirmAction.onConfirm}
                className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600"
              >
                {t.common?.confirm || "确认"}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Toast notification */}
      {toast && (
        <div className={`fixed bottom-20 sm:bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl px-4 py-2.5 text-sm font-medium shadow-lg animate-modal-in ${
          toast.type === "error"
            ? "bg-red-500 text-white"
            : "bg-accent text-white"
        }`}>
          {toast.message}
        </div>
      )}

      {/* Click-away listener for batch color picker */}
      {batchColorPicker && (
        <div className="fixed inset-0 z-10" onClick={() => setBatchColorPicker(false)} />
      )}
    </div>
  );
}
