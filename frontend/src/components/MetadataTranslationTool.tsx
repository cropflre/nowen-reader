"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Languages, X } from "lucide-react";
import { apiPath } from "@/lib/base-path";

interface TranslationEngine {
  id: string;
  name: string;
  available: boolean;
  speed: string;
}

interface TranslationProgress {
  type: string;
  index?: number;
  total?: number;
  percent?: number;
  title?: string;
  success?: number;
  failed?: number;
  skipped?: number;
}

export default function MetadataTranslationTool({ onComplete }: { onComplete?: () => void }) {
  const [open, setOpen] = useState(false);
  const [engines, setEngines] = useState<TranslationEngine[]>([]);
  const [engine, setEngine] = useState("");
  const [targetLang, setTargetLang] = useState("zh-CN");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<TranslationProgress | null>(null);
  const [done, setDone] = useState<TranslationProgress | null>(null);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open || engines.length > 0) return;
    fetch(apiPath("/api/translate/engines"))
      .then((res) => res.json())
      .then((data) => setEngines((data.engines || []).filter((item: TranslationEngine) => item.available)))
      .catch(() => setEngines([]));
  }, [engines.length, open]);

  const start = async () => {
    setRunning(true);
    setProgress(null);
    setDone(null);
    setError("");
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      const res = await fetch(apiPath("/api/metadata/translate-batch"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetLang, engine: engine || undefined }),
        signal: abort.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reader = res.body?.getReader();
      if (!reader) throw new Error("服务端未返回进度流");
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";
        for (const event of events) {
          if (!event.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(event.slice(6)) as TranslationProgress;
            if (data.type === "done") setDone(data);
            else setProgress(data);
          } catch {
            // Ignore malformed keep-alive events without interrupting the task.
          }
        }
      }
      onComplete?.();
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError(err instanceof Error ? err.message : "翻译失败");
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const close = () => {
    if (running) return;
    setOpen(false);
    setProgress(null);
    setDone(null);
    setError("");
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-medium text-muted hover:bg-card-hover hover:text-foreground">
        <Languages className="h-4 w-4" />
        <span className="hidden md:inline">批量翻译</span>
      </button>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="metadata-translation-title">
          <div className="w-full max-w-md rounded-lg border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h2 id="metadata-translation-title" className="text-base font-semibold text-foreground">批量翻译元数据</h2>
                <p className="mt-1 text-xs text-muted">翻译标题、简介、类型和合集名称。</p>
              </div>
              <button type="button" onClick={close} disabled={running} aria-label="关闭" className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-card-hover hover:text-foreground disabled:opacity-40"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-4 p-5">
              <label className="block text-sm text-foreground">目标语言<select value={targetLang} onChange={(event) => setTargetLang(event.target.value)} disabled={running} className="mt-2 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-accent"><option value="zh-CN">中文</option><option value="en">English</option></select></label>
              <label className="block text-sm text-foreground">翻译引擎<select value={engine} onChange={(event) => setEngine(event.target.value)} disabled={running} className="mt-2 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-accent"><option value="">自动选择最优引擎</option>{engines.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>

              {running && (
                <div className="rounded-lg border border-border bg-background p-4">
                  <div className="h-2 overflow-hidden rounded-full bg-border"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progress?.percent || 0}%` }} /></div>
                  <div className="mt-2 flex justify-between gap-3 text-xs text-muted"><span className="truncate">{progress?.title || "准备翻译..."}</span><span className="shrink-0">{progress?.percent || 0}%</span></div>
                </div>
              )}
              {done && <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-500"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /><span>翻译完成：成功 {done.success || 0}，失败 {done.failed || 0}，跳过 {done.skipped || 0}</span></div>}
              {error && <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-500">{error}</div>}
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
              {running ? (
                <button type="button" onClick={() => abortRef.current?.abort()} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-red-500/30 px-4 text-sm text-red-500 hover:bg-red-500/10"><X className="h-4 w-4" />取消任务</button>
              ) : (
                <>
                  <button type="button" onClick={close} className="min-h-10 rounded-lg px-4 text-sm text-muted hover:bg-card-hover hover:text-foreground">关闭</button>
                  <button type="button" onClick={start} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white hover:bg-accent/90"><Languages className="h-4 w-4" />开始翻译</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
