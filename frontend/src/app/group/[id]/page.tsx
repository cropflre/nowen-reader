"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
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
} from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { useToast } from "@/components/Toast";
import {
  fetchGroupDetail,
  updateGroup,
  deleteGroup,
  removeComicFromGroup,
  reorderGroupComics,
  addComicsToGroup,
} from "@/api/groups";
import type { ComicGroupDetail, GroupComicItem } from "@/hooks/useComicTypes";

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

export default function GroupDetailPage() {
  const params = useParams();
  const router = useRouter();
  const t = useTranslation();
  const toast = useToast();

  const groupId = Number(params?.id);

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

  // 触摸拖拽状态
  const [touchDragId, setTouchDragId] = useState<string | null>(null);
  const touchStartY = useRef<number>(0);
  const comicListRef = useRef<HTMLDivElement>(null);

  const loadGroup = useCallback(async () => {
    if (!groupId) return;
    setLoading(true);
    const data = await fetchGroupDetail(groupId);
    setGroup(data);
    if (data) setEditName(data.name);
    setLoading(false);
  }, [groupId]);

  useEffect(() => {
    loadGroup();
  }, [loadGroup]);

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

  // 删除分组
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
        // 第一次点击，进入确认状态
        setRemoveConfirmId(comicId);
        return;
      }
      // 第二次点击，执行移除
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

  // 搜索漫画用于添加到分组（带防抖）
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
        <p className="mb-4 text-muted">{t.comicDetail?.comicNotFound || "分组不存在"}</p>
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
          <Link
            href="/"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-card hover:text-foreground"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>

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

          {!editMode && (
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
        {/* 统计横条 */}
        <div className="mb-6 flex flex-wrap items-center gap-4 rounded-xl bg-card/50 p-4">
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10">
              <FileText className="h-5 w-5 text-accent" />
            </div>
            <div>
              <p className="text-xs text-muted">{t.comicGroup?.totalPages || "总页数"}</p>
              <p className="text-lg font-semibold text-foreground">
                {totalPages.toLocaleString()}
              </p>
            </div>
          </div>
          <div className="hidden sm:block h-8 w-px bg-border/30" />
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/10">
              <Clock className="h-5 w-5 text-purple-400" />
            </div>
            <div>
              <p className="text-xs text-muted">{t.comicGroup?.totalReadTime || "总阅读时长"}</p>
              <p className="text-lg font-semibold text-foreground">
                {formatDuration(totalReadTime)}
              </p>
            </div>
          </div>
          <div className="hidden sm:block h-8 w-px bg-border/30" />
          <div>
            <p className="text-xs text-muted">{t.comicDetail?.fileSize || "文件大小"}</p>
            <p className="text-lg font-semibold text-foreground">
              {formatFileSize(totalSize)}
            </p>
          </div>

          {/* 继续阅读按钮 */}
          {continueVolume && (
            <>
              <div className="flex-1" />
              <Link
                href={
                  isNovelFile(continueVolume.filename)
                    ? `/novel/${continueVolume.id}`
                    : `/reader/${continueVolume.id}`
                }
                className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-accent/20 transition-all hover:bg-accent-hover hover:shadow-accent/30"
              >
                <BookOpen className="h-4 w-4" />
                {t.comicGroup?.continueReading || "继续阅读"}
              </Link>
            </>
          )}
        </div>

        {/* 卷列表 */}
        {group.comics.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-card">
              <span className="text-4xl">📚</span>
            </div>
            <p className="text-sm text-muted">
              {t.comicGroup?.emptyGroup || "此分组还没有漫画"}
            </p>
          </div>
        ) : (
          <div className="space-y-2" ref={comicListRef}>
            {group.comics.map((comic, index) => {
              const progress =
                comic.pageCount > 0
                  ? Math.round((comic.lastReadPage / comic.pageCount) * 100)
                  : 0;
              const readerUrl = isNovelFile(comic.filename)
                ? `/novel/${comic.id}`
                : `/reader/${comic.id}`;

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
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    setDragId(comic.id);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOverId(comic.id);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleDragEnd();
                  }}
                  onTouchStart={(e) => handleTouchStart(comic.id, e)}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={handleTouchEnd}
                >
                  {/* 拖拽手柄 */}
                  <div className="flex-shrink-0 cursor-grab text-muted/30 hover:text-muted active:cursor-grabbing">
                    <GripVertical className="h-4 w-4" />
                  </div>

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

                  {/* 信息 - 点击跳转到漫画详情页 */}
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

                  {/* 移除按钮（需二次确认） */}
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
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* 删除确认弹窗 */}
      {deleteConfirm && (
        <>
          <div
            className="fixed inset-0 z-[60] bg-black/60 animate-backdrop-in"
            onClick={() => setDeleteConfirm(false)}
          />
          <div className="fixed left-1/2 top-1/2 z-[60] w-80 -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-6 shadow-2xl animate-modal-in">
            <h3 className="text-lg font-semibold text-foreground">
              {t.comicGroup?.confirmDelete || "确认删除分组"}
            </h3>
            <p className="mt-2 text-sm text-muted">
              {(t.comicGroup?.confirmDeleteMsg || "确定要删除分组「{name}」吗？分组内的漫画不会被删除。").replace(
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
        </>
      )}
      {/* 添加漫画弹窗 */}
      {showAddComics && (
        <>
          <div
            className="fixed inset-0 z-[60] bg-black/60 animate-backdrop-in"
            onClick={() => {
              setShowAddComics(false);
              setAddSearchQuery("");
              setAddSearchResults([]);
            }}
          />
          <div className="fixed left-1/2 top-1/2 z-[60] w-[90vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card shadow-2xl animate-modal-in">
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
        </>
      )}
    </div>
  );
}
