"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Sparkles,
  FolderTree,
  Filter,
  Loader2,
  Check,
  AlertTriangle,
  Play,
  Eye,
  RefreshCw,
  History,
  Info,
  Activity,
  RotateCcw,
} from "lucide-react";

// ============================================================
// 扫描规则面板（A1：AI 智能识别 + 虚拟归类，不动磁盘）
// ============================================================

type ApplyOn = "newOnly" | "all" | "manual";
type Confidence = "low" | "medium" | "high";
type AIScope = "file" | "folderGroup";

interface AIInferRule {
  enabled: boolean;
  scope: AIScope;
  minConfidence: Confidence;
  applyToComic: boolean;
  applyToGroup: boolean;
  overwriteTitle: boolean;
  fallbackToRule: boolean;
}

interface OrganizeRule {
  enabled: boolean;
  autoGroupByDir: boolean;
  inheritMeta: boolean;
}

interface ScanRuleFilters {
  includeExt?: string[];
  excludeExt?: string[];
  includePathRegex?: string;
  excludePathRegex?: string;
}

interface ScanRulesConfig {
  enabled: boolean;
  applyOn: ApplyOn;
  concurrency: number;
  aiInfer: AIInferRule;
  organize: OrganizeRule;
  filters: ScanRuleFilters;
}

interface OpLog {
  id: number;
  batchId: string;
  comicId?: string;
  groupId?: number;
  action: string;
  status: string;
  fromValue?: string;
  toValue?: string;
  message?: string;
  createdAt: string;
}

interface RunResult {
  batchId: string;
  total: number;
  inferred: number;
  groupedNew: number;
  skipped: number;
  failed: number;
  dryRun: boolean;
  durationMs: number;
}

interface Progress {
  running: boolean;
  batchId?: string;
  stage: string;
  stageLabel?: string;
  current: number;
  total: number;
  inferred: number;
  groupedNew: number;
  skipped: number;
  failed: number;
  dryRun: boolean;
  currentDir?: string;
  startedAt?: number;
  updatedAt?: number;
  finishedAt?: number;
  manual: boolean;
  error?: string;
}

const STAGE_MAP: Record<string, { label: string; pct?: number }> = {
  collecting: { label: "收集目标文件", pct: 5 },
  filtering: { label: "应用过滤器", pct: 10 },
  ai_infer: { label: "AI 智能识别" },
  organize: { label: "虚拟归类", pct: 95 },
  done: { label: "已完成", pct: 100 },
};

const DEFAULTS: ScanRulesConfig = {
  enabled: false,
  applyOn: "newOnly",
  concurrency: 2,
  aiInfer: {
    enabled: false,
    scope: "folderGroup",
    minConfidence: "medium",
    applyToComic: true,
    applyToGroup: true,
    overwriteTitle: false,
    fallbackToRule: true,
  },
  organize: {
    enabled: false,
    autoGroupByDir: true,
    inheritMeta: true,
  },
  filters: {},
};

