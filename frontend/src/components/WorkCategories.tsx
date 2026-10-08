"use client";

import { useState } from "react";
import { Check, FolderOpen, Loader2, Plus, X } from "lucide-react";
import { apiClient } from "@/lib/apiClient";
import type { GroupCategory } from "@/api/groups";
import { useToast } from "@/components/Toast";

export default function WorkCategories({ categories, canEdit, onSave }: {
  categories: GroupCategory[];
  canEdit: boolean;
  onSave: (slugs: string[]) => Promise<void>;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState<GroupCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(false);
    try {
      const data = await apiClient.get<{ categories: GroupCategory[] }>("/api/categories");
      setAvailable(data.categories);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  const toggle = async (slug: string) => {
    if (saving || !canEdit) return;
    setSaving(true);
    const selected = categories.some((category) => category.slug === slug);
    const slugs = categories.map((category) => category.slug);
    try {
      await onSave(selected ? slugs.filter((value) => value !== slug) : [...slugs, slug]);
    } catch {
      toast.error("保存分类失败，请重试");
    } finally {
      setSaving(false);
    }
  };

  return <div className="space-y-3" aria-busy={saving}>
    <h2 className="flex items-center gap-1.5 text-xs font-medium text-muted"><FolderOpen className="h-3.5 w-3.5" />分类</h2>
    <div className="flex flex-wrap gap-1.5">
      {categories.map((category) => <span key={category.id} className="inline-flex items-center gap-1 rounded-lg bg-blue-500/10 px-2.5 py-1 text-xs text-blue-400">
        <span>{category.icon}</span>{category.name}
        {canEdit && <button type="button" aria-label={`移除分类 ${category.name}`} disabled={saving} onClick={() => void toggle(category.slug)} className="rounded-full p-0.5 hover:bg-blue-500/15 disabled:opacity-40"><X className="h-3 w-3" /></button>}
      </span>)}
      {categories.length === 0 && <span className="text-xs text-muted/60">暂无分类</span>}
    </div>
    {canEdit && <button type="button" aria-expanded={open} onClick={() => { setOpen(!open); if (!open) void load(); }} className="flex items-center gap-1.5 rounded-lg bg-blue-500/15 px-2.5 py-1.5 text-xs text-blue-400 hover:bg-blue-500/25"><Plus className="h-3.5 w-3.5" />选择分类</button>}
    {canEdit && open && <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
      {loading ? <p role="status" className="flex items-center gap-1.5 text-xs text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" />加载分类中…</p> : error ? <p role="alert" className="text-xs text-red-400">分类列表加载失败 <button type="button" onClick={() => void load()} className="underline">重试</button></p> : available.length === 0 ? <p className="text-xs text-muted">暂无可用分类，请先由管理员创建分类</p> : <div className="flex flex-wrap gap-2">
        {available.map((category) => {
          const selected = categories.some((item) => item.slug === category.slug);
          return <button type="button" key={category.id} aria-pressed={selected} disabled={saving} onClick={() => void toggle(category.slug)} className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs disabled:opacity-40 ${selected ? "bg-blue-500/20 text-blue-400 ring-1 ring-blue-500/40" : "bg-background/50 text-muted hover:text-foreground"}`}>{selected && <Check className="h-3 w-3" />}{category.icon} {category.name}</button>;
        })}
      </div>}
    </div>}
  </div>;
}
