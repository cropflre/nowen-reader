"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
import {
  Library,
  Plus,
  Trash2,
  Edit,
  Save,
  X,
  Check,
  AlertTriangle,
  RefreshCw,
  FolderOpen,
  BookOpen,
  Book,
  ToggleLeft,
  ToggleRight,
  ScanLine,
  MoreHorizontal,
  Search,
  Database,
  Activity,
  ShieldAlert,
  Copy,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import {
  fetchLibraries,
  createLibrary,
  updateLibrary,
  deleteLibrary,
  scanLibrary,
  type Library as LibraryType,
} from "@/api/libraries";
import { FolderBrowser } from "@/components/FolderBrowser";

type NormalizedStatus = "scan-on" | "scan-off" | "access-public" | "access-private" | "last-scanned" | "last-unscanned" | "enabled" | "disabled";

const statusConfig: Record<NormalizedStatus, { label: string; className: string }> = {
  "scan-on": { label: "自动扫描", className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20" },
  "scan-off": { label: "手动扫描", className: "bg-muted/30 text-muted border border-border/50" },
  "access-public": { label: "公开访问", className: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20" },
  "access-private": { label: "私有访问", className: "bg-muted/30 text-muted border border-border/50" },
  "last-scanned": { label: "已扫描", className: "bg-accent/10 text-accent border border-accent/20" },
  "last-unscanned": { label: "未扫描", className: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20" },
  enabled: { label: "启用", className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20" },
  disabled: { label: "已禁用", className: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20" },
};

function StatusChip({ status }: { status: NormalizedStatus }) {
  const config = statusConfig[status];
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${config.className}`}>
      {config.label}
    </span>
  );
}

function VaultCardShell({ active, disabled, className = "", children }: { active?: boolean; disabled?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <div
      className={`group relative overflow-hidden rounded-[22px] border bg-card/80 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg ${
        active
          ? "border-accent/50 ring-1 ring-accent/20"
          : "border-border/70"
      } ${disabled ? "opacity-70" : ""} ${className}`}
    >
      <div className="pointer-events-none absolute inset-x-10 -top-24 h-44 rounded-full bg-accent/10 blur-3xl opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      {children}
    </div>
  );
}

function VaultMetric({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-transparent bg-card/60 p-4">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent">
        {icon}
      </div>
      <div>
        <div className="text-xs text-muted">{label}</div>
        <div className="text-xl font-semibold tracking-tight text-foreground">{value}</div>
      </div>
    </div>
  );
}

function InlineButton({ variant = "ghost", className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "ghost" | "soft" | "primary" | "danger" }) {
  const base = "inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors disabled:opacity-50";
  const map = {
    ghost: "text-muted hover:bg-card-hover hover:text-foreground",
    soft: "bg-accent/10 text-accent hover:bg-accent/20",
    primary: "bg-accent text-white hover:bg-accent-hover",
    danger: "bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20",
  } as const;
  return <button className={`${base} ${map[variant]} ${className}`} {...props} />;
}

function MoreMenu({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute right-3 top-3 z-20">
      <div className="relative">
        {children}
      </div>
    </div>
  );
}

type LibraryTypeKey = "comic" | "novel" | "mixed" | "default";

const typePalette: Record<LibraryTypeKey, {
  iconWrap: string;
  accentText: string;
  tag: string;
  glow: string;
}> = {
  comic: {
    iconWrap: "bg-gradient-to-br from-indigo-500/10 to-violet-500/10 text-indigo-600 dark:text-indigo-400",
    accentText: "text-indigo-600 dark:text-indigo-400",
    tag: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
    glow: "group-hover:shadow-indigo-500/10",
  },
  novel: {
    iconWrap: "bg-gradient-to-br from-amber-500/10 to-stone-500/10 text-amber-600 dark:text-amber-400",
    accentText: "text-amber-600 dark:text-amber-400",
    tag: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    glow: "group-hover:shadow-amber-500/10",
  },
  mixed: {
    iconWrap: "bg-gradient-to-br from-muted/10 to-sky-500/10 text-muted",
    accentText: "text-foreground",
    tag: "bg-muted/20 text-muted",
    glow: "group-hover:shadow-muted/10",
  },
  default: {
    iconWrap: "bg-gradient-to-br from-muted/10 to-blue-500/10 text-muted",
    accentText: "text-foreground",
    tag: "bg-muted/20 text-muted",
    glow: "group-hover:shadow-muted/10",
  },
};

function useTypePalette(type: string) {
  const key: LibraryTypeKey = type in typePalette ? (type as LibraryTypeKey) : "default";
  return typePalette[key];
}
export function LibraryManagementPanel() {
  const { user: currentUser } = useAuth();
  const [libraries, setLibraries] = useState<LibraryType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<"comic" | "novel" | "mixed">("comic");
  const [newRootPaths, setNewRootPaths] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editType, setEditType] = useState<"comic" | "novel" | "mixed">("comic");
  const [editRootPaths, setEditRootPaths] = useState<string[]>([]);
  const [editScanEnabled, setEditScanEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [scanningId, setScanningId] = useState<string | null>(null);

  const [deletingTarget, setDeletingTarget] = useState<LibraryType | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const [browseOpen, setBrowseOpen] = useState(false);
  const [browseTarget, setBrowseTarget] = useState<"create" | "edit">("create");

  const [newDefaultAccess, setNewDefaultAccess] = useState<"public" | "private">("private");
  const [newScanEnabled, setNewScanEnabled] = useState(true);
  const [editDefaultAccess, setEditDefaultAccess] = useState<"public" | "private">("private");
  const [editScanEnabledState, setEditScanEnabledState] = useState(true);

  const showMessage = useCallback((msg: string, isError = false) => {
    if (isError) {
      setError(msg);
      setSuccess("");
    } else {
      setSuccess(msg);
      setError("");
    }
    setTimeout(() => {
      setError("");
      setSuccess("");
    }, 3000);
  }, []);

  const fetchLibraryList = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchLibraries();
      setLibraries(data);
    } catch {
      showMessage("获取书库列表失败", true);
    } finally {
      setLoading(false);
    }
  }, [showMessage]);

  useEffect(() => {
    fetchLibraryList();
  }, [fetchLibraryList]);

  useEffect(() => {
    if (!openMenuId) return;
    const close = () => setOpenMenuId(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [openMenuId]);

  const filteredLibraries = useMemo(() => {
    if (!searchQuery.trim()) return libraries;
    const q = searchQuery.toLowerCase();
    return libraries.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.type.toLowerCase().includes(q) ||
        item.rootPath.toLowerCase().includes(q) ||
        (item.rootPaths && item.rootPaths.some(p => p.toLowerCase().includes(q)))
    );
  }, [libraries, searchQuery]);

  const summary = useMemo(() => {
    return {
      total: libraries.length,
      content: libraries.reduce((sum, item) => sum + (item.comicCount ?? 0), 0),
      scanEnabledCount: libraries.filter((item) => item.scanEnabled).length,
      alerts: libraries.filter((item) => !item.enabled || !item.lastScanAt).length,
    };
  }, [libraries]);

  const handleCreate = async () => {
    const validPaths = newRootPaths.filter(p => p.trim());
    if (!newName.trim() || validPaths.length === 0) {
      showMessage("名称和路径不能为空", true);
      return;
    }

    setCreating(true);
    try {
      const lib = await createLibrary({
        name: newName.trim(),
        type: newType,
        rootPaths: validPaths,
        defaultAccess: newDefaultAccess,
        scanEnabled: newScanEnabled,
      });
      showMessage("书库创建成功");
      setShowCreateForm(false);
      setNewName("");
      setNewRootPaths([]);
      fetchLibraryList();
      // 创建后自动扫描
      if (newScanEnabled && lib?.id) {
        setScanningId(lib.id);
        try {
          const result = await scanLibrary(lib.id);
          showMessage(`扫描完成，新增 ${result.added} 个内容`);
          fetchLibraryList();
        } catch {
          // 扫描失败不阻塞创建流程
        } finally {
          setScanningId(null);
        }
      }
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "创建失败", true);
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (lib: LibraryType) => {
    setEditingId(lib.id);
    setEditName(lib.name);
    setEditType(lib.type);
    // 优先使用 rootPaths，如果没有则使用 [rootPath]
    setEditRootPaths(lib.rootPaths && lib.rootPaths.length > 0 ? lib.rootPaths : [lib.rootPath]);
    setEditScanEnabled(lib.scanEnabled);
    setEditDefaultAccess(lib.defaultAccess || "private");
    setEditScanEnabledState(lib.scanEnabled);
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const handleSave = async (id: string) => {
    const validPaths = editRootPaths.filter(p => p.trim());
    if (!editName.trim() || validPaths.length === 0) {
      showMessage("名称和路径不能为空", true);
      return;
    }

    setSaving(true);
    try {
      await updateLibrary(id, {
        name: editName.trim(),
        type: editType,
        rootPaths: validPaths,
        scanEnabled: editScanEnabled,
        defaultAccess: editDefaultAccess,
        enabled: editScanEnabledState,
      });
      showMessage("书库更新成功");
      setEditingId(null);
      fetchLibraryList();
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "更新失败", true);
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (id: string, enabled: boolean) => {
    try {
      await updateLibrary(id, { enabled: !enabled });
      showMessage(enabled ? "书库已禁用" : "书库已启用");
      fetchLibraryList();
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "更新失败", true);
    }
  };

  const handleScan = async (id: string) => {
    try {
      setScanningId(id);
      const result = await scanLibrary(id);
      showMessage(`扫描完成，新增 ${result.added} 个内容`);
      fetchLibraryList();
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "扫描失败", true);
    } finally {
      setScanningId(null);
    }
  };

  const handleDelete = async () => {
    if (!deletingTarget) return;
    try {
      setDeleting(true);
      await deleteLibrary(deletingTarget.id);
      showMessage("书库已从管理中心移除");
      setDeletingTarget(null);
      fetchLibraryList();
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "删除失败", true);
    } finally {
      setDeleting(false);
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "comic":
        return <Book className="h-5 w-5" />;
      case "novel":
        return <BookOpen className="h-5 w-5" />;
      case "mixed":
        return <Library className="h-5 w-5" />;
      default:
        return <Library className="h-5 w-5" />;
    }
  };

  const formatDate = (date: string | null) => {
    if (!date) return "未扫描";
    try { return new Date(date).toLocaleString("zh-CN"); } catch { return date; }
  };

  const getTypeName = (type: string) => {
    switch (type) {
      case "comic":
        return "漫画";
      case "novel":
        return "小说";
      case "mixed":
        return "混合";
      default:
        return type;
    }
  };

  const getStatuses = (lib: LibraryType): NormalizedStatus[] => {
    const statuses: NormalizedStatus[] = [];
    statuses.push(lib.scanEnabled ? "scan-on" : "scan-off");
    statuses.push((lib.defaultAccess || "private") === "public" ? "access-public" : "access-private");
    statuses.push(lib.lastScanAt ? "last-scanned" : "last-unscanned");
    statuses.push(lib.enabled ? "enabled" : "disabled");
    return statuses;
  };

  if (!currentUser || currentUser.role !== "admin") {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted">需要管理员权限</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <VaultCardShell>
        <div className="relative rounded-[20px] bg-gradient-to-br from-accent/5 to-accent/10 p-5 sm:p-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-medium text-accent">
                <Library className="h-4 w-4" />
                Library Vault
              </div>
              <h2 className="mt-2 text-2xl font-bold text-foreground">书库管理</h2>
              <p className="mt-1 max-w-xl text-sm text-muted">
                管理你的私人藏书空间、扫描规则与访问权限，保持书库整洁有序。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索书库名称、类型、路径"
                  className="w-56 rounded-xl border border-border bg-card/80 py-2 pl-9 pr-3 text-sm text-foreground shadow-sm placeholder:text-muted focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
                />
              </div>
              <InlineButton variant="ghost" onClick={fetchLibraryList}>
                <RefreshCw className="h-4 w-4" /> 刷新
              </InlineButton>
              <InlineButton variant="soft" onClick={() => setShowCreateForm(true)}>
                <Plus className="h-4 w-4" /> 创建书库
              </InlineButton>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-4">
            <VaultMetric icon={<Database className="h-4 w-4" />} label="书库数量" value={summary.total} />
            <VaultMetric icon={<BookOpen className="h-4 w-4" />} label="总内容" value={summary.content} />
            <VaultMetric icon={<Activity className="h-4 w-4" />} label="自动扫描" value={`${summary.scanEnabledCount} 个开启`} />
            <VaultMetric icon={<ShieldAlert className="h-4 w-4" />} label="待关注" value={`${summary.alerts} 项`} />
          </div>
        </div>
      </VaultCardShell>

      {error && (
        <div className="flex items-center gap-2 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-rose-600 dark:text-rose-400">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-emerald-600 dark:text-emerald-400">
          <Check className="h-4 w-4" />
          {success}
        </div>
      )}

      {showCreateForm && (
        <VaultCardShell active>
          <div className="p-5 sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">创建新书库</h3>
                <p className="mt-1 text-sm text-slate-500">新建一个独立藏书空间，设置目录与默认访问范围。</p>
              </div>
              <button onClick={() => setShowCreateForm(false)} className="rounded-lg p-1.5 text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-muted">
                  书库名称 <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="例如：家庭漫画"
                  className="mt-2 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground shadow-sm focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted">书库类型</label>
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as "comic" | "novel" | "mixed")}
                  className="mt-2 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground shadow-sm focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
                >
                  <option value="comic">漫画</option>
                  <option value="novel">小说</option>
                  <option value="mixed">混合</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-muted">默认访问</label>
                <select
                  value={newDefaultAccess}
                  onChange={(e) => setNewDefaultAccess(e.target.value as "public" | "private")}
                  className="mt-2 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground shadow-sm focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
                >
                  <option value="private">私有</option>
                  <option value="public">公开</option>
                </select>
              </div>
              <div className="flex items-end gap-3">
                <label className="flex items-center gap-2 text-sm text-muted">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
                    checked={newScanEnabled}
                    onChange={(e) => setNewScanEnabled(e.target.checked)}
                  />
                  创建后自动扫描
                </label>
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-muted">
                  根目录路径 <span className="text-rose-500">*</span>
                </label>
                <div className="mt-2 space-y-2">
                  {newRootPaths.map((path, index) => (
                    <div key={index} className="flex gap-2">
                      <input
                        type="text"
                        value={path}
                        onChange={(e) => {
                          const newPaths = [...newRootPaths];
                          newPaths[index] = e.target.value;
                          setNewRootPaths(newPaths);
                        }}
                        placeholder="例如：/mnt/comics 或 D:\Comics"
                        className="flex-1 rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground shadow-sm focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
                      />
                      <InlineButton variant="ghost" type="button" onClick={() => {
                        setNewRootPaths(prev => prev.filter((_, i) => i !== index));
                      }}>
                        <X className="h-4 w-4" />
                      </InlineButton>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <InlineButton variant="ghost" type="button" onClick={() => { setBrowseTarget("create"); setBrowseOpen(true); }}>
                      <FolderOpen className="h-4 w-4" /> 浏览添加
                    </InlineButton>
                    <InlineButton variant="ghost" type="button" onClick={() => setNewRootPaths(prev => [...prev, ""])}>
                      <Plus className="h-4 w-4" /> 手动添加
                    </InlineButton>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-2">
              <InlineButton variant="primary" onClick={handleCreate} disabled={creating}>
                {creating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {creating ? "创建中..." : "创建书库"}
              </InlineButton>
              <InlineButton variant="ghost" onClick={() => setShowCreateForm(false)}>取消</InlineButton>
            </div>
          </div>
        </VaultCardShell>
      )}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-48 animate-pulse rounded-[20px] border border-border/70 bg-card/70" />
          ))}
        </div>
      ) : filteredLibraries.length === 0 ? (
        <VaultCardShell>
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 text-accent">
              <Library className="h-6 w-6" />
            </div>
            <h3 className="text-lg font-semibold text-foreground">还没有书库</h3>
            <p className="mt-1 max-w-md text-sm text-muted">创建第一个书库，把漫画、小说或混合内容集中到专属藏书空间。</p>
            <div className="mt-5">
              <InlineButton variant="soft" onClick={() => setShowCreateForm(true)}>
                <Plus className="h-4 w-4" /> 创建第一个书库
              </InlineButton>
            </div>
          </div>
        </VaultCardShell>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {filteredLibraries.map((lib) => {
            const statuses = getStatuses(lib);
            return (
              <VaultCardShell key={lib.id} active={editingId === lib.id} disabled={!lib.enabled} className={useTypePalette(lib.type).glow}>
                <MoreMenu>
                  <button
                    type="button"
                    className="flex h-9 w-9 items-center justify-center rounded-xl bg-card/90 text-muted shadow-sm ring-1 ring-border transition-colors hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenMenuId((prev) => (prev === lib.id ? null : lib.id));
                    }}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                  {openMenuId === lib.id && (
                    <div className="absolute right-0 top-11 z-30 w-48 overflow-hidden rounded-xl border border-border bg-card p-1 shadow-xl">
                      <button
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-muted hover:bg-card-hover hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuId(null);
                          handleScan(lib.id);
                        }}
                      >
                        <ScanLine className="h-4 w-4" /> 立即扫描
                      </button>
                      <button
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-muted hover:bg-card-hover hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuId(null);
                          const paths = lib.rootPaths && lib.rootPaths.length > 0 ? lib.rootPaths : [lib.rootPath];
                          navigator.clipboard.writeText(paths.join("\n"));
                          showMessage("已复制书库路径");
                        }}
                      >
                        <Copy className="h-4 w-4" /> 复制路径
                      </button>
                      <button
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-muted hover:bg-card-hover hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuId(null);
                          toggleEnabled(lib.id, lib.enabled);
                        }}
                      >
                        {lib.enabled ? <ToggleLeft className="h-4 w-4" /> : <ToggleRight className="h-4 w-4" />}
                        {lib.enabled ? "禁用书库" : "启用书库"}
                      </button>
                      <button
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-muted hover:bg-card-hover hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuId(null);
                          startEdit(lib);
                        }}
                      >
                        <Edit className="h-4 w-4" /> 编辑书库
                      </button>
                      <div className="my-1 h-px bg-border" />
                      <button
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuId(null);
                          setDeletingTarget(lib);
                        }}
                      >
                        <Trash2 className="h-4 w-4" /> 删除书库
                      </button>
                    </div>
                  )}
                </MoreMenu>

                {editingId === lib.id ? (
                  <div className="p-5 sm:p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-lg font-semibold text-foreground">编辑书库</h3>
                        <p className="mt-1 text-sm text-muted">调整书库名称、目录或扫描设置。</p>
                      </div>
                      <button onClick={cancelEdit} className="rounded-lg p-1.5 text-muted hover:text-foreground">
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div>
                        <label className="block text-sm font-medium text-muted">
                          书库名称 <span className="text-rose-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="mt-2 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground shadow-sm focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-muted">书库类型</label>
                        <select
                          value={editType}
                          onChange={(e) => setEditType(e.target.value as "comic" | "novel" | "mixed")}
                          className="mt-2 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground shadow-sm focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
                        >
                          <option value="comic">漫画</option>
                          <option value="novel">小说</option>
                          <option value="mixed">混合</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-muted">默认访问</label>
                        <select
                          value={editDefaultAccess}
                          onChange={(e) => setEditDefaultAccess(e.target.value as "public" | "private")}
                          className="mt-2 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground shadow-sm focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
                        >
                          <option value="private">私有</option>
                          <option value="public">公开</option>
                        </select>
                      </div>
                      <div className="flex items-end gap-3">
                        <label className="flex items-center gap-2 text-sm text-muted">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
                            checked={editScanEnabled}
                            onChange={(e) => setEditScanEnabled(e.target.checked)}
                          />
                          自动扫描
                        </label>
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-muted">
                          根目录路径 <span className="text-rose-500">*</span>
                        </label>
                        <div className="mt-2 space-y-2">
                          {editRootPaths.map((path, index) => (
                            <div key={index} className="flex gap-2">
                              <input
                                type="text"
                                value={path}
                                onChange={(e) => {
                                  const newPaths = [...editRootPaths];
                                  newPaths[index] = e.target.value;
                                  setEditRootPaths(newPaths);
                                }}
                                className="flex-1 rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground shadow-sm focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
                              />
                              <InlineButton variant="ghost" type="button" onClick={() => {
                                setEditRootPaths(prev => prev.filter((_, i) => i !== index));
                              }}>
                                <X className="h-4 w-4" />
                              </InlineButton>
                            </div>
                          ))}
                          <div className="flex gap-2">
                            <InlineButton variant="ghost" type="button" onClick={() => { setBrowseTarget("edit"); setBrowseOpen(true); }}>
                              <FolderOpen className="h-4 w-4" /> 浏览添加
                            </InlineButton>
                            <InlineButton variant="ghost" type="button" onClick={() => setEditRootPaths(prev => [...prev, ""])}>
                              <Plus className="h-4 w-4" /> 手动添加
                            </InlineButton>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-6 flex flex-wrap items-center gap-2">
                      <InlineButton variant="primary" onClick={() => handleSave(lib.id)} disabled={saving}>
                        {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        {saving ? "保存中..." : "保存修改"}
                      </InlineButton>
                      <InlineButton variant="ghost" onClick={cancelEdit}>取消</InlineButton>
                    </div>
                  </div>
                ) : (
                  <div className="p-5 sm:p-6">
                    <div className="flex flex-wrap items-start gap-4">
                      <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${useTypePalette(lib.type).iconWrap}`}>
                        {getTypeIcon(lib.type)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className={`truncate text-lg font-semibold ${useTypePalette(lib.type).accentText}`}>{lib.name}</h3>
                          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${useTypePalette(lib.type).tag}`}>
                            {getTypeName(lib.type)}
                          </span>
                        </div>
                        <div className="mt-1 text-sm text-slate-500">
                          {(lib.rootPaths && lib.rootPaths.length > 0 ? lib.rootPaths : [lib.rootPath]).map((path, index) => (
                            <div key={index} className="truncate">
                              <span className="inline-flex items-center gap-1">
                                <FolderOpen className="h-3.5 w-3.5 flex-shrink-0" />
                                <span className="truncate">{path}</span>
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {statuses.map((status) => (
                        <StatusChip key={status} status={status} />
                      ))}
                    </div>

                    <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 text-sm text-muted sm:grid-cols-4">
                      <div className="space-y-0.5">
                        <div className="text-[11px] uppercase tracking-wide text-muted/70">内容数</div>
                        <div className="text-base font-semibold text-foreground">{lib.comicCount ?? 0}</div>
                      </div>
                      <div className="space-y-0.5">
                        <div className="text-[11px] uppercase tracking-wide text-muted/70">上次扫描</div>
                        <div className="font-medium text-foreground">{formatDate(lib.lastScanAt)}</div>
                      </div>
                      <div className="space-y-0.5">
                        <div className="text-[11px] uppercase tracking-wide text-muted/70">上次新增</div>
                        <div className="text-base font-semibold text-foreground">{lib.lastScanAdded ?? 0}</div>
                      </div>
                      <div className="space-y-0.5">
                        <div className="text-[11px] uppercase tracking-wide text-muted/70">文件数</div>
                        <div className="text-base font-semibold text-foreground">{lib.lastScanTotal ?? 0}</div>
                      </div>
                    </div>

                    <div className="mt-5 flex flex-wrap items-center gap-2">
                      <InlineButton variant="primary" onClick={() => handleScan(lib.id)} disabled={scanningId === lib.id}>
                        {scanningId === lib.id ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4" />}
                        立即扫描
                      </InlineButton>
                      <InlineButton variant="ghost" onClick={() => startEdit(lib)}>
                        <Edit className="h-4 w-4" /> 编辑
                      </InlineButton>
                    </div>
                  </div>
                )}
              </VaultCardShell>
            );
          })}
        </div>
      )}
      {deletingTarget && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => { if (!deleting) setDeletingTarget(null); }} />
          <div className="relative mx-4 w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h3 className="text-base font-semibold text-foreground">删除书库？</h3>
              <button
                disabled={deleting}
                onClick={() => setDeletingTarget(null)}
                className="rounded-lg p-1.5 text-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 px-5 py-4 text-sm text-muted">
              <p>
                即将从管理中心移除 <span className="font-semibold text-foreground">{deletingTarget.name}</span>。
              </p>
              <p>
                该操作仅移除书库记录，不会删除本地文件。若需彻底清理，请在服务器文件系统中手动处理。
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
              <InlineButton variant="ghost" disabled={deleting} onClick={() => setDeletingTarget(null)}>取消</InlineButton>
              <InlineButton variant="danger" disabled={deleting} onClick={handleDelete}>
                {deleting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                确认删除
              </InlineButton>
            </div>
          </div>
        </div>
      )}

      <FolderBrowser
        open={browseOpen}
        onClose={() => setBrowseOpen(false)}
        onSelect={(path) => {
          const setPaths = browseTarget === "create" ? setNewRootPaths : setEditRootPaths;
          setPaths(prev => {
            const emptyIndex = prev.findIndex(p => !p.trim());
            if (emptyIndex !== -1) {
              const updated = [...prev];
              updated[emptyIndex] = path;
              return updated;
            }
            return [...prev, path];
          });
        }}
      />
    </div>
  );
}
