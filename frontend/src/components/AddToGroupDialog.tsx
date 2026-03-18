"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import { X, FolderPlus, Layers, Plus, Search } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { fetchGroups, addComicsToGroup, createGroup } from "@/api/groups";
import type { ComicGroup } from "@/hooks/useComicTypes";

interface AddToGroupDialogProps {
  comicIds: string[];
  onClose: () => void;
  onDone: () => void;
}

export default function AddToGroupDialog({
  comicIds,
  onClose,
  onDone,
}: AddToGroupDialogProps) {
  const t = useTranslation();
  const [groups, setGroups] = useState<ComicGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const loadGroups = useCallback(async () => {
    setLoading(true);
    const data = await fetchGroups();
    setGroups(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  const filteredGroups = groups.filter(
    (g) => !search || g.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleAddToGroup = useCallback(
    async (groupId: number) => {
      const ok = await addComicsToGroup(groupId, comicIds);
      if (ok) {
        onDone();
      }
    },
    [comicIds, onDone]
  );

  const handleCreateAndAdd = useCallback(async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const result = await createGroup(newName.trim(), comicIds);
      if (result.success) {
        onDone();
      }
    } finally {
      setCreating(false);
    }
  }, [newName, comicIds, onDone]);

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/60 animate-backdrop-in" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-[60] w-[90vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card shadow-2xl animate-modal-in">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/30 px-5 py-3">
          <div className="flex items-center gap-2">
            <FolderPlus className="h-5 w-5 text-accent" />
            <h3 className="text-base font-semibold text-foreground">
              {t.comicGroup?.addToGroup || "加入分组"}
            </h3>
            <span className="rounded-md bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
              {comicIds.length} {t.statsBar?.unit || "本"}
            </span>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-card-hover"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 搜索 */}
        <div className="px-5 pt-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted/50" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.comicGroup?.searchGroupHint || "搜索分组..."}
              className="w-full rounded-xl bg-background py-2.5 pl-9 pr-4 text-sm text-foreground placeholder-muted/50 outline-none focus:ring-1 focus:ring-accent/30"
            />
          </div>
        </div>

        {/* 分组列表 */}
        <div className="max-h-72 overflow-y-auto px-5 py-3">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-accent" />
            </div>
          ) : filteredGroups.length === 0 && !showCreate ? (
            <div className="flex flex-col items-center justify-center py-8">
              <Layers className="mb-2 h-8 w-8 text-muted/30" />
              <p className="text-xs text-muted">
                {groups.length === 0
                  ? (t.comicGroup?.noGroups || "还没有分组")
                  : (t.comicGroup?.noMatchGroup || "无匹配分组")}
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {filteredGroups.map((group) => (
                <button
                  key={group.id}
                  onClick={() => handleAddToGroup(group.id)}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-accent/10"
                >
                  {/* 封面 */}
                  <div className="relative h-10 w-8 flex-shrink-0 overflow-hidden rounded-md bg-muted/10">
                    {group.coverUrl ? (
                      <Image
                        src={group.coverUrl}
                        alt={group.name}
                        fill
                        unoptimized
                        className="object-cover"
                        sizes="32px"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <Layers className="h-4 w-4 text-accent/40" />
                      </div>
                    )}
                  </div>
                  {/* 信息 */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {group.name}
                    </p>
                    <p className="text-[10px] text-muted">
                      {group.comicCount} {t.comicGroup?.volumes || "卷"}
                    </p>
                  </div>
                  <Plus className="h-4 w-4 flex-shrink-0 text-muted/40" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 创建新分组 */}
        <div className="border-t border-border/30 px-5 py-3">
          {showCreate ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newName.trim()) handleCreateAndAdd();
                  if (e.key === "Escape") setShowCreate(false);
                }}
                placeholder={t.comicGroup?.groupNamePlaceholder || "输入分组名称..."}
                className="flex-1 rounded-lg bg-background px-3 py-2 text-sm text-foreground placeholder-muted/50 outline-none focus:ring-1 focus:ring-accent/30"
                autoFocus
              />
              <button
                onClick={handleCreateAndAdd}
                disabled={!newName.trim() || creating}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {creating ? "..." : t.comicGroup?.createGroup || "创建"}
              </button>
              <button
                onClick={() => {
                  setShowCreate(false);
                  setNewName("");
                }}
                className="rounded-lg bg-card px-3 py-2 text-sm text-muted"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowCreate(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border/60 py-2.5 text-sm text-muted transition-colors hover:border-accent/50 hover:text-accent"
            >
              <Plus className="h-4 w-4" />
              {t.comicGroup?.createGroup || "创建新分组"}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
