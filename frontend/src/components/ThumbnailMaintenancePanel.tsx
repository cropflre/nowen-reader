"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Image, Loader2, RefreshCw, Search, WandSparkles } from "lucide-react";
import { apiPath } from "@/lib/base-path";

interface ThumbnailStats {
  total: number;
  existing: number;
  missing: number;
}

export default function ThumbnailMaintenancePanel() {
  const [stats, setStats] = useState<ThumbnailStats | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch(apiPath("/api/thumbnails/manage"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stats" }),
      });
      if (!res.ok) return;
      setStats(await res.json());
    } catch {
      // Storage overview remains usable when thumbnail diagnostics are unavailable.
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const runThumbnailAction = async (action: "generate-missing" | "regenerate-all") => {
    if (action === "regenerate-all" && !window.confirm("确定重新生成全部缩略图吗？现有缩略图会被替换。")) return;
    setBusy(action);
    setMessage("");
    try {
      const res = await fetch(apiPath("/api/thumbnails/manage"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "操作失败");
      setMessage(`已生成 ${data.generated ?? 0} 个缩略图`);
      await loadStats();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusy("");
    }
  };

  const resetSearchCache = async () => {
    setBusy("search");
    setMessage("");
    try {
      const res = await fetch(apiPath("/api/cache"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear-search" }),
      });
      if (!res.ok) throw new Error("重置搜索缓存失败");
      setMessage("搜索缓存已重置");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="mt-6">
      <div className="mb-3 flex items-center gap-2">
        <Image className="h-4 w-4 text-accent" />
        <h2 className="text-sm font-semibold text-foreground">缩略图与搜索缓存</h2>
      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="grid grid-cols-3 gap-3 border-b border-border pb-4 text-sm">
          <div><div className="text-xs text-muted">作品总数</div><div className="mt-1 font-semibold text-foreground">{stats?.total ?? "-"}</div></div>
          <div><div className="text-xs text-muted">已缓存</div><div className="mt-1 font-semibold text-emerald-500">{stats?.existing ?? "-"}</div></div>
          <div><div className="text-xs text-muted">缺失</div><div className="mt-1 font-semibold text-amber-500">{stats?.missing ?? "-"}</div></div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" disabled={Boolean(busy)} onClick={() => runThumbnailAction("generate-missing")} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-accent/10 px-3 text-sm font-medium text-accent hover:bg-accent/20 disabled:opacity-50">
            {busy === "generate-missing" ? <Loader2 className="h-4 w-4 animate-spin" /> : <WandSparkles className="h-4 w-4" />}
            生成缺失缩略图
          </button>
          <button type="button" disabled={Boolean(busy)} onClick={() => runThumbnailAction("regenerate-all")} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm text-muted hover:bg-card-hover hover:text-foreground disabled:opacity-50">
            {busy === "regenerate-all" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            重新生成全部
          </button>
          <button type="button" disabled={Boolean(busy)} onClick={resetSearchCache} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm text-muted hover:bg-card-hover hover:text-foreground disabled:opacity-50">
            {busy === "search" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            重置搜索缓存
          </button>
        </div>
        {message && <p className="mt-3 flex items-center gap-2 text-xs text-muted"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />{message}</p>}
      </div>
    </section>
  );
}
