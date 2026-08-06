"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  RefreshCw,
  Search,
  Filter,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Shield,
  Wrench,
  Eye,
  ChevronDown,
  ChevronUp,
  X,
} from "lucide-react";
import {
  fetchSummary,
  fetchIssues,
  fetchFixPreview,
  executeFix,
  triggerPageCountRescan,
  type DataQASummary,
  type DataQAIssue,
  type DataQAFixPreviewResult,
  type DataQAFixResult,
  type DataQAFixResultItem,
  type DataQASkip,
} from "@/api/dataQa";
import { useTranslation } from "@/lib/i18n";
import AppShell from "@/components/AppShell";
import { PageContent, PageHeader } from "@/components/PageHeader";

// ============================================================
// Issue type display name map
// ============================================================

function useIssueTypeLabel(issueType: string): string {
  const t = useTranslation();
  const map: Record<string, string | undefined> = {
    PAGE_COUNT_ZERO: t.dataQa?.pageCountZero,
    PAGE_COUNT_NEGATIVE: t.dataQa?.pageCountNegative,
    SESSION_ORPHAN: t.dataQa?.sessionOrphan,
    SESSION_ZERO_DURATION: t.dataQa?.sessionZeroDuration,
    TOTAL_TIME_ZERO: t.dataQa?.totalTimeZero,
    UCS_TOTAL_TIME_ZERO: t.dataQa?.ucsTotalTimeZero,
    ORPHAN_TAG: t.dataQa?.orphanTag,
    ORPHAN_CATEGORY: t.dataQa?.orphanCategory,
  };
  return map[issueType] ?? issueType;
}

// ============================================================
// Severity helpers
// ============================================================

const severityColor: Record<string, string> = {
  p1: "text-red-500 bg-red-500/10 border-red-500/20",
  p2: "text-amber-500 bg-amber-500/10 border-amber-500/20",
  p3: "text-sky-500 bg-sky-500/10 border-sky-500/20",
};

