"use client";

import { useState } from "react";
import { FolderPlus, X } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

interface MergeGroupDialogProps {
  selectedCount: number;
  onConfirm: (name: string) => void;
  onClose: () => void;
}

export default function MergeGroupDialog({
  selectedCount,
  onConfirm,
  onClose,
}: MergeGroupDialogProps) {
  const [name, setName] = useState("");
  const t = useTranslation();

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/60 animate-backdrop-in" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-[60] w-[90vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-6 shadow-2xl animate-modal-in">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <FolderPlus className="h-5 w-5 text-accent" />
            <h3 className="text-lg font-semibold text-foreground">
              {t.comicGroup?.mergeSelected || "合并为分组"}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-card-hover"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-4 text-sm text-muted">
          将选中的 <span className="font-medium text-accent">{selectedCount}</span> 本漫画合并为一个分组
        </p>

        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) {
              onConfirm(name.trim());
            }
          }}
          placeholder={t.comicGroup?.groupNamePlaceholder || "输入分组名称..."}
          className="w-full rounded-xl bg-background px-4 py-3 text-sm text-foreground placeholder-muted/50 outline-none focus:ring-2 focus:ring-accent/30"
          autoFocus
        />

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-lg bg-card px-4 py-2 text-sm text-foreground hover:bg-card-hover"
          >
            {t.common.cancel}
          </button>
          <button
            onClick={() => {
              if (name.trim()) onConfirm(name.trim());
            }}
            disabled={!name.trim()}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {t.comicGroup?.createGroup || "创建分组"}
          </button>
        </div>
      </div>
    </>
  );
}
