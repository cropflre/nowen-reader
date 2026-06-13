"use client";

import { X, Bookmark, Trash2 } from "lucide-react";
import type { ComicBookmark } from "@/hooks/useComicBookmarks";
import { useTranslation } from "@/lib/i18n";

interface BookmarkPanelProps {
  bookmarks: ComicBookmark[];
  currentPage: number;
  onJump: (pageIndex: number) => void;
  onRemove: (pageIndex: number) => void;
  onClose: () => void;
}

export default function BookmarkPanel({
  bookmarks,
  currentPage,
  onJump,
  onRemove,
  onClose,
}: BookmarkPanelProps) {
  const t = useTranslation();
  const rb = t.readerBookmarks;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-md max-h-[calc(60vh-env(safe-area-inset-bottom,0px))] rounded-t-2xl sm:rounded-2xl bg-[#1e1e1e] shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Bookmark className="h-4 w-4 text-amber-400" />
            <span className="text-sm font-medium text-white/90">{rb.title}</span>
            <span className="text-xs text-white/40">({bookmarks.length})</span>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-2 py-2" style={{ paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom, 0px))" }}>
          {bookmarks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-white/30">
              <Bookmark className="h-8 w-8 mb-2" />
              <span className="text-xs">{rb.empty}</span>
            </div>
          ) : (
            bookmarks.map((b) => {
              const isActive = b.pageIndex === currentPage;
              return (
                <div
                  key={b.pageIndex}
                  className={`flex items-center justify-between rounded-lg px-3 py-2 mb-1 cursor-pointer transition-colors ${
                    isActive
                      ? "bg-accent/20 text-accent"
                      : "text-white/70 hover:bg-white/8 hover:text-white"
                  }`}
                  onClick={() => onJump(b.pageIndex)}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-xs font-mono shrink-0">
                      {rb.page} {b.pageIndex + 1}
                    </span>
                    <span className="text-[11px] text-white/30 truncate">
                      {new Date(b.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(b.pageIndex);
                    }}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-white/30 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                    title={rb.remove}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