function SeverityBadge({ level }: { level: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${severityColor[level] ?? "text-muted bg-muted/10 border-muted/20"}`}
    >
      {level.toUpperCase()}
    </span>
  );
}

// ============================================================
// Summary cards
// ============================================================

function SummaryCards({ summary }: { summary: DataQASummary }) {
  const t = useTranslation();
  const items = [
    { label: t.dataQa?.totalIssues ?? "Total Issues", value: summary.totalIssues, tone: summary.totalIssues > 0 ? "text-foreground" : "text-emerald-500" },
    { label: t.dataQa?.p1Label ?? "P1", value: summary.p1, tone: summary.p1 > 0 ? "text-red-500" : "text-muted" },
    { label: t.dataQa?.p2Label ?? "P2", value: summary.p2, tone: summary.p2 > 0 ? "text-amber-500" : "text-muted" },
    { label: t.dataQa?.p3Label ?? "P3", value: summary.p3, tone: summary.p3 > 0 ? "text-sky-500" : "text-muted" },
    { label: t.dataQa?.autoFixable ?? "Auto-fixable", value: summary.autoFixable, tone: "text-foreground" },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {items.map((item) => (
        <div key={item.label} className="surface-card rounded-xl p-4">
          <div className="text-xs text-muted">{item.label}</div>
          <div className={`mt-1 text-2xl font-semibold tracking-tight ${item.tone}`}>
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Main page
// ============================================================

export default function DataQAPage() {
  const t = useTranslation();
  const [summary, setSummary] = useState<DataQASummary | null>(null);
  const [issues, setIssues] = useState<DataQAIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [filterType, setFilterType] = useState<string>("");
  const [filterSeverity, setFilterSeverity] = useState<string>("");
  const [filterAutoFixable, setFilterAutoFixable] = useState<string>("");
  const [searchText, setSearchText] = useState("");
  const [showFilters, setShowFilters] = useState(true);

  // Action state
  const [previewResult, setPreviewResult] = useState<DataQAFixPreviewResult | null>(null);
  const [fixResult, setFixResult] = useState<DataQAFixResult | null>(null);
  const [rescanResult, setRescanResult] = useState<{ queued: number; message: string } | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState(false);
  const [toast, setToast] = useState<{ msg: string; tone: "ok" | "err" } | null>(null);

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, d] = await Promise.all([fetchSummary(), fetchIssues()]);
      setSummary(s);
      setIssues(d.issues ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : (t.dataQa?.failedToLoad ?? "Failed to load"));
    } finally {
      setLoading(false);
    }
  }, [t.dataQa?.failedToLoad]);

  useEffect(() => {
    load();
  }, [load]);

  // Unique issue types for filter dropdown
  const issueTypes = useMemo(() => {
    const s = new Set(issues.map((i) => i.issueType));
    return Array.from(s).sort();
  }, [issues]);

  // Filtered issues
  const filtered = useMemo(() => {
    return issues.filter((i) => {
      if (filterType && i.issueType !== filterType) return false;
      if (filterSeverity && i.severity !== filterSeverity) return false;
      if (filterAutoFixable === "yes" && !i.autoFixable) return false;
      if (filterAutoFixable === "no" && i.autoFixable) return false;
      if (searchText) {
        const q = searchText.toLowerCase();
        if (
          !i.issueType.toLowerCase().includes(q) &&
          !i.entityType.toLowerCase().includes(q) &&
          !i.entityId.toLowerCase().includes(q) &&
          !(i.title ?? "").toLowerCase().includes(q) &&
          !(i.message ?? "").toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [issues, filterType, filterSeverity, filterAutoFixable, searchText]);

  // Actions
  const handleDryRun = async () => {
    setActionLoading("preview");
    setPreviewResult(null);
    try {
      const types = filterType ? [filterType] : [];
      const result = await fetchFixPreview({ issueTypes: types, issueIds: [], fixAll: !filterType });
      setPreviewResult(result);
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Preview failed", tone: "err" });
    } finally {
      setActionLoading(null);
    }
  };

  const handleExecuteFix = async () => {
    setConfirmDialog(false);
    setActionLoading("fix");
    setFixResult(null);
    try {
      const types = filterType ? [filterType] : [];
      const result = await executeFix({ issueTypes: types, issueIds: [], fixAll: !filterType, confirm: true });
      setFixResult(result);
      await load();
      setToast({ msg: `Fix executed: ${result.totalExecuted} succeeded, ${result.skipped.length} skipped, ${result.errors.length} errors`, tone: result.errors.length > 0 ? "err" : "ok" });
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Fix failed", tone: "err" });
    } finally {
      setActionLoading(null);
    }
  };

  const handlePageCountRescan = async () => {
    setActionLoading("rescan");
    setRescanResult(null);
    try {
      const result = await triggerPageCountRescan({ confirm: true, limit: 100, includeNegative: true });
      setRescanResult(result);
      setToast({ msg: result.message, tone: "ok" });
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Rescan failed", tone: "err" });
    } finally {
      setActionLoading(null);
    }
  };

  const dataQa = t.dataQa;

  return (
    <AppShell>
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 rounded-xl border px-4 py-3 text-sm shadow-lg backdrop-blur ${
            toast.tone === "ok"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
              : "border-red-500/30 bg-red-500/10 text-red-600"
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* Confirm Dialog */}
      {confirmDialog && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-md rounded-2xl border border-border/40 bg-card p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-foreground">{dataQa?.confirmFix ?? "Confirm Fix"}</h3>
            <p className="mt-2 text-sm text-muted">
              {dataQa?.confirmFixMessage ?? "This will modify the database. Affected records will be updated or deleted. This action is idempotent and safe, but please ensure you have a backup."}
            </p>
            <div className="mt-4 flex justify-end gap-3">
              <button
                onClick={() => setConfirmDialog(false)}
                className="rounded-xl px-4 py-2 text-sm text-muted hover:bg-card-hover"
              >
                {dataQa?.cancel ?? "Cancel"}
              </button>
              <button
                onClick={handleExecuteFix}
                className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90"
              >
                {dataQa?.confirmExecute ?? "Confirm Execute"}
              </button>
            </div>
          </div>
        </div>
      )}

      <PageHeader
        title={dataQa?.title ?? "数据巡检"}
        description={dataQa?.settingsDesc ?? "检查页数、阅读时长、孤立标签与异常会话"}
        icon={Shield}
        actions={
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-border/40 px-3 py-2 text-sm text-muted hover:bg-card-hover disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {dataQa?.refresh ?? "Refresh"}
          </button>
        }
      />
      <PageContent width="management" className="space-y-6">

        {/* Summary */}
        {summary && <SummaryCards summary={summary} />}

        {/* Actions bar */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleDryRun}
            disabled={!!actionLoading}
            className="inline-flex items-center gap-2 rounded-xl border border-border/40 px-3 py-2 text-sm text-muted hover:bg-card-hover disabled:opacity-50"
          >
            {actionLoading === "preview" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
            {dataQa?.dryRunPreview ?? "Dry-run Preview"}
          </button>
          <button
            onClick={() => setConfirmDialog(true)}
            disabled={!!actionLoading}
            className="inline-flex items-center gap-2 rounded-xl bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
          >
            {actionLoading === "fix" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
            {dataQa?.executeFix ?? "Execute Fix"}
          </button>
          <button
            onClick={handlePageCountRescan}
            disabled={!!actionLoading}
            className="inline-flex items-center gap-2 rounded-xl border border-border/40 px-3 py-2 text-sm text-muted hover:bg-card-hover disabled:opacity-50"
          >
            {actionLoading === "rescan" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {dataQa?.pageCountRescan ?? "PageCount Rescan"}
          </button>
        </div>

        {/* Filters */}
        <div className="surface-card rounded-xl p-4">
          <button
            className="flex w-full items-center justify-between text-sm font-medium text-foreground"
            onClick={() => setShowFilters((v) => !v)}
          >
            <span className="flex items-center gap-2">
              <Filter className="h-4 w-4" />
              {dataQa?.filters ?? "Filters"}
            </span>
            {showFilters ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {showFilters && (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <input
                  type="text"
                  placeholder={dataQa?.searchPlaceholder ?? "Search issues..."}
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  className="w-full rounded-xl border border-border/40 bg-background py-2 pl-9 pr-3 text-sm placeholder:text-muted focus:border-accent focus:outline-none"
                />
              </div>

              {/* Issue type */}
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="rounded-xl border border-border/40 bg-background px-3 py-2 text-sm focus:border-accent focus:outline-none"
              >
                <option value="">{dataQa?.issueType ?? "Issue Type"}: {dataQa?.all ?? "All"}</option>
                {issueTypes.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>

              {/* Severity */}
              <select
                value={filterSeverity}
                onChange={(e) => setFilterSeverity(e.target.value)}
                className="rounded-xl border border-border/40 bg-background px-3 py-2 text-sm focus:border-accent focus:outline-none"
              >
                <option value="">{dataQa?.severity ?? "Severity"}: {dataQa?.all ?? "All"}</option>
                <option value="p1">P1</option>
                <option value="p2">P2</option>
                <option value="p3">P3</option>
              </select>

              {/* Auto-fixable */}
              <select
                value={filterAutoFixable}
                onChange={(e) => setFilterAutoFixable(e.target.value)}
                className="rounded-xl border border-border/40 bg-background px-3 py-2 text-sm focus:border-accent focus:outline-none"
              >
                <option value="">{dataQa?.autoFixableFilter ?? "Auto-fixable"}: {dataQa?.all ?? "All"}</option>
                <option value="yes">{dataQa?.onlyAutoFixable ?? "Only auto-fixable"}</option>
                <option value="no">{dataQa?.notAutoFixable ?? "Not auto-fixable"}</option>
              </select>
            </div>
          )}
        </div>

        {/* Preview result */}
        {previewResult && (
          <div className="surface-card rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">{dataQa?.previewResult ?? "Preview Result"} ({previewResult.totalPlanned})</div>
              <button onClick={() => setPreviewResult(null)} className="text-muted hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            {previewResult.plans.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {previewResult.plans.map((p) => (
                  <div key={p.issueId} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/20 bg-background/50 px-3 py-2 text-xs">
                    <span className="font-medium text-foreground">{p.action}</span>
                    <span className="text-muted">{p.entityType} #{p.entityId}</span>
                    {p.currentVal && <span className="text-muted">{dataQa?.currentLabel ?? "Current:"} {p.currentVal}</span>}
                    {p.expectedVal && <span className="text-emerald-500">{dataQa?.expectedLabel ?? "Expected:"} {p.expectedVal}</span>}
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${p.safe ? "bg-emerald-500/10 text-emerald-500" : "bg-amber-500/10 text-amber-500"}`}>
                      {p.safe ? "safe" : "review"}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {previewResult.skipped.length > 0 && (
              <div className="mt-2 text-xs text-muted">
                {dataQa?.skipped ?? "Skipped:"} {previewResult.skipped.map((s) => `${s.issueId} (${s.reason})`).join(", ")}
              </div>
            )}
          </div>
        )}

        {/* Fix result */}
        {fixResult && (
          <div className="surface-card rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">{dataQa?.fixResult ?? "Fix Result"}</div>
              <button onClick={() => setFixResult(null)} className="text-muted hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-2 flex gap-4 text-xs">
              <span className="text-emerald-500">{fixResult.totalExecuted} {dataQa?.executed ?? "executed"}</span>
              <span className="text-muted">{fixResult.skipped.length} {dataQa?.skipped ?? "skipped"}</span>
              <span className="text-red-500">{fixResult.errors.length} {dataQa?.errors ?? "errors"}</span>
            </div>
            {fixResult.executed.length > 0 && (
              <div className="mt-3 max-h-40 space-y-2 overflow-y-auto">
                {fixResult.executed.map((e: DataQAFixResultItem, i: number) => (
                  <div key={i} className="flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2 text-xs">
                    <CheckCircle2 className="mt-0.5 h-3 w-3 flex-shrink-0 text-emerald-500" />
                    <div>
                      <span className="font-medium">{e.action}</span>
                      <span className="ml-2 text-muted">{e.entityId}</span>
                      <span className="ml-2 text-muted">{e.before} → {e.after}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {fixResult.skipped.length > 0 && (
              <div className="mt-3 max-h-40 space-y-2 overflow-y-auto">
                {fixResult.skipped.map((e: DataQASkip, i: number) => (
                  <div key={i} className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2 text-xs">
                    <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0 text-amber-500" />
                    <div>
                      <span className="font-medium">{e.issueId}</span>
                      <span className="ml-2 text-muted">{e.reason}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {fixResult.errors.length > 0 && (
              <div className="mt-3 max-h-40 space-y-2 overflow-y-auto">
                {fixResult.errors.map((e: DataQAFixResultItem, i: number) => (
                  <div key={i} className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 p-2 text-xs">
                    <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0 text-red-500" />
                    <div>
                      <span className="font-medium">{e.action}</span>
                      <span className="ml-2 text-muted">{e.entityId}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

{/* PageCount Rescan result */}
        {rescanResult && (
          <div className="surface-card rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">{dataQa?.rescanTitle ?? "PageCount Rescan"}</div>
              <button onClick={() => setRescanResult(null)} className="text-muted hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-2 text-xs text-muted">{rescanResult.message}</div>
            {rescanResult.queued > 0 && (
              <div className="mt-1 text-xs text-amber-500">
                {rescanResult.queued} {dataQa?.comicsQueued ?? "comics queued for background scanner"}
              </div>
            )}
          </div>
        )}

        {/* Issue list */}
        <div className="space-y-2">
          {loading && issues.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-muted">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {dataQa?.scanning ?? "Scanning..."}
            </div>
          ) : filtered.length === 0 ? (
            <div className="surface-card flex flex-col items-center justify-center rounded-xl py-12">
              <CheckCircle2 className="h-8 w-8 text-emerald-500" />
              <div className="mt-2 text-sm text-muted">{dataQa?.noIssues ?? "No issues found"}</div>
            </div>
          ) : (
            filtered.map((issue) => (
              <IssueRow key={issue.id} issue={issue} />
            ))
          )}
        </div>
      </PageContent>
    </AppShell>
  );
}

// ============================================================
// Issue row
// ============================================================

function IssueRow({ issue }: { issue: DataQAIssue }) {
  const [expanded, setExpanded] = useState(false);
  const t = useTranslation();
  const typeLabel = useIssueTypeLabel(issue.issueType);
  const dataQa = t.dataQa;

  return (
    <div className="surface-card rounded-xl p-4 transition-colors hover:bg-card-hover">
      <div
        className="flex cursor-pointer items-start gap-3"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="mt-0.5 flex-shrink-0">
          {issue.autoFixable ? (
            <Wrench className="h-4 w-4 text-amber-500" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-muted" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge level={issue.severity} />
            <span className="text-xs font-medium text-foreground" title={issue.issueType}>{typeLabel}</span>
            <span className="text-xs text-muted">{issue.entityType}</span>
            {issue.autoFixable && (
              <span className="text-xs text-amber-500">{dataQa?.autoFixBadge ?? "auto-fix"}</span>
            )}
          </div>
          <div className="mt-1 truncate text-sm text-muted">{issue.entityId}</div>
          {issue.title && (
            <div className="mt-0.5 text-sm font-medium">{issue.title}</div>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 flex-shrink-0 text-muted" />
        ) : (
          <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted" />
        )}
      </div>
      {expanded && (
        <div className="mt-3 space-y-2 border-t border-border pt-3 pl-7 text-sm text-muted">
          <div>{issue.message}</div>
          {(issue.currentVal || issue.expectedVal) && (
            <div className="flex gap-4 text-xs">
              {issue.currentVal && (
                <span>
                  {dataQa?.currentLabel ?? "Current:"} <span className="font-mono text-foreground">{issue.currentVal}</span>
                </span>
              )}
              {issue.expectedVal && (
                <span>
                  {dataQa?.expectedLabel ?? "Expected:"} <span className="font-mono text-foreground">{issue.expectedVal}</span>
                </span>
              )}
            </div>
          )}
          <div className="text-xs text-muted/60">{dataQa?.idLabel ?? "ID:"} {issue.id}</div>
        </div>
      )}
    </div>
  );
}
