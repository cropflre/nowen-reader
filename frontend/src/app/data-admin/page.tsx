"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  HardDrive,
  Database,
  RefreshCw,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Settings as SettingsIcon,
  Activity,
} from "lucide-react";
import {
  fetchStorageOverview,
  clearCacheBucket,
  dbCheckpoint,
  dbAnalyze,
  dbVacuum,
  dbIntegrityCheck,
  updateStorageThreshold,
  humanBytes,
  formatTimestamp,
  type StorageOverview,
  type CacheBucket,
  type StorageThreshold,
} from "@/api/admin";

// ============================================================
// 子组件
// ============================================================

/** 概览卡片 */
function OverviewCard({
  label,
  value,
  sub,
  tone = "default",
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "warn" | "danger" | "ok";
  icon?: React.ReactNode;
}) {
  const tones: Record<string, string> = {
    default: "border-border bg-card",
    warn: "border-amber-500/40 bg-amber-500/5",
    danger: "border-red-500/40 bg-red-500/5",
    ok: "border-emerald-500/40 bg-emerald-500/5",
  };
  return (
    <div className={`rounded-lg border p-4 ${tones[tone]}`}>
      <div className="flex items-center justify-between text-xs text-muted">
        <span>{label}</span>
        {icon}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
      {sub ? <div className="mt-1 text-xs text-muted">{sub}</div> : null}
    </div>
  );
}

