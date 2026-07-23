import { apiPath } from "@/lib/base-path";

/**
 * Data QA 模块 API
 * 对应后端 /api/admin/data-qa/*
 */

const getBase = () => apiPath("/api/admin/data-qa");

// ============================================================
// Types
// ============================================================

export interface DataQAIssue {
  id: string;
  issueType: string;
  severity: string;
  entityType: string;
  entityId: string;
  title?: string;
  message: string;
  currentVal?: string;
  expectedVal?: string;
  autoFixable: boolean;
}

export interface DataQASummary {
  totalIssues: number;
  p1: number;
  p2: number;
  p3: number;
  autoFixable: number;
  byType: Record<string, number>;
}

export interface DataQAFixPlan {
  issueId: string;
  issueType: string;
  entityType: string;
  entityId: string;
  action: string;
  safe: boolean;
  currentVal?: string;
  expectedVal?: string;
  message: string;
}

export interface DataQASkip {
  issueId: string;
  reason: string;
}

export interface DataQAFixPreviewResult {
  dryRun: boolean;
  totalPlanned: number;
  plans: DataQAFixPlan[];
  skipped: DataQASkip[];
}

export interface DataQAFixResultItem {
  issueId: string;
  issueType: string;
  entityType: string;
  entityId: string;
  action: string;
  before: string;
  after: string;
  success: boolean;
}

export interface DataQAFixResult {
  dryRun: boolean;
  totalExecuted: number;
  executed: DataQAFixResultItem[];
  skipped: DataQASkip[];
  errors: DataQAFixResultItem[];
}


export interface PageCountRescanResult {
  queued: number;
  comicIds: string[];
  message: string;
}
// ============================================================
// API calls
// ============================================================

export async function fetchSummary(): Promise<DataQASummary> {
  const res = await fetch(apiPath(getBase() + "/summary"), { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch summary: " + res.status);
  return res.json();
}

export async function fetchIssues(): Promise<{ issues: DataQAIssue[] }> {
  const res = await fetch(apiPath(getBase() + "/issues"), { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch issues: " + res.status);
  return res.json();
}

export async function fetchFixPreview(body: {
  issueTypes?: string[];
  issueIds?: string[];
  fixAll?: boolean;
}): Promise<DataQAFixPreviewResult> {
  const res = await fetch(apiPath(getBase() + "/fix-preview"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Fix preview failed: " + res.status);
  return res.json();
}

export async function executeFix(body: {
  issueTypes?: string[];
  issueIds?: string[];
  fixAll?: boolean;
  confirm: boolean;
}): Promise<DataQAFixResult> {
  const res = await fetch(apiPath(getBase() + "/fix"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Fix execution failed: " + res.status);
  return res.json();
}

export async function triggerPageCountRescan(body: {
  confirm: boolean;
  limit?: number;
  includeNegative?: boolean;
}): Promise<PageCountRescanResult> {
  const res = await fetch(apiPath(getBase() + "/pagecount-rescan"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("PageCount rescan failed: " + res.status);
  return res.json();
}
