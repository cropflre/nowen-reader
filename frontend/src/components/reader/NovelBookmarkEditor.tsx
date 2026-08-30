"use client";

import { useEffect, useState } from "react";
import { Bookmark, X } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import type { NovelBookmark } from "./text-reader-types";

interface NovelBookmarkEditorProps {
  bookmark: NovelBookmark;
  isNew: boolean;
  isDark: boolean;
  onSave: (name: string, note: string) => void;
  onClose: () => void;
}

export default function NovelBookmarkEditor({
  bookmark,
  isNew,
  isDark,
  onSave,
  onClose,
}: NovelBookmarkEditorProps) {
  const t = useTranslation();
  const [name, setName] = useState(bookmark.name);
  const [note, setNote] = useState(bookmark.note);

  useEffect(() => {
    setName(bookmark.name);
    setNote(bookmark.note);
  }, [bookmark]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 px-4 py-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="novel-bookmark-editor-title"
        className={`max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-lg border p-4 shadow-2xl ${
          isDark ? "border-white/10 bg-zinc-900 text-zinc-100" : "border-black/10 bg-white text-zinc-900"
        }`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Bookmark className="h-4 w-4 shrink-0 fill-amber-500 text-amber-500" />
            <div className="min-w-0">
              <h2 id="novel-bookmark-editor-title" className="text-sm font-semibold">
                {isNew ? t.reader.addBookmark : t.reader.editBookmark}
              </h2>
              <p className="truncate text-[11px] opacity-55">{bookmark.chapterTitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.reader.cancel}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md opacity-60 transition-opacity hover:opacity-100"
            title={t.reader.cancel}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium opacity-75">{t.reader.bookmarkName}</span>
            <input
              autoFocus
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              placeholder={t.reader.bookmarkNamePlaceholder}
              className={`w-full rounded-md border px-3 py-2 text-sm outline-none transition-colors focus:border-amber-500 ${
                isDark ? "border-white/10 bg-white/5" : "border-black/10 bg-black/[0.03]"
              }`}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium opacity-75">{t.reader.bookmarkNote}</span>
            <textarea
              value={note}
              maxLength={500}
              rows={4}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t.reader.bookmarkNotePlaceholder}
              className={`w-full resize-none rounded-md border px-3 py-2 text-sm outline-none transition-colors focus:border-amber-500 ${
                isDark ? "border-white/10 bg-white/5" : "border-black/10 bg-black/[0.03]"
              }`}
            />
          </label>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className={`rounded-md px-3 py-2 text-xs font-medium ${isDark ? "bg-white/5 hover:bg-white/10" : "bg-black/5 hover:bg-black/10"}`}
          >
            {t.reader.cancel}
          </button>
          <button
            type="button"
            onClick={() => onSave(name.trim().slice(0, 80), note.trim().slice(0, 500))}
            className="rounded-md bg-amber-500 px-3 py-2 text-xs font-semibold text-zinc-950 hover:bg-amber-400"
          >
            {t.reader.save}
          </button>
        </div>
      </div>
    </div>
  );
}
