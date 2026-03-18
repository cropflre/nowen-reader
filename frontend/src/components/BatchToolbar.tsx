"use client";

import { useState } from "react";
import {
  X,
  Heart,
  HeartOff,
  Trash2,
  Tag,
  Layers,
  CheckSquare,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { useCategories, ApiCategory } from "@/hooks/useComics";

interface BatchToolbarProps {
  selectedCount: number;
  onCancel: () => void;
  onDelete: () => void;
  onFavorite: () => void;
  onUnfavorite: () => void;
  onAddTags: (tags: string[]) => void;
  onSetCategory?: (categorySlugs: string[]) => void;
}

export default function BatchToolbar({
  selectedCount,
  onCancel,
  onDelete,
  onFavorite,
  onUnfavorite,
  onAddTags,
  onSetCategory,
}: BatchToolbarProps) {
  const [showTagInput, setShowTagInput] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const t = useTranslation();
  const { categories } = useCategories();

  return (
    <>
      <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/50 bg-background/95 px-3 sm:px-6 py-2 sm:py-3 backdrop-blur-xl safe-bottom">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3">
            <CheckSquare className="h-4 w-4 text-accent" />
            <span className="text-sm font-medium text-foreground">
              {t.batch.selected} <span className="text-accent">{selectedCount}</span> {t.batch.items}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            {/* Favorite */}
            <button
              onClick={onFavorite}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-card px-3 text-xs font-medium text-rose-400 transition-colors hover:bg-rose-500/20"
              title={t.batch.favorite}
            >
              <Heart className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t.batch.favorite}</span>
            </button>

            {/* Unfavorite */}
            <button
              onClick={onUnfavorite}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-card px-3 text-xs font-medium text-muted transition-colors hover:bg-card-hover"
              title={t.batch.unfavorite}
            >
              <HeartOff className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t.batch.unfavorite}</span>
            </button>

            {/* Add Tags */}
            <button
              onClick={() => setShowTagInput(!showTagInput)}
              className={`flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors ${
                showTagInput
                  ? "bg-accent/20 text-accent"
                  : "bg-card text-muted hover:bg-card-hover"
              }`}
              title={t.batch.tags}
            >
              <Tag className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t.batch.tags}</span>
            </button>


            {/* Set Category */}
            {onSetCategory && (
              <button
                onClick={() => setShowCategoryPicker(!showCategoryPicker)}
                className={`flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors ${
                  showCategoryPicker
                    ? "bg-accent/20 text-accent"
                    : "bg-card text-muted hover:bg-card-hover"
                }`}
                title={t.batch.category || "Category"}
              >
                <Layers className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t.batch.category || "分类"}</span>
              </button>
            )}

            {/* Delete */}
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-card px-3 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/20"
              title={t.common.delete}
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t.common.delete}</span>
            </button>

            {/* Cancel */}
            <button
              onClick={onCancel}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-card px-3 text-xs font-medium text-muted transition-colors hover:bg-card-hover"
            >
              <X className="h-3.5 w-3.5" />
              {t.common.cancel}
            </button>
          </div>
        </div>

        {/* Tag Input Inline */}
        {showTagInput && (
          <div className="mx-auto mt-3 flex max-w-[1800px] items-center gap-2">
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && tagInput.trim()) {
                  onAddTags(tagInput.split(",").map((t) => t.trim()).filter(Boolean));
                  setTagInput("");
                  setShowTagInput(false);
                }
              }}
              placeholder={t.batch.tagInputPlaceholder}
              className="flex-1 rounded-lg bg-card px-3 py-2 text-sm text-foreground placeholder-muted/50 outline-none focus:ring-1 focus:ring-accent/50"
              autoFocus
            />
            <button
              onClick={() => {
                if (tagInput.trim()) {
                  onAddTags(tagInput.split(",").map((t) => t.trim()).filter(Boolean));
                  setTagInput("");
                  setShowTagInput(false);
                }
              }}
              className="rounded-lg bg-accent px-4 py-2 text-sm text-white"
            >
              {t.common.confirm}
            </button>
          </div>
        )}


        {/* Category Picker Inline */}
        {showCategoryPicker && onSetCategory && (
          <div className="mx-auto mt-3 max-w-[1800px]">
            <div className="flex flex-wrap gap-2">
              {categories.map((cat: ApiCategory) => (
                <button
                  key={cat.slug}
                  onClick={() => {
                    onSetCategory([cat.slug]);
                    setShowCategoryPicker(false);
                  }}
                  className="flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent/20 hover:border-accent/50 hover:text-accent"
                >
                  <span>{cat.icon}</span>
                  <span>{cat.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Delete Confirm Modal */}
      {showDeleteConfirm && (
        <>
          <div className="fixed inset-0 z-[60] bg-black/60" onClick={() => setShowDeleteConfirm(false)} />
          <div className="fixed left-1/2 top-1/2 z-[60] w-80 -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-card border border-border p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-foreground">{t.batch.confirmDelete}</h3>
            <p className="mt-2 text-sm text-muted">
              {t.batch.confirmDeleteMsg.replace("{count}", String(selectedCount))}
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="rounded-lg bg-card px-4 py-2 text-sm text-foreground"
              >
                {t.common.cancel}
              </button>
              <button
                onClick={() => {
                  onDelete();
                  setShowDeleteConfirm(false);
                }}
                className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white"
              >
                {t.batch.confirmDelete}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
