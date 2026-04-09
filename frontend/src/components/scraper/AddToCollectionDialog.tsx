"use client";

import { useState, useEffect } from "react";
import { X, Plus, Search, Loader2, Check, Layers } from "lucide-react";
import Image from "next/image";
import { loadCollectionGroups, addComicsToCollection, createCollection, closeAddToGroupDialog } from "@/lib/scraper-store";
import type { CollectionGroup } from "@/lib/scraper-store";

export function AddToCollectionDialog({
  scraperT,
  groups,
  selectedIds,
  onClose,
}: {
  scraperT: Record<string, string>;
  groups: CollectionGroup[];
  selectedIds: Set<string>;
  onClose: () => void;
}) {
  const [newGroupName, setNewGroupName] = useState("");
  const [creating, setCreating] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card rounded-2xl border border-border/50 shadow-2xl w-[380px] max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-border/30">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-accent" />
            <h3 className="text-sm font-semibold text-foreground">{scraperT.collectionAddToGroup || "添加到合集"}</h3>
          </div>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:text-foreground hover:bg-card-hover">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 创建新合集 */}
        <div className="p-3 border-b border-border/20">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === "Enter" && newGroupName.trim()) {
                  setCreating(true);
                  await createCollection(newGroupName.trim(), Array.from(selectedIds));
                  setCreating(false);
                  setNewGroupName("");
                  onClose();
                }
              }}
              placeholder={scraperT.collectionCreatePlaceholder || "创建新合集..."}
              className="flex-1 rounded-lg border border-border/40 bg-card-hover/50 px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-accent/50"
            />
            <button
              onClick={async () => {
                if (newGroupName.trim()) {
                  setCreating(true);
                  await createCollection(newGroupName.trim(), Array.from(selectedIds));
                  setCreating(false);
                  setNewGroupName("");
                  onClose();
                }
              }}
              disabled={!newGroupName.trim() || creating}
              className="flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-[11px] font-medium text-white transition-all hover:bg-accent-hover disabled:opacity-50"
            >
              {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              {scraperT.collectionCreate || "创建"}
            </button>
          </div>
        </div>

        {/* 已有合集列表 */}
        <div className="flex-1 overflow-y-auto max-h-[400px]">
          {groups.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted">{scraperT.collectionEmpty || "暂无合集"}</div>
          ) : (
            <div className="divide-y divide-border/10">
              {groups.map((group) => (
                <button
                  key={group.id}
                  onClick={async () => {
                    await addComicsToCollection(group.id, Array.from(selectedIds));
                    onClose();
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-card-hover/50 transition-colors text-left"
                >
                  <div className="relative h-8 w-8 flex-shrink-0 overflow-hidden rounded-lg border border-border/30 bg-muted/10">
                    {group.coverUrl ? (
                      <Image src={group.coverUrl} alt="" fill className="object-cover" sizes="32px" unoptimized />
                    ) : (
                      <div className="flex items-center justify-center h-full"><Layers className="h-3 w-3 text-muted" /></div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-foreground truncate">{group.name}</div>
                    <div className="text-[10px] text-muted">
                      {(scraperT.collectionItemCount || "{count} 本").replace("{count}", String(group.comicCount))}
                    </div>
                  </div>
                  <Plus className="h-3.5 w-3.5 text-accent flex-shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