/** 占用条 */
function UsageBar({ value, max, color = "bg-blue-500" }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded bg-muted/20">
      <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ============================================================
// 主页面
// ============================================================

export default function DataAdminPage() {
  const router = useRouter();

  const [data, setData] = useState<StorageOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string>(""); // 当前执行中的操作 key
  const [toast, setToast] = useState<{ tone: "ok" | "err"; msg: string } | null>(null);

  // 高级清理参数
  const [olderThanDays, setOlderThanDays] = useState<number>(0);
  const [largerThanMB, setLargerThanMB] = useState<number>(0);
  const [orphanOnly, setOrphanOnly] = useState(false);

  // 阈值（本地草稿，保存时提交）
  const [threshold, setThreshold] = useState<StorageThreshold>({
    cacheMaxMB: 0,
    dbMaxMB: 0,
    diskFreeMinMB: 0,
  });
  const [thresholdDirty, setThresholdDirty] = useState(false);

  const showToast = (tone: "ok" | "err", msg: string) => {
    setToast({ tone, msg });
    setTimeout(() => setToast(null), 3500);
  };

  const refresh = useCallback(
    async (fresh = false) => {
      try {
        if (!data) setLoading(true);
        const res = await fetchStorageOverview(fresh);
        setData(res);
        setError(null);
        if (res.threshold) {
          setThreshold(res.threshold);
        }
      } catch (e: any) {
        setError(e?.message || "加载失败");
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  useEffect(() => {
    refresh(false);
  }, [refresh]);

  // 派生指标
  const cacheUsedMB = (data?.cache.totalBytes ?? 0) / (1024 * 1024);
  const dbUsedMB = (data?.database.totalBytes ?? 0) / (1024 * 1024);
  const diskFreeMB = (data?.disk.freeBytes ?? 0) / (1024 * 1024);

  const warnings = data?.warnings ?? [];

  const cacheTone: "default" | "warn" | "danger" =
    threshold.cacheMaxMB && cacheUsedMB > threshold.cacheMaxMB
      ? "danger"
      : threshold.cacheMaxMB && cacheUsedMB > threshold.cacheMaxMB * 0.8
        ? "warn"
        : "default";

  const dbTone: "default" | "warn" | "danger" =
    threshold.dbMaxMB && dbUsedMB > threshold.dbMaxMB
      ? "danger"
      : threshold.dbMaxMB && dbUsedMB > threshold.dbMaxMB * 0.8
        ? "warn"
        : "default";

  const diskTone: "default" | "warn" | "danger" =
    threshold.diskFreeMinMB && data?.disk.available && diskFreeMB < threshold.diskFreeMinMB
      ? "danger"
      : threshold.diskFreeMinMB && data?.disk.available && diskFreeMB < threshold.diskFreeMinMB * 1.2
        ? "warn"
        : "default";

  // 缓存清理
  const onClearBucket = async (b: CacheBucket | "all") => {
    const target = b === "all" ? "all" : (b.key as any);
    const confirmText =
      b === "all"
        ? `确定要清理所有缓存（缩略图 + 阅读页 + 转换缓存）吗？将释放约 ${humanBytes(data?.cache.totalBytes ?? 0)}`
        : `确定要清理「${(b as CacheBucket).label}」吗？将释放约 ${humanBytes((b as CacheBucket).sizeBytes)}`;
    if (!window.confirm(confirmText)) return;

    setBusy(`clear-${target}`);
    try {
      const r = await clearCacheBucket({
        target,
        olderThanDays: olderThanDays > 0 ? olderThanDays : undefined,
        largerThanMB: largerThanMB > 0 ? largerThanMB : undefined,
        orphanOnly: orphanOnly || undefined,
      });
      showToast("ok", `已删除 ${r.deleted} 个文件，释放 ${humanBytes(r.freedBytes)}`);
      await refresh(true);
    } catch (e: any) {
      showToast("err", e?.message || "清理失败");
    } finally {
      setBusy("");
    }
  };

  // DB 操作
  const onDbAction = async (
    action: "checkpoint" | "analyze" | "vacuum" | "integrity"
  ) => {
    if (action === "vacuum") {
      if (
        !window.confirm(
          "VACUUM 会重建数据库以回收空间，期间禁止写入。\n执行时间取决于数据库大小，确定继续？"
        )
      )
        return;
    }
    setBusy(`db-${action}`);
    try {
      let resultText = "";
      switch (action) {
        case "checkpoint": {
          const r = await dbCheckpoint();
          resultText = `WAL Checkpoint 完成（${r.durationMs} ms）`;
          break;
        }
        case "analyze": {
          const r = await dbAnalyze();
          resultText = `ANALYZE 完成（${r.durationMs} ms）`;
          break;
        }
        case "vacuum": {
          const r = await dbVacuum();
          resultText = `VACUUM 完成，释放 ${humanBytes(r.freedBytes ?? 0)}（${r.durationMs} ms）`;
          break;
        }
        case "integrity": {
          const r = await dbIntegrityCheck();
          resultText = r.ok
            ? `完整性检查通过（${r.durationMs} ms）`
            : `检查到问题：${r.messages.join("；")}`;
          if (!r.ok) {
            showToast("err", resultText);
            setBusy("");
            return;
          }
          break;
        }
      }
      showToast("ok", resultText);
      await refresh(true);
    } catch (e: any) {
      showToast("err", e?.message || "操作失败");
    } finally {
      setBusy("");
    }
  };

  // 阈值保存
  const onSaveThreshold = async () => {
    setBusy("threshold");
    try {
      await updateStorageThreshold({
        cacheMaxMB: Number(threshold.cacheMaxMB) || 0,
        dbMaxMB: Number(threshold.dbMaxMB) || 0,
        diskFreeMinMB: Number(threshold.diskFreeMinMB) || 0,
      });
      setThresholdDirty(false);
      showToast("ok", "阈值已保存");
      await refresh(true);
    } catch (e: any) {
      showToast("err", e?.message || "保存失败");
    } finally {
      setBusy("");
    }
  };

  const sortedTables = useMemo(
    () => [...(data?.database.tables ?? [])].sort((a, b) => b.rowCount - a.rowCount),
    [data]
  );

  // ============================================================
  // Render
  // ============================================================

  return (
    <div className="min-h-screen bg-background pb-16">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-md px-4 py-2 text-sm shadow-lg ${
            toast.tone === "ok"
              ? "bg-emerald-600 text-white"
              : "bg-red-600 text-white"
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* 顶栏 */}
      <div className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <button
            onClick={() => router.back()}
            className="rounded p-1.5 text-muted hover:bg-card-hover hover:text-foreground"
            aria-label="back"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <HardDrive className="h-5 w-5 text-blue-400" />
          <h1 className="text-base font-semibold">数据管理</h1>
          <span className="ml-2 rounded bg-muted/15 px-2 py-0.5 text-[11px] text-muted">
            管理员
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => refresh(true)}
              disabled={loading}
              className="flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-xs text-muted hover:bg-card-hover hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              刷新
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-5">
        {error && (
          <div className="mb-4 rounded border border-red-500/40 bg-red-500/5 p-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* 预警条 */}
        {warnings.length > 0 && (
          <div className="mb-4 rounded border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            <div className="mb-1 flex items-center gap-2 font-medium text-amber-400">
              <AlertTriangle className="h-4 w-4" />
              存储用量预警
            </div>
            <ul className="ml-6 list-disc space-y-0.5 text-amber-300/90">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        {/* 概览卡片 */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <OverviewCard
            label="缓存占用"
            value={humanBytes(data?.cache.totalBytes ?? 0)}
            sub={`${data?.cache.fileCount ?? 0} 个文件`}
            tone={cacheTone}
            icon={<HardDrive className="h-4 w-4 text-muted" />}
          />
          <OverviewCard
            label="数据库"
            value={humanBytes(data?.database.totalBytes ?? 0)}
            sub={
              data
                ? `主库 ${humanBytes(data.database.mainBytes)} + WAL ${humanBytes(
                    data.database.walBytes
                  )}`
                : ""
            }
            tone={dbTone}
            icon={<Database className="h-4 w-4 text-muted" />}
          />
          <OverviewCard
            label="磁盘剩余"
            value={data?.disk.available ? humanBytes(data.disk.freeBytes) : "未知"}
            sub={
              data?.disk.available
                ? `共 ${humanBytes(data.disk.totalBytes)}，已用 ${data.disk.usedPercent}%`
                : "当前平台暂不支持"
            }
            tone={diskTone}
            icon={<Activity className="h-4 w-4 text-muted" />}
          />
          <OverviewCard
            label="预警"
            value={warnings.length > 0 ? `${warnings.length} 项` : "正常"}
            sub={data ? `更新于 ${formatTimestamp(data.generatedAt)}` : ""}
            tone={warnings.length > 0 ? "warn" : "ok"}
            icon={
              warnings.length > 0 ? (
                <AlertTriangle className="h-4 w-4 text-amber-400" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              )
            }
          />
        </div>

        {/* 缓存管理 */}
        <section className="mt-6 rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-blue-400" />
              <h2 className="text-sm font-semibold">缓存管理</h2>
              <span className="ml-2 text-xs text-muted">
                数据目录：<code className="rounded bg-muted/15 px-1">{data?.dataDir ?? "—"}</code>
              </span>
            </div>
          </div>

          <div className="divide-y divide-border">
            {(data?.cache.buckets ?? []).map((b) => (
              <div key={b.key} className="grid grid-cols-12 items-center gap-3 px-4 py-3 text-sm">
                <div className="col-span-12 sm:col-span-3">
                  <div className="font-medium">{b.label}</div>
                  <div className="truncate text-[11px] text-muted">{b.path}</div>
                </div>
                <div className="col-span-4 sm:col-span-2 tabular-nums">
                  {humanBytes(b.sizeBytes)}
                </div>
                <div className="col-span-4 sm:col-span-2 text-xs text-muted tabular-nums">
                  {b.fileCount} 文件
                  {b.dirCount > 0 ? ` · ${b.dirCount} 目录` : ""}
                </div>
                <div className="col-span-4 sm:col-span-3 text-xs text-muted">
                  {b.newestAt ? `最近 ${formatTimestamp(b.newestAt)}` : "（空）"}
                </div>
                <div className="col-span-12 sm:col-span-2 sm:text-right">
                  <button
                    disabled={!b.exists || b.fileCount === 0 || busy.startsWith("clear-")}
                    onClick={() => onClearBucket(b)}
                    className="inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1 text-xs text-muted hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40 disabled:hover:border-border disabled:hover:bg-transparent disabled:hover:text-muted"
                  >
                    {busy === `clear-${b.key}` ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Trash2 className="h-3 w-3" />
                    )}
                    清理
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* 高级清理 */}
          <div className="border-t border-border px-4 py-3">
            <div className="mb-2 text-xs font-medium text-muted">高级清理（应用于上方所有清理按钮）</div>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <label className="flex items-center gap-1.5">
                <span className="text-muted">早于</span>
                <input
                  type="number"
                  min={0}
                  value={olderThanDays}
                  onChange={(e) => setOlderThanDays(parseInt(e.target.value || "0", 10))}
                  className="w-16 rounded border border-border bg-background px-2 py-1 text-right tabular-nums"
                />
                <span className="text-muted">天</span>
              </label>
              <label className="flex items-center gap-1.5">
                <span className="text-muted">大于</span>
                <input
                  type="number"
                  min={0}
                  value={largerThanMB}
                  onChange={(e) => setLargerThanMB(parseInt(e.target.value || "0", 10))}
                  className="w-16 rounded border border-border bg-background px-2 py-1 text-right tabular-nums"
                />
                <span className="text-muted">MB</span>
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={orphanOnly}
                  onChange={(e) => setOrphanOnly(e.target.checked)}
                />
                <span>仅清理孤儿（数据库中不存在的）</span>
              </label>
              <button
                onClick={() => onClearBucket("all")}
                disabled={busy.startsWith("clear-")}
                className="ml-auto inline-flex items-center gap-1.5 rounded border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/20 disabled:opacity-50"
              >
                {busy === "clear-all" ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Trash2 className="h-3 w-3" />
                )}
                一键清理全部
              </button>
            </div>
          </div>
        </section>

        {/* 数据库管理 */}
        <section className="mt-6 rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-purple-400" />
              <h2 className="text-sm font-semibold">数据库管理</h2>
              {data && (
                <span className="ml-2 text-xs text-muted">
                  {data.database.journalMode?.toUpperCase()} · 可回收 ~
                  {data.database.reclaimableMB.toFixed(2)} MB
                </span>
              )}
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="flex flex-wrap gap-2 border-b border-border px-4 py-3">
            <button
              onClick={() => onDbAction("checkpoint")}
              disabled={!!busy}
              className="inline-flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-xs hover:bg-card-hover disabled:opacity-50"
            >
              {busy === "db-checkpoint" ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              WAL Checkpoint
            </button>
            <button
              onClick={() => onDbAction("analyze")}
              disabled={!!busy}
              className="inline-flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-xs hover:bg-card-hover disabled:opacity-50"
            >
              {busy === "db-analyze" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Activity className="h-3 w-3" />}
              ANALYZE（优化查询）
            </button>
            <button
              onClick={() => onDbAction("integrity")}
              disabled={!!busy}
              className="inline-flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-xs hover:bg-card-hover disabled:opacity-50"
            >
              {busy === "db-integrity" ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
              完整性检查
            </button>
            <button
              onClick={() => onDbAction("vacuum")}
              disabled={!!busy}
              className="ml-auto inline-flex items-center gap-1.5 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-400 hover:bg-amber-500/20 disabled:opacity-50"
              title="VACUUM 会重建数据库并锁定写入，请在闲时执行"
            >
              {busy === "db-vacuum" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
              VACUUM（耗时）
            </button>
          </div>

          {/* 表统计 */}
          <div className="px-4 py-3">
            <div className="mb-2 text-xs text-muted">各表行数与估算占用</div>
            <div className="overflow-hidden rounded border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/10 text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2 text-left font-normal">表名</th>
                    <th className="px-3 py-2 text-right font-normal">行数</th>
                    <th className="px-3 py-2 text-right font-normal">估算占用</th>
                    <th className="px-3 py-2 text-left font-normal">占比</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedTables.map((t) => {
                    const total = data?.database.mainBytes ?? 1;
                    return (
                      <tr key={t.name} className="border-t border-border">
                        <td className="px-3 py-2 font-mono text-xs">{t.name}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {t.rowCount.toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted">
                          {humanBytes(t.sizeBytes)}
                        </td>
                        <td className="px-3 py-2">
                          <UsageBar value={t.sizeBytes} max={total} color="bg-purple-500" />
                        </td>
                      </tr>
                    );
                  })}
                  {sortedTables.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-6 text-center text-sm text-muted">
                        暂无数据
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* 阈值设置 */}
        <section className="mt-6 rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <SettingsIcon className="h-4 w-4 text-emerald-400" />
              <h2 className="text-sm font-semibold">预警阈值</h2>
              <span className="ml-2 text-xs text-muted">
                超过阈值时在概览中红色提示，0 表示不启用
              </span>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 px-4 py-4 sm:grid-cols-3">
            <ThresholdField
              label="缓存上限 (MB)"
              value={threshold.cacheMaxMB ?? 0}
              onChange={(v) => {
                setThreshold((t) => ({ ...t, cacheMaxMB: v }));
                setThresholdDirty(true);
              }}
              hint={`当前 ${humanBytes(data?.cache.totalBytes ?? 0)}`}
            />
            <ThresholdField
              label="数据库上限 (MB)"
              value={threshold.dbMaxMB ?? 0}
              onChange={(v) => {
                setThreshold((t) => ({ ...t, dbMaxMB: v }));
                setThresholdDirty(true);
              }}
              hint={`当前 ${humanBytes(data?.database.totalBytes ?? 0)}`}
            />
            <ThresholdField
              label="磁盘剩余下限 (MB)"
              value={threshold.diskFreeMinMB ?? 0}
              onChange={(v) => {
                setThreshold((t) => ({ ...t, diskFreeMinMB: v }));
                setThresholdDirty(true);
              }}
              hint={
                data?.disk.available
                  ? `当前剩余 ${humanBytes(data.disk.freeBytes)}`
                  : "当前平台不支持磁盘检测"
              }
            />
          </div>
          <div className="border-t border-border px-4 py-3 text-right">
            <button
              onClick={onSaveThreshold}
              disabled={!thresholdDirty || busy === "threshold"}
              className="inline-flex items-center gap-1.5 rounded bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {busy === "threshold" ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              保存阈值
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

// ============================================================
// 阈值输入框
// ============================================================
function ThresholdField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  hint?: string;
}) {
  return (
    <label className="block text-sm">
      <div className="mb-1 text-xs text-muted">{label}</div>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value || "0", 10))}
        className="w-full rounded border border-border bg-background px-3 py-1.5 tabular-nums focus:border-emerald-500/60 focus:outline-none"
      />
      {hint ? <div className="mt-1 text-[11px] text-muted">{hint}</div> : null}
    </label>
  );
}
