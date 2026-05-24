"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Database,
  HardDrive,
  AlertTriangle,
  RefreshCw,
  Trash2,
  Settings as SettingsIcon,
  Loader2,
  CheckCircle2,
  XCircle,
  TrendingUp,
} from "lucide-react";
import {
  adminAPI,
  humanBytes,
  type CacheBucket,
  type DBStat,
  type StorageOverview,
  type StorageSample,
  type StorageThreshold,
} from "@/api/admin";

// ============================================================
// 主组件
// ============================================================

export function DataAdminPanel() {
  const [overview, setOverview] = useState<StorageOverview | null>(null);
  const [history, setHistory] = useState<StorageSample[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; msg: string } | null>(
    null
  );

  const showToast = useCallback((kind: "ok" | "err", msg: string) => {
    setToast({ kind, msg });
    window.setTimeout(() => setToast(null), 3000);
  }, []);

  const load = useCallback(
    async (fast = false) => {
      try {
        setRefreshing(true);
        setError(null);
        const [ov, hi] = await Promise.all([
          adminAPI.getOverview(fast),
          adminAPI.getHistory(30).catch(() => ({ samples: [], days: 30 })),
        ]);
        setOverview(ov);
        setHistory(hi.samples);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    []
  );

  useEffect(() => {
    load(true); // 首屏用 fast 模式秒开
  }, [load]);

  const handleAction = useCallback(
    async (key: string, fn: () => Promise<unknown>, successMsg: string) => {
      try {
        setBusyAction(key);
        await fn();
        showToast("ok", successMsg);
        await load(false);
      } catch (e: unknown) {
        showToast("err", e instanceof Error ? e.message : String(e));
      } finally {
        setBusyAction(null);
      }
    },
    [load, showToast]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted">
        <Loader2 className="h-6 w-6 animate-spin mr-2" />
        加载存储统计中...
      </div>
    );
  }

  if (error || !overview) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-500">
        加载失败：{error || "未知错误"}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 顶栏 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HardDrive className="h-5 w-5 text-accent" />
          <h2 className="text-base font-semibold">数据管理</h2>
        </div>
        <button
          onClick={() => load(false)}
          disabled={refreshing}
          className="flex items-center gap-1.5 rounded-lg bg-background px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          刷新
        </button>
      </div>

      {/* 告警 */}
      {overview.warnings.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-1">
          {overview.warnings.map((w, i) => (
            <div key={i} className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      {/* 概览卡片 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <OverviewCard
          icon={<HardDrive className="h-4 w-4" />}
          label="缓存总大小"
          value={humanBytes(overview.cacheTotal)}
          sub={`${overview.cache.buckets.reduce((s, b) => s + b.fileCount, 0)} 文件`}
        />
        <OverviewCard
          icon={<Database className="h-4 w-4" />}
          label="数据库"
          value={humanBytes(overview.database.totalBytes)}
          sub={`${overview.database.tables.length} 表 · ${overview.database.tables
            .reduce((s, t) => s + t.rowCount, 0)
            .toLocaleString()} 行`}
        />
        <OverviewCard
          icon={<HardDrive className="h-4 w-4" />}
          label="磁盘剩余"
          value={overview.disk.available ? humanBytes(overview.disk.freeBytes) : "—"}
          sub={
            overview.disk.available
              ? `共 ${humanBytes(overview.disk.totalBytes)}`
              : overview.disk.error || "不可用"
          }
        />
        <OverviewCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label="告警数"
          value={String(overview.warnings.length)}
          sub={overview.warnings.length === 0 ? "全部正常" : "请查看上方"}
          accent={overview.warnings.length > 0}
        />
      </div>

      {/* 趋势图 */}
      <Section title="使用趋势（最近 30 天）" icon={<TrendingUp className="h-4 w-4" />}>
        <TrendChart samples={history} />
      </Section>

      {/* 缓存管理 */}
      <Section title="缓存管理" icon={<HardDrive className="h-4 w-4" />}>
        <CacheManagementSection
          cache={overview.cache.buckets}
          busyAction={busyAction}
          onAction={handleAction}
        />
      </Section>

      {/* 数据库管理 */}
      <Section title="数据库管理" icon={<Database className="h-4 w-4" />}>
        <DatabaseManagementSection
          db={overview.database}
          busyAction={busyAction}
          onAction={handleAction}
        />
      </Section>

      {/* 阈值 */}
      <Section title="预警阈值" icon={<SettingsIcon className="h-4 w-4" />}>
        <ThresholdSection
          initial={overview.threshold}
          onSaved={() => load(false)}
          showToast={showToast}
        />
      </Section>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg px-4 py-2 text-sm shadow-lg ${
            toast.kind === "ok"
              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30"
              : "bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30"
          }`}
        >
          {toast.kind === "ok" ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <XCircle className="h-4 w-4" />
          )}
          <span>{toast.msg}</span>
        </div>
      )}
    </div>
  );
}

// ============================================================
// 子组件：概览卡片
// ============================================================

function OverviewCard({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-3 ${
        accent
          ? "border-amber-500/30 bg-amber-500/5"
          : "border-border/40 bg-background"
      }`}
    >
      <div className="flex items-center gap-1.5 text-xs text-muted mb-1">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-lg font-semibold text-foreground">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

// ============================================================
// 子组件：分区容器
// ============================================================

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {icon}
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      <div className="rounded-xl border border-border/40 bg-background p-3 sm:p-4">
        {children}
      </div>
    </div>
  );
}

// ============================================================
// 子组件：趋势图（纯 SVG，无第三方库）
// ============================================================

function TrendChart({ samples }: { samples: StorageSample[] }) {
  type SeriesKey = "cacheBytes" | "dbBytes" | "diskFree";
  const [active, setActive] = useState<SeriesKey>("cacheBytes");

  const data = useMemo(
    () => samples.slice().sort((a, b) => a.ts - b.ts),
    [samples]
  );

  if (data.length < 2) {
    return (
      <div className="text-xs text-muted py-6 text-center">
        采样数据不足，请稍后再试（系统每小时采样一次）
      </div>
    );
  }

  const values = data.map((s) => s[active]);
  const max = Math.max(...values, 1);
  const min = 0;
  const W = 600;
  const H = 120;
  const pad = 4;

  const x = (i: number) => pad + (i / (data.length - 1)) * (W - pad * 2);
  const y = (v: number) =>
    H - pad - ((v - min) / (max - min || 1)) * (H - pad * 2);

  const path =
    "M " +
    data.map((d, i) => `${x(i).toFixed(1)} ${y(d[active]).toFixed(1)}`).join(" L ");

  const areaPath =
    `M ${x(0)} ${H - pad} L ` +
    data
      .map((d, i) => `${x(i).toFixed(1)} ${y(d[active]).toFixed(1)}`)
      .join(" L ") +
    ` L ${x(data.length - 1)} ${H - pad} Z`;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {(
          [
            { k: "cacheBytes", label: "缓存", color: "text-blue-500" },
            { k: "dbBytes", label: "数据库", color: "text-emerald-500" },
            { k: "diskFree", label: "磁盘剩余", color: "text-amber-500" },
          ] as const
        ).map((it) => (
          <button
            key={it.k}
            onClick={() => setActive(it.k)}
            className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
              active === it.k
                ? "bg-accent/15 text-accent"
                : "bg-card-hover text-muted hover:text-foreground"
            }`}
          >
            {it.label}
          </button>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-28">
        <defs>
          <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.3" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g className="text-accent">
          <path d={areaPath} fill="url(#trendGrad)" />
          <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" />
        </g>
      </svg>
      <div className="flex justify-between text-[11px] text-muted">
        <span>{new Date(data[0].ts * 1000).toLocaleDateString()}</span>
        <span>当前 {humanBytes(data[data.length - 1][active])}</span>
        <span>{new Date(data[data.length - 1].ts * 1000).toLocaleDateString()}</span>
      </div>
    </div>
  );
}

// ============================================================
// 子组件：缓存管理
// ============================================================

function CacheManagementSection({
  cache,
  busyAction,
  onAction,
}: {
  cache: CacheBucket[];
  busyAction: string | null;
  onAction: (
    key: string,
    fn: () => Promise<unknown>,
    successMsg: string
  ) => Promise<void>;
}) {
  const [olderDays, setOlderDays] = useState(30);
  const [largerMB, setLargerMB] = useState(100);

  return (
    <div className="space-y-3">
      {/* 各桶明细 */}
      <div className="divide-y divide-border/40">
        {cache.map((b) => (
          <div
            key={b.key}
            className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">{b.label}</span>
                <span className="rounded bg-card-hover px-1.5 py-0.5 text-[10px] text-muted">
                  {b.key}
                </span>
              </div>
              <div className="text-[11px] text-muted truncate" title={b.path}>
                {b.path}
              </div>
              <div className="mt-1 text-xs text-muted">
                {humanBytes(b.sizeBytes)} · {b.fileCount} 文件
                {b.dirCount > 0 && ` · ${b.dirCount} 目录`}
                {b.newestAt > 0 && (
                  <>
                    {" · "}
                    最新{" "}
                    {new Date(b.newestAt * 1000).toLocaleDateString()}
                  </>
                )}
              </div>
            </div>
            <button
              disabled={busyAction !== null || !b.exists || b.fileCount === 0}
              onClick={() => {
                if (
                  !window.confirm(
                    `确认清空 "${b.label}"？将删除 ${b.fileCount} 个文件 (${humanBytes(
                      b.sizeBytes
                    )})。此操作不可撤销。`
                  )
                )
                  return;
                onAction(
                  `bucket-${b.key}`,
                  () =>
                    adminAPI.clearCache({
                      action: "clear-bucket",
                      buckets: [b.key],
                      includeSubdir: true,
                    }),
                  `已清理 ${b.label}`
                );
              }}
              className="flex items-center gap-1 rounded-md bg-red-500/10 px-2.5 py-1 text-xs text-red-500 transition-colors hover:bg-red-500/20 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {busyAction === `bucket-${b.key}` ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="h-3 w-3" />
              )}
              清理
            </button>
          </div>
        ))}
      </div>

      {/* 高级清理 */}
      <div className="grid gap-2 pt-2 border-t border-border/40 sm:grid-cols-2">
        <div className="flex items-center gap-2 rounded-lg bg-card-hover/50 p-2">
          <span className="text-xs text-muted">清理</span>
          <input
            type="number"
            min={1}
            max={365}
            value={olderDays}
            onChange={(e) => setOlderDays(Number(e.target.value) || 30)}
            className="w-16 rounded border border-border/40 bg-background px-2 py-0.5 text-xs"
          />
          <span className="text-xs text-muted">天前的文件</span>
          <button
            disabled={busyAction !== null}
            onClick={() =>
              onAction(
                "older",
                () =>
                  adminAPI.clearCache({
                    action: "clear-older-than",
                    days: olderDays,
                  }),
                `已清理 ${olderDays} 天前的缓存`
              )
            }
            className="ml-auto rounded-md bg-accent/15 px-2 py-1 text-xs text-accent transition-colors hover:bg-accent/25 disabled:opacity-50"
          >
            执行
          </button>
        </div>

        <div className="flex items-center gap-2 rounded-lg bg-card-hover/50 p-2">
          <span className="text-xs text-muted">清理大于</span>
          <input
            type="number"
            min={1}
            value={largerMB}
            onChange={(e) => setLargerMB(Number(e.target.value) || 100)}
            className="w-16 rounded border border-border/40 bg-background px-2 py-0.5 text-xs"
          />
          <span className="text-xs text-muted">MB 的文件</span>
          <button
            disabled={busyAction !== null}
            onClick={() =>
              onAction(
                "larger",
                () =>
                  adminAPI.clearCache({
                    action: "clear-larger-than",
                    minSizeMB: largerMB,
                  }),
                `已清理大于 ${largerMB}MB 的缓存`
              )
            }
            className="ml-auto rounded-md bg-accent/15 px-2 py-1 text-xs text-accent transition-colors hover:bg-accent/25 disabled:opacity-50"
          >
            执行
          </button>
        </div>

        <button
          disabled={busyAction !== null}
          onClick={() =>
            onAction(
              "orphan",
              () => adminAPI.clearCache({ action: "clear-orphan" }),
              "已清理孤儿缓存"
            )
          }
          className="rounded-lg bg-card-hover/50 p-2 text-xs text-foreground transition-colors hover:bg-card-hover disabled:opacity-50 sm:col-span-1"
        >
          🧹 清理孤儿缓存（数据库已删除的漫画）
        </button>

        <button
          disabled={busyAction !== null}
          onClick={() => {
            if (!window.confirm("确认清空全部缓存？此操作不可撤销。")) return;
            onAction(
              "all",
              () =>
                adminAPI.clearCache({
                  action: "clear-bucket",
                  buckets: ["thumbnails", "pages", "converted"],
                  includeSubdir: true,
                }),
              "已清空全部缓存"
            );
          }}
          className="rounded-lg bg-red-500/10 p-2 text-xs text-red-500 transition-colors hover:bg-red-500/20 disabled:opacity-50 sm:col-span-1"
        >
          ⚠️ 一键清空全部缓存
        </button>
      </div>
    </div>
  );
}

// ============================================================
// 子组件：数据库管理
// ============================================================

function DatabaseManagementSection({
  db,
  busyAction,
  onAction,
}: {
  db: DBStat;
  busyAction: string | null;
  onAction: (
    key: string,
    fn: () => Promise<unknown>,
    successMsg: string
  ) => Promise<void>;
}) {
  const tables = useMemo(
    () => db.tables.slice().sort((a, b) => b.bytesEst - a.bytesEst),
    [db.tables]
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <DBStatItem label="主库" value={humanBytes(db.mainBytes)} />
        <DBStatItem
          label="WAL"
          value={humanBytes(db.walBytes)}
          accent={db.walBytes > 50 * 1024 * 1024}
        />
        <DBStatItem label="SHM" value={humanBytes(db.shmBytes)} />
        <DBStatItem
          label="可回收"
          value={humanBytes(db.wastedBytes)}
          accent={db.wastedBytes > 10 * 1024 * 1024}
        />
      </div>

      {/* 表占用 */}
      <div className="rounded-lg border border-border/40 overflow-hidden">
        <div className="bg-card-hover/50 px-3 py-1.5 text-[11px] text-muted flex">
          <span className="flex-1">表名</span>
          <span className="w-24 text-right">行数</span>
          <span className="w-24 text-right">
            占用{db.hasDbStat ? "" : "（估）"}
          </span>
        </div>
        <div className="max-h-60 overflow-y-auto">
          {tables.map((t) => (
            <div
              key={t.name}
              className="flex items-center px-3 py-1.5 text-xs border-t border-border/30 first:border-t-0"
            >
              <span className="flex-1 font-mono text-foreground truncate">
                {t.name}
              </span>
              <span className="w-24 text-right text-muted">
                {t.rowCount.toLocaleString()}
              </span>
              <span className="w-24 text-right text-muted">
                {humanBytes(t.bytesEst)}
              </span>
            </div>
          ))}
          {tables.length === 0 && (
            <div className="text-xs text-muted text-center py-3">无数据</div>
          )}
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <DBOpButton
          busy={busyAction === "checkpoint"}
          disabled={busyAction !== null}
          onClick={() =>
            onAction(
              "checkpoint",
              async () => {
                const r = await adminAPI.checkpointDB();
                return r;
              },
              "WAL Checkpoint 完成"
            )
          }
        >
          WAL Checkpoint
        </DBOpButton>
        <DBOpButton
          busy={busyAction === "analyze"}
          disabled={busyAction !== null}
          onClick={() =>
            onAction("analyze", () => adminAPI.analyzeDB(), "ANALYZE 完成")
          }
        >
          ANALYZE
        </DBOpButton>
        <DBOpButton
          busy={busyAction === "vacuum"}
          disabled={busyAction !== null}
          danger
          onClick={() => {
            if (
              !window.confirm(
                "VACUUM 会重建整个数据库并暂时阻塞写入，建议在低峰期执行。是否继续？"
              )
            )
              return;
            onAction(
              "vacuum",
              async () => {
                const r = await adminAPI.vacuumDB();
                return r;
              },
              "VACUUM 完成，已释放空间"
            );
          }}
        >
          VACUUM（慢）
        </DBOpButton>
        <DBOpButton
          busy={busyAction === "integrity"}
          disabled={busyAction !== null}
          onClick={() =>
            onAction(
              "integrity",
              async () => {
                const r = await adminAPI.integrityCheckDB();
                if (!r.ok)
                  throw new Error("完整性检查未通过：" + r.details.join(";"));
                return r;
              },
              "完整性检查通过"
            )
          }
        >
          完整性检查
        </DBOpButton>
      </div>

      <button
        disabled={busyAction !== null}
        onClick={() =>
          onAction("reindex", () => adminAPI.reindexDB(), "索引已重建")
        }
        className="w-full rounded-lg bg-card-hover/50 p-2 text-xs text-foreground transition-colors hover:bg-card-hover disabled:opacity-50"
      >
        🔧 REINDEX（重建索引）
      </button>
    </div>
  );
}

function DBStatItem({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-md px-2.5 py-1.5 ${
        accent
          ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
          : "bg-card-hover/50 text-foreground"
      }`}
    >
      <div className="text-[10px] text-muted">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}

function DBOpButton({
  children,
  busy,
  disabled,
  danger,
  onClick,
}: {
  children: React.ReactNode;
  busy?: boolean;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
        danger
          ? "bg-red-500/10 text-red-500 hover:bg-red-500/20"
          : "bg-accent/10 text-accent hover:bg-accent/20"
      }`}
    >
      {busy && <Loader2 className="h-3 w-3 animate-spin" />}
      {children}
    </button>
  );
}

// ============================================================
// 子组件：阈值
// ============================================================

function ThresholdSection({
  initial,
  onSaved,
  showToast,
}: {
  initial: StorageThreshold;
  onSaved: () => void;
  showToast: (kind: "ok" | "err", msg: string) => void;
}) {
  const [t, setT] = useState<StorageThreshold>(initial);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    try {
      setSaving(true);
      await adminAPI.updateThreshold(t);
      showToast("ok", "已保存阈值");
      onSaved();
    } catch (e: unknown) {
      showToast("err", e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <ThresholdField
          label="缓存上限"
          unit="MB"
          value={t.cacheMaxMB}
          onChange={(v) => setT({ ...t, cacheMaxMB: v })}
          hint="缓存超过此值时显示告警"
        />
        <ThresholdField
          label="数据库上限"
          unit="MB"
          value={t.dbMaxMB}
          onChange={(v) => setT({ ...t, dbMaxMB: v })}
          hint="数据库超过此值时显示告警"
        />
        <ThresholdField
          label="磁盘剩余下限"
          unit="MB"
          value={t.diskFreeMinMB}
          onChange={(v) => setT({ ...t, diskFreeMinMB: v })}
          hint="磁盘剩余低于此值时告警"
        />
      </div>
      <div className="flex items-center justify-end gap-2">
        <span className="text-[11px] text-muted">填 0 表示不启用对应阈值</span>
        <button
          disabled={saving}
          onClick={save}
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "保存中..." : "保存"}
        </button>
      </div>
    </div>
  );
}

function ThresholdField({
  label,
  unit,
  value,
  hint,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  hint?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <div className="text-xs text-muted mb-1">{label}</div>
      <div className="flex rounded-lg border border-border/40 bg-background overflow-hidden">
        <input
          type="number"
          min={0}
          value={value}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
          className="flex-1 bg-transparent px-2 py-1.5 text-sm outline-none"
        />
        <span className="px-2 py-1.5 text-xs text-muted bg-card-hover/30 border-l border-border/40">
          {unit}
        </span>
      </div>
      {hint && <div className="mt-0.5 text-[10px] text-muted">{hint}</div>}
    </label>
  );
}
