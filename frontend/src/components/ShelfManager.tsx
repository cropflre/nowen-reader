"use client";

import { useState, useMemo, useEffect } from "react";
import { BookOpen, Plus, Edit2, Trash2, X, ChevronRight } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { useShelves, type ShelfData } from "@/hooks/useShelves";

interface ShelfManagerProps {
  selectedShelfId: number | null;
  onShelfSelect: (id: number | null) => void;
  /** 用于批量操作：将选中的漫画添加到书架 */
  selectedComicIds?: string[];
  onBatchMoveComplete?: () => void;
}

export default function ShelfManager({
  selectedShelfId,
  onShelfSelect,
  selectedComicIds,
  onBatchMoveComplete,
}: ShelfManagerProps) {
  const t = useTranslation();
  const { shelves, createShelf, updateShelf, deleteShelf, addComicToShelf, initShelves } = useShelves();

  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("📚");

  // 首次自动初始化预定义书架
  useEffect(() => {
    if (shelves.length === 0) {
      initShelves("zh");
    }
  }, [shelves.length, initShelves]);

  const shelfIcons = ["📖", "📋", "✅", "⏸️", "🚫", "📚", "❤️", "⭐", "🔥", "🎮", "🎬", "🎵"];

  const handleCreate = async () => {
    if (!name.trim()) return;
    await createShelf(name.trim(), icon);
    setName("");
    setIcon("📚");
    setShowCreate(false);
  };

  const handleUpdate = async () => {
    if (!name.trim() || editingId === null) return;
    await updateShelf(editingId, name.trim(), icon);
    setName("");
    setIcon("📚");
    setEditingId(null);
  };

  const handleDelete = async (id: number) => {
    if (confirm(t.shelf?.confirmDeleteShelf || "确定要删除此书架吗？")) {
      await deleteShelf(id);
      if (selectedShelfId === id) onShelfSelect(null);
    }
  };

  const handleBatchMove = async (shelfId: number) => {
    if (!selectedComicIds?.length) return;
    await addComicToShelf(shelfId, selectedComicIds, true);
    onBatchMoveComplete?.();
  };

  const startEdit = (shelf: ShelfData) => {
    setEditingId(shelf.id);
    setName(shelf.name);
    setIcon(shelf.icon);
    setShowCreate(false);
  };

  return (
    <div className="mb-4">
      {/* 书架列表横向滚动 */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide" style={{ scrollbarWidth: "none" }}>
        {/* 全部 */}
        <button
          onClick={() => onShelfSelect(null)}
          className={`flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-all ${
            selectedShelfId === null
              ? "bg-accent text-white"
              : "bg-card text-muted hover:text-foreground"
          }`}
        >
          <BookOpen className="h-3.5 w-3.5" />
          <span>{t.common?.all || "全部"}</span>
        </button>

        {/* 各书架按钮 */}
        {shelves.map((shelf) => (
          <button
            key={shelf.id}
            onClick={() => {
              if (selectedComicIds?.length) {
                handleBatchMove(shelf.id);
              } else {
                onShelfSelect(shelf.id === selectedShelfId ? null : shelf.id);
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              startEdit(shelf);
            }}
            className={`group relative flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-all ${
              selectedShelfId === shelf.id
                ? "bg-accent text-white"
                : selectedComicIds?.length
                  ? "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/30"
                  : "bg-card text-muted hover:text-foreground"
            }`}
            title={selectedComicIds?.length ? `${t.shelf?.moveTo || "移动到"} ${shelf.name}` : shelf.name}
          >
            <span>{shelf.icon}</span>
            <span>{shelf.name}</span>
            <span className="ml-1 text-xs opacity-60">{shelf.count}</span>

            {/* 编辑/删除浮层 */}
            {!selectedComicIds?.length && (
              <span className="absolute -right-1 -top-1 hidden gap-0.5 group-hover:flex">
                <button
                  onClick={(e) => { e.stopPropagation(); startEdit(shelf); }}
                  className="flex h-5 w-5 items-center justify-center rounded-full bg-card text-muted shadow hover:text-foreground"
                >
                  <Edit2 className="h-2.5 w-2.5" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(shelf.id); }}
                  className="flex h-5 w-5 items-center justify-center rounded-full bg-card text-rose-400 shadow hover:text-rose-300"
                >
                  <Trash2 className="h-2.5 w-2.5" />
                </button>
              </span>
            )}
          </button>
        ))}

        {/* 新建书架 */}
        {!selectedComicIds?.length && (
          <button
            onClick={() => {
              setShowCreate(!showCreate);
              setEditingId(null);
              setName("");
              setIcon("📚");
            }}
            className="flex h-9 shrink-0 items-center gap-1 rounded-lg border border-dashed border-border/60 px-3 text-xs text-muted transition-colors hover:border-accent/50 hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t.shelf?.create || "新建书架"}</span>
          </button>
        )}
      </div>

      {/* 创建/编辑表单 */}
      {(showCreate || editingId !== null) && (
        <div className="mt-2 flex items-center gap-2 rounded-lg bg-card p-3">
          {/* 图标选择 */}
          <div className="flex flex-wrap gap-1">
            {shelfIcons.map((ic) => (
              <button
                key={ic}
                onClick={() => setIcon(ic)}
                className={`flex h-7 w-7 items-center justify-center rounded text-sm transition-all ${
                  icon === ic ? "bg-accent/20 ring-1 ring-accent" : "hover:bg-card-hover"
                }`}
              >
                {ic}
              </button>
            ))}
          </div>

          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") editingId ? handleUpdate() : handleCreate();
            }}
            placeholder={t.shelf?.namePlaceholder || "书架名称..."}
            className="h-8 flex-1 rounded-lg border border-border/60 bg-background px-3 text-sm text-foreground outline-none focus:border-accent/50"
            autoFocus
          />

          <button
            onClick={editingId ? handleUpdate : handleCreate}
            className="flex h-8 items-center gap-1 rounded-lg bg-accent px-3 text-xs font-medium text-white hover:bg-accent-hover"
          >
            <ChevronRight className="h-3.5 w-3.5" />
            <span>{editingId ? (t.common?.save || "保存") : (t.shelf?.create || "新建")}</span>
          </button>

          <button
            onClick={() => { setShowCreate(false); setEditingId(null); }}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