export function ScanRulesPanel() {
  const [rules, setRules] = useState<ScanRulesConfig>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);
  const [lastResult, setLastResult] = useState<RunResult | null>(null);
  const [logs, setLogs] = useState<OpLog[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 还原标题交互状态
  const [restoring, setRestoring] = useState(false);
  const [restoreMenuOpen, setRestoreMenuOpen] = useState(false);
  const [restorePreview, setRestorePreview] = useState<{
    total: number;
    samples: Array<{ id: string; oldTitle: string; newTitle: string; filename: string }>;
    mode: "duplicates" | "ai-rules";
  } | null>(null);

  const fetchRules = useCallback(async () => {
    try {
      const res = await fetch("/api/scan-rules", { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data?.rules) setRules({ ...DEFAULTS, ...data.rules });
      setRunning(!!data?.running);
    } catch (e) {
      setMessage({ type: "error", text: `加载失败: ${(e as Error).message}` });
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchLogs = useCallback(async (batchId?: string) => {
    try {
      const url = batchId
        ? `/api/scan-rules/logs?batchId=${encodeURIComponent(batchId)}&limit=200`
        : `/api/scan-rules/logs?limit=100`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      setLogs(data?.logs || []);
    } catch {
      /* ignore */
    }
  }, []);

  // 轮询进度（1s/次），执行中或手动启动后才轮询。
  const fetchProgress = useCallback(async () => {
    try {
      const res = await fetch("/api/scan-rules/progress", { credentials: "include" });
      if (!res.ok) return null;
      const p = (await res.json()) as Progress;
      setProgress(p);
      if (!p.running) {
        // 已结束：停止轮询 + 刷新运行状态 + 拉取该批次日志
        setRunning(false);
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        if (p.batchId) fetchLogs(p.batchId);
      }
      return p;
    } catch {
      return null;
    }
  }, [fetchLogs]);

  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    // 立即拉一次，随后 1s/次
    fetchProgress();
    pollRef.current = setInterval(fetchProgress, 1000);
  }, [fetchProgress]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  useEffect(() => {
    fetchRules();
    // 页面加载时检查一次进度：若后台正有任务在跑（例如扫描自动触发了 AI 识别），自动开启轮询。
    fetchProgress().then((p) => {
      if (p?.running) {
        setRunning(true);
        startPolling();
      }
    });
  }, [fetchRules, fetchProgress, startPolling]);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/scan-rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(rules),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data?.rules) setRules({ ...DEFAULTS, ...data.rules });
      setMessage({ type: "success", text: "已保存" });
      setTimeout(() => setMessage(null), 2000);
    } catch (e) {
      setMessage({ type: "error", text: `保存失败: ${(e as Error).message}` });
    } finally {
      setSaving(false);
    }
  };

  const runEngine = async (dryRun: boolean, scope?: ApplyOn) => {
    setRunning(true);
    setMessage(null);
    setLastResult(null);
    // 先启动轮询，让进度条立刻展示
    startPolling();
    try {
      const url = dryRun ? "/api/scan-rules/preview" : "/api/scan-rules/apply";
      const body: Record<string, unknown> = {};
      if (scope) body.scope = scope;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data?.result) {
        setLastResult(data.result as RunResult);
        await fetchLogs(data.result.batchId);
        await fetchProgress();
        setShowLogs(true);
        setMessage({
          type: "success",
          text: dryRun
            ? `预览完成（共 ${data.result.total} 项；处理 ${data.result.inferred + data.result.groupedNew} 项）`
            : `执行完成（识别 ${data.result.inferred}，新建分组 ${data.result.groupedNew}，失败 ${data.result.failed}）`,
        });
      }
    } catch (e) {
      setMessage({ type: "error", text: `执行失败: ${(e as Error).message}` });
    } finally {
      // 轮询会检测 running=false 后自动停止并都同步状态。
      // 此处不直接 setRunning(false)，有助于避免类似“后台还在跑”的误判。
      // 但同步 RunScanRules 返回后，progress.running 必为 false，上面 fetchProgress 会送走 spinner。
    }
  };

  // 紧急还原：把被 AI 错误覆盖的 Title 重新基于 Filename 派生。
  // 第一步：dryRun=true 拿预览。
  // mode: 'duplicates' = 只处理"同标题被多本共用"的污染数据（默认，更安全）
  //       'ai-rules'   = 重建所有"扫描期统一规则"产生的标题（metadataSource=ai_scan_rules）
  const restoreTitlesPreview = async (mode: "duplicates" | "ai-rules") => {
    setRestoring(true);
    setMessage(null);
    try {
      const payload =
        mode === "duplicates"
          ? { dryRun: true, onlyDuplicates: true }
          : { dryRun: true, onlyDuplicates: false, metadataSources: ["ai_scan_rules"] };
      const res = await fetch("/api/scan-rules/restore-titles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const r = data?.result || {};
      setRestorePreview({
        total: Number(r.total || 0),
        samples: Array.isArray(r.samples) ? r.samples : [],
        mode,
      });
      if (!r.total) {
        setMessage({ type: "info", text: "未检测到需要还原的污染标题" });
        setRestorePreview(null);
      }
    } catch (e) {
      setMessage({ type: "error", text: `预览失败: ${(e as Error).message}` });
    } finally {
      setRestoring(false);
    }
  };

  // 第二步：用户在弹窗里确认后真正写库。
  const restoreTitlesConfirm = async () => {
    if (!restorePreview) return;
    const mode = restorePreview.mode;
    setRestoring(true);
    setMessage(null);
    try {
      const payload =
        mode === "duplicates"
          ? { dryRun: false, onlyDuplicates: true }
          : { dryRun: false, onlyDuplicates: false, metadataSources: ["ai_scan_rules"] };
      const res = await fetch("/api/scan-rules/restore-titles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const r = data?.result || {};
      setMessage({
        type: "success",
        text: `已还原 ${r.restored || 0} 本（共检测 ${r.total || 0}，跳过 ${r.skipped || 0}）`,
      });
      setRestorePreview(null);
    } catch (e) {
      setMessage({ type: "error", text: `还原失败: ${(e as Error).message}` });
    } finally {
      setRestoring(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-32 animate-pulse rounded-2xl bg-card" />
        <div className="h-32 animate-pulse rounded-2xl bg-card" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 顶部说明卡片 */}
      <div className="rounded-2xl border border-border/40 bg-gradient-to-br from-accent/5 via-card to-card p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/15 text-accent shrink-0">
            <Sparkles className="h-6 w-6" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-foreground">扫描期统一规则</h2>
            <p className="mt-1 text-sm text-muted leading-relaxed">
              在文库扫描入库后，自动按统一规则执行：AI 智能识别 + 虚拟归类。
              <br />
              <span className="text-accent/80 font-medium">
                安全提示：当前阶段不会修改任何磁盘文件，仅在数据库层面工作。
              </span>
            </p>
          </div>
        </div>
      </div>

      {/* 进度条：仅在有进度数据时展示 */}
      {progress && (progress.running || progress.stage === "done") && (
        <ProgressCard progress={progress} />
      )}

      {/* 全局开关 */}
      <SectionCard title="总开关" icon={<Check className="h-4 w-4" />}>
        <Toggle
          label="启用扫描规则"
          desc="关闭后所有动作均不会执行"
          checked={rules.enabled}
          onChange={(v) => setRules({ ...rules, enabled: v })}
        />
        <FieldRow label="触发时机">
          <select
            className="w-full sm:w-auto rounded-lg border border-border/50 bg-card px-3 py-1.5 text-sm"
            value={rules.applyOn}
            onChange={(e) => setRules({ ...rules, applyOn: e.target.value as ApplyOn })}
          >
            <option value="newOnly">仅新增文件（推荐）</option>
            <option value="all">全库</option>
            <option value="manual">仅手动触发</option>
          </select>
        </FieldRow>
      </SectionCard>

      {/* AI 智能识别 */}
      <SectionCard title="AI 智能识别" icon={<Sparkles className="h-4 w-4" />}>
        <Toggle
          label="启用"
          desc="结合父目录与同伴文件名样本，让 AI 推断作品名 / 作者 / 扫图组 / 版本 / 状态等"
          checked={rules.aiInfer.enabled}
          onChange={(v) => setRules({ ...rules, aiInfer: { ...rules.aiInfer, enabled: v } })}
        />
        <FieldRow label="识别范围">
          <select
            className="w-full sm:w-auto rounded-lg border border-border/50 bg-card px-3 py-1.5 text-sm"
            value={rules.aiInfer.scope}
            onChange={(e) => setRules({ ...rules, aiInfer: { ...rules.aiInfer, scope: e.target.value as AIScope } })}
          >
            <option value="folderGroup">按目录去重（每目录调用一次，省 token）</option>
            <option value="file">每个文件独立调用</option>
          </select>
        </FieldRow>
        <FieldRow label="最低置信度">
          <select
            className="w-full sm:w-auto rounded-lg border border-border/50 bg-card px-3 py-1.5 text-sm"
            value={rules.aiInfer.minConfidence}
            onChange={(e) => setRules({ ...rules, aiInfer: { ...rules.aiInfer, minConfidence: e.target.value as Confidence } })}
          >
            <option value="low">低（最宽松）</option>
            <option value="medium">中（推荐）</option>
            <option value="high">高（最严格）</option>
          </select>
        </FieldRow>
        <Toggle
          label="写回单卷字段"
          desc="把推断的标题/作者等写到 Comic 表"
          checked={rules.aiInfer.applyToComic}
          onChange={(v) => setRules({ ...rules, aiInfer: { ...rules.aiInfer, applyToComic: v } })}
        />
        <Toggle
          label="同步到所属分组"
          desc="把作品名/作者等同步写到 ComicGroup 表"
          checked={rules.aiInfer.applyToGroup}
          onChange={(v) => setRules({ ...rules, aiInfer: { ...rules.aiInfer, applyToGroup: v } })}
        />
        <Toggle
          label="覆盖已有标题"
          desc="默认仅在标题为空时填充；开启后会强制覆盖"
          checked={rules.aiInfer.overwriteTitle}
          onChange={(v) => setRules({ ...rules, aiInfer: { ...rules.aiInfer, overwriteTitle: v } })}
        />
      </SectionCard>

      {/* 虚拟归类 */}
      <SectionCard title="虚拟归类（自动分组）" icon={<FolderTree className="h-4 w-4" />}>
        <Toggle
          label="启用"
          desc="扫描后按目录结构自动创建/合并 ComicGroup（不会移动磁盘文件）"
          checked={rules.organize.enabled}
          onChange={(v) => setRules({ ...rules, organize: { ...rules.organize, enabled: v } })}
        />
        <Toggle
          label="按文件夹自动分组"
          desc="同目录文件归为同一分组，多级目录智能命名"
          checked={rules.organize.autoGroupByDir}
          onChange={(v) => setRules({ ...rules, organize: { ...rules.organize, autoGroupByDir: v } })}
        />
        <Toggle
          label="从首卷继承元数据"
          desc="新创建分组时把首卷的作者/封面等同步到分组"
          checked={rules.organize.inheritMeta}
          onChange={(v) => setRules({ ...rules, organize: { ...rules.organize, inheritMeta: v } })}
        />
      </SectionCard>

      {/* 过滤器 */}
      <SectionCard title="过滤器" icon={<Filter className="h-4 w-4" />}>
        <FieldRow label="包含扩展名（逗号分隔）">
          <input
            type="text"
            placeholder="例: .cbz,.zip,.pdf"
            value={(rules.filters.includeExt || []).join(",")}
            onChange={(e) =>
              setRules({
                ...rules,
                filters: {
                  ...rules.filters,
                  includeExt: parseList(e.target.value),
                },
              })
            }
            className="w-full rounded-lg border border-border/50 bg-card px-3 py-1.5 text-sm"
          />
        </FieldRow>
        <FieldRow label="排除扩展名">
          <input
            type="text"
            placeholder="例: .epub,.txt"
            value={(rules.filters.excludeExt || []).join(",")}
            onChange={(e) =>
              setRules({
                ...rules,
                filters: {
                  ...rules.filters,
                  excludeExt: parseList(e.target.value),
                },
              })
            }
            className="w-full rounded-lg border border-border/50 bg-card px-3 py-1.5 text-sm"
          />
        </FieldRow>
        <FieldRow label="路径包含正则">
          <input
            type="text"
            value={rules.filters.includePathRegex || ""}
            onChange={(e) =>
              setRules({ ...rules, filters: { ...rules.filters, includePathRegex: e.target.value } })
            }
            className="w-full rounded-lg border border-border/50 bg-card px-3 py-1.5 text-sm font-mono"
          />
        </FieldRow>
        <FieldRow label="路径排除正则">
          <input
            type="text"
            value={rules.filters.excludePathRegex || ""}
            onChange={(e) =>
              setRules({ ...rules, filters: { ...rules.filters, excludePathRegex: e.target.value } })
            }
            className="w-full rounded-lg border border-border/50 bg-card px-3 py-1.5 text-sm font-mono"
          />
        </FieldRow>
      </SectionCard>

      {/* 操作栏 */}
      <div className="sticky bottom-0 -mx-4 sm:mx-0 px-4 sm:px-0 pb-4 sm:pb-0 bg-background/80 backdrop-blur-xl">
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border/40 bg-card p-3">
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm shadow-accent/25 hover:opacity-90 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            保存
          </button>
          <button
            onClick={() => runEngine(true)}
            disabled={running}
            title="试运行：仅生成日志，不真正写库"
            className="flex items-center gap-2 rounded-lg border border-border/50 px-4 py-2 text-sm font-medium hover:bg-card-hover disabled:opacity-50"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
            预览（试运行）
          </button>
          <button
            onClick={() => runEngine(false, "newOnly")}
            disabled={running || !rules.enabled}
            className="flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/5 px-4 py-2 text-sm font-medium text-accent hover:bg-accent/10 disabled:opacity-50"
          >
            <Play className="h-4 w-4" />
            执行（仅新增）
          </button>
          <button
            onClick={() => runEngine(false, "all")}
            disabled={running || !rules.enabled}
            title="对全库重新应用规则（耗时较长）"
            className="flex items-center gap-2 rounded-lg border border-border/50 px-4 py-2 text-sm font-medium hover:bg-card-hover disabled:opacity-50"
          >
            <RefreshCw className="h-4 w-4" />
            执行（全库）
          </button>
          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <button
                onClick={() => setRestoreMenuOpen(!restoreMenuOpen)}
                disabled={restoring || running}
                title="基于文件名重新派生标题（修复被 AI 错洗的标题）"
                className="flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/5 px-3 py-2 text-xs font-medium text-red-500 hover:bg-red-500/10 disabled:opacity-50"
              >
                {restoring ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="h-3.5 w-3.5" />
                )}
                还原标题
              </button>
              {restoreMenuOpen && !restoring && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setRestoreMenuOpen(false)}
                  />
                  <div className="absolute right-0 bottom-full mb-2 w-72 rounded-lg border border-border/40 bg-card shadow-lg z-50 overflow-hidden">
                    <button
                      onClick={() => {
                        setRestoreMenuOpen(false);
                        restoreTitlesPreview("duplicates");
                      }}
                      className="w-full px-3 py-2.5 text-left text-xs hover:bg-card-hover border-b border-border/20"
                    >
                      <div className="font-medium text-foreground">仅重复标题（安全）</div>
                      <div className="text-muted mt-0.5">只处理同标题被多本共用的污染数据</div>
                    </button>
                    <button
                      onClick={() => {
                        setRestoreMenuOpen(false);
                        restoreTitlesPreview("ai-rules");
                      }}
                      className="w-full px-3 py-2.5 text-left text-xs hover:bg-card-hover"
                    >
                      <div className="font-medium text-red-500">全部 AI 规则数据（推荐）</div>
                      <div className="text-muted mt-0.5">
                        重建所有 metadataSource=ai_scan_rules 的标题
                      </div>
                    </button>
                  </div>
                </>
              )}
            </div>
            <button
              onClick={() => {
                fetchLogs();
                setShowLogs(true);
              }}
              className="flex items-center gap-2 rounded-lg border border-border/50 px-3 py-2 text-xs text-muted hover:text-foreground hover:bg-card-hover"
            >
              <History className="h-3.5 w-3.5" />
              查看日志
            </button>
          </div>
        </div>
      </div>

      {/* 状态消息 */}
      {message && (
        <div
          className={`flex items-start gap-3 rounded-xl border p-3 text-sm ${
            message.type === "error"
              ? "border-rose-400/30 bg-rose-400/5 text-rose-300"
              : message.type === "info"
              ? "border-sky-400/30 bg-sky-400/5 text-sky-300"
              : "border-emerald-400/30 bg-emerald-400/5 text-emerald-300"
          }`}
        >
          {message.type === "error" ? (
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          ) : (
            <Check className="h-4 w-4 shrink-0 mt-0.5" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {/* 上次执行结果 */}
      {lastResult && (
        <div className="rounded-2xl border border-border/40 bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Info className="h-4 w-4 text-accent" />
            <h3 className="text-sm font-semibold text-foreground">
              {lastResult.dryRun ? "预览结果" : "执行结果"}
              <span className="ml-2 text-xs text-muted font-normal">
                批次 {lastResult.batchId.slice(0, 16)}...
              </span>
            </h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
            <Stat label="目标总数" value={lastResult.total} />
            <Stat label="AI 识别" value={lastResult.inferred} accent />
            <Stat label="新建分组" value={lastResult.groupedNew} accent />
            <Stat label="跳过" value={lastResult.skipped} dim />
            <Stat label="失败" value={lastResult.failed} error />
          </div>
          <p className="mt-3 text-xs text-muted">用时 {lastResult.durationMs} ms</p>
        </div>
      )}

      {/* 还原标题预览弹窗 */}
      {restorePreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => setRestorePreview(null)}
        >
          <div
            className="w-full max-w-2xl max-h-[80vh] overflow-hidden rounded-2xl border border-border/40 bg-card shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-border/30 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-500/10 text-red-500 shrink-0">
                <RotateCcw className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-semibold text-foreground">
                  还原标题预览（共 {restorePreview.total} 本待还原）
                </h3>
                <p className="text-xs text-muted mt-0.5">
                  以下为前 {restorePreview.samples.length} 条 old → new 示例。仅处理"同一标题被多本共用"的污染数据。
                </p>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-border/20 text-xs">
              {restorePreview.samples.length === 0 && (
                <div className="p-5 text-center text-muted">无样本</div>
              )}
              {restorePreview.samples.map((s) => (
                <div key={s.id} className="px-5 py-2.5">
                  <div className="text-muted truncate" title={s.filename}>
                    {s.filename}
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="line-through text-red-500/80 truncate" title={s.oldTitle}>
                      {s.oldTitle || "(空)"}
                    </span>
                    <span className="text-muted">→</span>
                    <span className="text-emerald-500 font-medium truncate" title={s.newTitle}>
                      {s.newTitle}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="px-5 py-3 border-t border-border/30 flex items-center justify-end gap-2">
              <button
                onClick={() => setRestorePreview(null)}
                className="rounded-lg border border-border/50 px-4 py-2 text-sm font-medium hover:bg-card-hover"
              >
                取消
              </button>
              <button
                onClick={restoreTitlesConfirm}
                disabled={restoring || restorePreview.total === 0}
                className="flex items-center gap-2 rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50"
              >
                {restoring ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                确认还原 {restorePreview.total} 本
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 操作日志 */}
      {showLogs && (
        <div className="rounded-2xl border border-border/40 bg-card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <History className="h-4 w-4" />
              操作日志（最近 {logs.length} 条）
            </h3>
            <button
              onClick={() => setShowLogs(false)}
              className="text-xs text-muted hover:text-foreground"
            >
              收起
            </button>
          </div>
          <div className="max-h-[400px] overflow-y-auto divide-y divide-border/20">
            {logs.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-muted">暂无日志</div>
            )}
            {logs.map((l) => (
              <div key={l.id} className="px-4 py-2.5 hover:bg-card-hover/50 text-xs">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`rounded px-1.5 py-0.5 font-medium ${statusClass(l.status)}`}>
                    {l.status}
                  </span>
                  <span className="text-foreground font-medium">{l.action}</span>
                  {l.comicId && (
                    <span className="text-muted/70 font-mono truncate max-w-[200px]">
                      {l.comicId.slice(0, 12)}…
                    </span>
                  )}
                  <span className="text-muted/50 ml-auto">
                    {new Date(l.createdAt).toLocaleString()}
                  </span>
                </div>
                {l.message && <div className="text-muted mt-0.5 line-clamp-2">{l.message}</div>}
                {l.toValue && (
                  <div className="text-muted/70 mt-0.5 font-mono text-[10px] truncate">
                    → {l.toValue}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── 子组件 ── */
function SectionCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border/40 bg-card overflow-hidden">
      <div className="px-5 py-3 border-b border-border/30 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent/10 text-accent">
          {icon}
        </span>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      <div className="p-4 space-y-3">{children}</div>
    </div>
  );
}

function Toggle({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-4 cursor-pointer py-1">
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {desc && <div className="text-xs text-muted/70 mt-0.5">{desc}</div>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
          checked ? "bg-accent" : "bg-card-hover border border-border/50"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </label>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 py-1">
      <span className="text-sm text-muted">{label}</span>
      <div className="sm:max-w-[60%]">{children}</div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  dim,
  error,
}: {
  label: string;
  value: number;
  accent?: boolean;
  dim?: boolean;
  error?: boolean;
}) {
  const color = error
    ? "text-rose-300"
    : accent
    ? "text-accent"
    : dim
    ? "text-muted"
    : "text-foreground";
  return (
    <div className="rounded-xl bg-background/40 border border-border/30 py-2">
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      <div className="text-[10px] text-muted/70 mt-0.5">{label}</div>
    </div>
  );
}

function statusClass(status: string): string {
  switch (status) {
    case "success":
      return "bg-emerald-400/10 text-emerald-300";
    case "failed":
      return "bg-rose-400/10 text-rose-300";
    case "skipped":
      return "bg-amber-400/10 text-amber-300";
    case "dryRun":
      return "bg-sky-400/10 text-sky-300";
    default:
      return "bg-muted/10 text-muted";
  }
}

function parseList(v: string): string[] {
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/* 进度卡片 */
function ProgressCard({ progress }: { progress: Progress }) {
  const stage = STAGE_MAP[progress.stage] || { label: progress.stageLabel || progress.stage };
  // 计算百分比：AI 阶段按 current/total，其他阶段用映射表
  let pct = 0;
  if (progress.stage === "done") {
    pct = 100;
  } else if (progress.stage === "ai_infer" && progress.total > 0) {
    // AI 阶段占总进度 10% ~ 90%
    pct = 10 + Math.floor((progress.current / progress.total) * 80);
  } else if (stage.pct !== undefined) {
    pct = stage.pct;
  }
  if (pct < 0) pct = 0;
  if (pct > 100) pct = 100;

  const isDone = !progress.running && progress.stage === "done";
  const elapsedMs =
    progress.startedAt && progress.updatedAt
      ? (progress.finishedAt || progress.updatedAt) - progress.startedAt
      : 0;
  const elapsedText =
    elapsedMs > 60000
      ? `${Math.floor(elapsedMs / 60000)}分${Math.floor((elapsedMs % 60000) / 1000)}秒`
      : `${Math.max(0, Math.floor(elapsedMs / 1000))}秒`;

  return (
    <div
      className={`rounded-2xl border p-4 sm:p-5 ${
        isDone
          ? "border-emerald-400/30 bg-emerald-400/5"
          : progress.error
          ? "border-rose-400/30 bg-rose-400/5"
          : "border-accent/30 bg-accent/5"
      }`}
    >
      <div className="flex items-center gap-3 mb-3">
        {progress.running ? (
          <Loader2 className="h-5 w-5 animate-spin text-accent shrink-0" />
        ) : isDone ? (
          <Check className="h-5 w-5 text-emerald-300 shrink-0" />
        ) : (
          <Activity className="h-5 w-5 text-accent shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-sm font-semibold text-foreground">
              {isDone ? "本轮已完成" : `正在执行 · ${stage.label}`}
            </span>
            {progress.dryRun && (
              <span className="rounded bg-sky-400/10 text-sky-300 px-1.5 py-0.5 text-[10px] font-medium">
                预览模式
              </span>
            )}
            {!progress.manual && (
              <span className="rounded bg-amber-400/10 text-amber-300 px-1.5 py-0.5 text-[10px] font-medium">
                扫描自动触发
              </span>
            )}
          </div>
          {progress.currentDir && progress.running && (
            <div className="text-xs text-muted truncate mt-0.5">
              处理中：<span className="font-mono text-foreground/80">{progress.currentDir}</span>
            </div>
          )}
        </div>
        <span className="text-sm font-bold text-foreground tabular-nums">{pct}%</span>
      </div>

      {/* 进度条 */}
      <div className="h-2 rounded-full bg-background/60 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            isDone ? "bg-emerald-400" : progress.error ? "bg-rose-400" : "bg-accent"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* 统计 */}
      <div className="mt-3 grid grid-cols-3 sm:grid-cols-5 gap-2 text-center text-xs">
        <MiniStat label="总项" value={progress.total} />
        <MiniStat label="已处理" value={progress.current} accent />
        <MiniStat label="AI 识别" value={progress.inferred} accent />
        <MiniStat label="跳过" value={progress.skipped} dim />
        <MiniStat label="失败" value={progress.failed} error />
      </div>

      <div className="mt-2 text-[11px] text-muted/70 flex items-center gap-3">
        {progress.batchId && <span className="font-mono">{progress.batchId.slice(0, 16)}…</span>}
        <span>耗时 {elapsedText}</span>
        {progress.error && <span className="text-rose-300">· {progress.error}</span>}
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  accent,
  dim,
  error,
}: {
  label: string;
  value: number;
  accent?: boolean;
  dim?: boolean;
  error?: boolean;
}) {
  const color = error
    ? "text-rose-300"
    : accent
    ? "text-accent"
    : dim
    ? "text-muted"
    : "text-foreground";
  return (
    <div className="rounded-lg bg-background/40 border border-border/30 py-1.5">
      <div className={`text-base font-bold tabular-nums ${color}`}>{value}</div>
      <div className="text-[10px] text-muted/70 mt-0.5">{label}</div>
    </div>
  );
}
