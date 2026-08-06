"use client";

import { apiPath } from "@/lib/base-path";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Info,
  Brain,
  Globe,
  BookOpen,
  BarChart3,
  AlertTriangle,
  Sparkles,
  Github,
  Heart,
  ExternalLink,
  Server,
  Database,
  FileText,
  Monitor,
  HardDrive,
  Users,
  UserCog,
  Wand2,
  Shield,
  Search,
  X,
  RefreshCw,
  Eye,
  ChevronRight,
  Settings as SettingsIcon,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";
import { formatAppVersion } from "@/lib/version";
import { useReaderOptions } from "@/hooks/useReaderOptions";
import { defaultReaderOptions } from "@/types/reader";
import dynamic from "next/dynamic";
import { appPath } from "@/lib/base-path";
import AppShell from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";

/* ── 懒加载面板 ── */
const LoadingSkeleton = () => (
  <div className="space-y-4 p-2">
    <div className="h-6 w-40 animate-pulse rounded-lg bg-card" />
    <div className="h-32 animate-pulse rounded-lg bg-card" />
    <div className="h-48 animate-pulse rounded-lg bg-card" />
    <div className="h-24 animate-pulse rounded-lg bg-card" />
  </div>
);

const SiteSettingsPanel = dynamic(
  () => import("@/components/SiteSettingsPanel").then((mod) => mod.SiteSettingsPanel),
  { loading: LoadingSkeleton }
);

const AISettingsPanel = dynamic(
  () => import("@/components/AISettingsPanel").then((mod) => mod.AISettingsPanel),
  { loading: LoadingSkeleton }
);

const ScanRulesPanel = dynamic(
  () => import("@/components/ScanRulesPanel").then((mod) => mod.ScanRulesPanel),
  { loading: LoadingSkeleton }
);

const FileStatsPanel = dynamic(
  () => import("@/components/FileStatsPanel"),
  { loading: LoadingSkeleton }
);

const UserManagementPanel = dynamic(
  () => import("@/components/UserManagementPanel").then((mod) => mod.UserManagementPanel),
  { loading: LoadingSkeleton }
);

const AccountPanel = dynamic(
  () => import("@/components/AccountPanel").then((mod) => mod.AccountPanel),
  { loading: LoadingSkeleton }
);

const LibraryManagementPanel = dynamic(
  () => import("@/components/LibraryManagementPanel").then((mod) => mod.LibraryManagementPanel),
  { loading: LoadingSkeleton }
);

const UserGroupManagementPanel = dynamic(
  () => import("@/components/UserGroupManagementPanel").then((mod) => mod.default),
  { loading: LoadingSkeleton }
);

const NASDiagnosticsPanel = dynamic(
  () => import("@/components/NASDiagnosticsPanel").then((mod) => mod.default),
  { loading: LoadingSkeleton }
);

/* ── 类型 ── */
type SettingsTab =
  | "account"
  | "site"
  | "ai"
  | "scan-rules"
  | "users"
  | "stats"
  | "file-stats"
  | "logs"
  | "libraries"
  | "user-groups"
  | "diagnostics"
  | "reader"
  | "data-admin"
  | "data-qa"
  | "sync-backup"
  | "about";

interface TabDef {
  id: SettingsTab;
  label: string;
  icon: React.ReactNode;
  desc?: string;
  keywords?: string[];
  href?: string;
}

interface TabGroup {
  title: string;
  tabs: TabDef[];
}

const standaloneSettingsRoutes: Partial<Record<SettingsTab, string>> = {
  stats: "/stats",
  logs: "/logs",
  "data-admin": "/data-admin",
  "data-qa": "/data-qa",
};

/* ── 搜索匹配 ── */
function matchesSearch(tab: TabDef, groupTitle: string, query: string): boolean {
  const q = query.toLowerCase();
  if (tab.label.toLowerCase().includes(q)) return true;
  if (tab.desc?.toLowerCase().includes(q)) return true;
  if (groupTitle.toLowerCase().includes(q)) return true;
  if (tab.keywords?.some((k) => k.toLowerCase().includes(q))) return true;
  return false;
}

/* ── 主页面 ── */
export default function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslation();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const validTabs: SettingsTab[] = [
    "account",
    ...(isAdmin
      ? ["site" as const, "ai" as const, "scan-rules" as const, "users" as const, "stats" as const, "file-stats" as const, "logs" as const, "libraries" as const, "user-groups" as const, "diagnostics" as const, "reader" as const, "data-admin" as const, "data-qa" as const, "sync-backup" as const]
      : []),
    "about",
  ];

  const tabFromUrl = searchParams.get("tab") as SettingsTab | null;
  const [activeTab, setActiveTab] = useState<SettingsTab>(
    tabFromUrl && validTabs.includes(tabFromUrl) && !standaloneSettingsRoutes[tabFromUrl]
      ? tabFromUrl
      : "account"
  );
  const [mobileDetailOpen, setMobileDetailOpen] = useState(
    Boolean(tabFromUrl && validTabs.includes(tabFromUrl) && !standaloneSettingsRoutes[tabFromUrl])
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [contentKey, setContentKey] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);

  useEffect(() => {
    if (!tabFromUrl) return;
    const route = standaloneSettingsRoutes[tabFromUrl];
    if (route) {
      router.replace(route);
      return;
    }
    if (validTabs.includes(tabFromUrl)) {
      setActiveTab(tabFromUrl);
      setMobileDetailOpen(true);
    }
  }, [isAdmin, router, tabFromUrl]);

  /* ── Tab 定义 ── */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tAny = t as any;
  const groups: TabGroup[] = [
    {
      title: t.settings?.groupGeneral || "通用",
      tabs: [
        { id: "account", label: "我的账户", icon: <UserCog className="h-[18px] w-[18px]" />, desc: "密码、昵称", keywords: ["密码", "昵称", "password", "profile"] },
        ...(isAdmin
          ? [
              { id: "site" as const, label: "站点设置", icon: <Globe className="h-[18px] w-[18px]" />, desc: "名称、目录、缓存", keywords: ["站点", "目录", "缓存", "site", "cache"] },
              { id: "reader" as const, label: "阅读器偏好", icon: <Eye className="h-[18px] w-[18px]" />, desc: "方向、缩放、翻页、背景", keywords: ["reader", "reading", "page", "zoom", "direction", "animation", "progress", "阅读器", "阅读", "方向", "缩放", "翻页", "页码", "进度"] },
            ]
          : []),
      ],
    },
    {
      title: "书库与权限",
      tabs: [
        ...(isAdmin
          ? [
              { id: "libraries" as const, label: "书库管理", icon: <BookOpen className="h-[18px] w-[18px]" />, desc: "目录、权限、公开策略", keywords: ["书库", "目录", "权限", "library"] },
              { id: "users" as const, label: "用户管理", icon: <Users className="h-[18px] w-[18px]" />, desc: "账号、角色、注册策略", keywords: ["用户", "账号", "角色", "user", "role"] },
              { id: "user-groups" as const, label: "权限组", icon: <Users className="h-[18px] w-[18px]" />, desc: "批量管理用户书库权限", keywords: ["权限组", "用户组", "权限", "group"] },
            ]
          : []),
      ],
    },
    {
      title: "自动化",
      tabs: [
        ...(isAdmin
          ? [
              { id: "ai" as const, label: t.ai?.title || "AI 功能", icon: <Brain className="h-[18px] w-[18px]" />, desc: "智能识别与推荐", keywords: ["AI", "智能", "推荐", "识别", "模型"] },
              { id: "scan-rules" as const, label: "扫描规则", icon: <Wand2 className="h-[18px] w-[18px]" />, desc: "AI 识别 + 自动归类", keywords: ["扫描", "规则", "归类", "scan", "rules"] },
            ]
          : []),
      ],
    },
    {
      title: "系统",
      tabs: [
        ...(isAdmin
          ? [
              { id: "diagnostics" as const, label: "系统诊断", icon: <Shield className="h-[18px] w-[18px]" />, desc: "环境检查、权限、工具", keywords: ["诊断", "检查", "权限", "diagnostics"] },
            ]
          : []),
        { id: "about", label: t.settings?.about || "关于", icon: <Info className="h-[18px] w-[18px]" />, desc: t.settings?.aboutDesc || "版本与项目信息", keywords: ["关于", "版本", "about", "version"] },
      ],
    },
    {
      title: "管理工具",
      tabs: isAdmin
        ? [
            { id: "stats" as const, label: t.stats?.title || "阅读统计", icon: <BarChart3 className="h-[18px] w-[18px]" />, desc: "时长、趋势、目标", keywords: ["统计", "时长", "趋势", "stats", "reading"], href: "/stats" },
            { id: "file-stats" as const, label: "文件统计", icon: <HardDrive className="h-[18px] w-[18px]" />, desc: "格式、大小、分布", keywords: ["文件", "大小", "格式", "file", "storage"] },
            { id: "logs" as const, label: tAny.errorLogs?.title || "错误日志", icon: <AlertTriangle className="h-[18px] w-[18px]" />, desc: "接口异常记录", keywords: ["日志", "错误", "异常", "logs", "error"], href: "/logs" },
            { id: "data-admin" as const, label: "数据管理", icon: <HardDrive className="h-[18px] w-[18px]" />, desc: "存储、缓存、数据库维护", keywords: ["数据", "管理", "存储", "缓存", "数据库", "data", "admin", "storage", "cache", "database"], href: "/data-admin" },
            { id: "data-qa" as const, label: "数据巡检", icon: <Database className="h-[18px] w-[18px]" />, desc: "一致性检查、安全修复", keywords: ["data", "qa", "health", "repair", "scan", "fix", "dry-run", "数据", "巡检", "修复", "扫描", "异常", "健康"], href: "/data-qa" },
            { id: "sync-backup" as const, label: "同步与备份", icon: <RefreshCw className="h-[18px] w-[18px]" />, desc: "规划中的备份与同步能力", keywords: ["sync", "backup", "export", "import", "restore", "同步", "备份", "导出", "导入", "恢复"] },
          ]
        : [],
    },
  ];

  const allTabs = groups.flatMap((g) => g.tabs);
  const currentTab = allTabs.find((tab) => tab.id === activeTab);
  const isFullWidthTab = ["file-stats", "libraries"].includes(activeTab);

  /* ── 搜索过滤 ── */
  const filteredGroups = useMemo(() => {
    return groups
      .map((group) => ({
        ...group,
        tabs: group.tabs.filter(
          (tab) =>
            validTabs.includes(tab.id) &&
            (!searchQuery.trim() || matchesSearch(tab, group.title, searchQuery))
        ),
      }))
      .filter((group) => group.tabs.length > 0);
  }, [groups, searchQuery, validTabs]);

  const hasSearchResults = filteredGroups.some((g) => g.tabs.length > 0);

  /* ── Tab 切换动画 ── */
  const switchTab = useCallback(
    (tabId: SettingsTab, openMobileDetail = false) => {
      const route = standaloneSettingsRoutes[tabId];
      if (route) {
        router.push(route);
        return;
      }
      router.replace(`/settings?tab=${tabId}`);
      if (openMobileDetail) setMobileDetailOpen(true);
      if (tabId === activeTab) return;
      setIsTransitioning(true);
      setContentKey((k) => k + 1);
      requestAnimationFrame(() => {
        setActiveTab(tabId);
        requestAnimationFrame(() => {
          setIsTransitioning(false);
        });
      });
    },
    [activeTab, router]
  );

  const activePanel = (
    <div
      key={contentKey}
      className={`transition-all duration-200 ease-out ${
        isTransitioning ? "translate-y-1 opacity-0" : "translate-y-0 opacity-100"
      }`}
    >
      {activeTab === "account" && <AccountPanel />}
      {activeTab === "site" && <SiteSettingsPanel />}
      {activeTab === "ai" && <AISettingsPanel />}
      {activeTab === "scan-rules" && <ScanRulesPanel />}
      {activeTab === "users" && <UserManagementPanel />}
      {activeTab === "libraries" && <LibraryManagementPanel />}
      {activeTab === "user-groups" && <UserGroupManagementPanel />}
      {activeTab === "diagnostics" && <NASDiagnosticsPanel />}
      {activeTab === "reader" && <ReaderPreferencesPanel />}
      {activeTab === "sync-backup" && <SyncBackupPanel />}
      {activeTab === "file-stats" && <FileStatsPanel />}
      {activeTab === "about" && <AboutPanel />}
    </div>
  );

  const searchField = (
    <div className="relative w-full sm:w-64">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted/60" />
      <input
        type="search"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="搜索设置"
        aria-label="搜索设置"
        className="h-10 w-full rounded-lg border border-border bg-card pl-9 pr-10 text-sm text-foreground outline-none transition-colors placeholder:text-muted/60 focus:border-accent"
      />
      {searchQuery && (
        <button
          type="button"
          onClick={() => setSearchQuery("")}
          aria-label="清除搜索"
          className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted transition-colors hover:bg-card-hover hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );

  return (
    <AppShell>
      <PageHeader
        title={t.settings?.title || "设置"}
        description="管理账户、书库与系统偏好"
        icon={SettingsIcon}
        width="wide"
        actions={<div className="hidden sm:block">{searchField}</div>}
      />

      <section className="sm:hidden">
        {!mobileDetailOpen ? (
          <div className="space-y-5 px-4 py-4">
            {searchField}
            {filteredGroups.map((group) => (
              <section key={group.title}>
                <h2 className="mb-2 px-1 text-xs font-semibold text-muted">{group.title}</h2>
                <div className="overflow-hidden rounded-lg border border-border bg-card">
                  {group.tabs
                    .filter((tab) => validTabs.includes(tab.id))
                    .map((tab, index) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => switchTab(tab.id, true)}
                        className={`flex min-h-14 w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-card-hover ${
                          index > 0 ? "border-t border-border/70" : ""
                        }`}
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background text-accent">
                          {tab.icon}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-foreground">{tab.label}</span>
                          {tab.desc && <span className="mt-0.5 block truncate text-xs text-muted">{tab.desc}</span>}
                        </span>
                        {tab.href ? (
                          <ExternalLink className="h-4 w-4 shrink-0 text-muted" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted" />
                        )}
                      </button>
                    ))}
                </div>
              </section>
            ))}
            {searchQuery && !hasSearchResults && (
              <div className="py-10 text-center text-sm text-muted">没有匹配的设置项</div>
            )}
          </div>
        ) : (
          <div>
            <div className="sticky top-0 z-30 flex min-h-14 items-center gap-3 border-b border-border bg-background/95 px-3 backdrop-blur">
              <button
                type="button"
                onClick={() => {
                  setMobileDetailOpen(false);
                  setSearchQuery("");
                  router.replace("/settings");
                }}
                aria-label="返回设置列表"
                className="flex h-10 w-10 items-center justify-center rounded-lg text-muted transition-colors hover:bg-card hover:text-foreground"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-card text-accent">
                {currentTab?.icon}
              </span>
              <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">
                {currentTab?.label}
              </h2>
            </div>
            <div className="p-4">{activePanel}</div>
          </div>
        )}
      </section>

      <div
        className={`mx-auto hidden sm:flex ${
          isFullWidthTab ? "max-w-[1760px]" : "max-w-5xl"
        } transition-all duration-300`}
      >
        <aside className="sticky top-16 flex h-[calc(100vh-4rem)] w-60 flex-shrink-0 flex-col gap-1 overflow-y-auto border-r border-border p-3">
          {filteredGroups.map((group, gi) => (
            <div key={gi} className={gi > 0 ? "mt-4" : ""}>
              <div className="flex items-center gap-2 px-3 mb-1.5">
                <span className="text-xs font-semibold text-muted">
                  {group.title}
                </span>
                <div className="h-px flex-1 bg-border" />
              </div>
              {group.tabs
                .filter((tab) => validTabs.includes(tab.id))
                .map((tab) => {
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => switchTab(tab.id)}
                      className={`group relative flex min-h-12 w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                        isActive
                          ? "bg-accent/10 text-accent"
                          : "text-muted hover:bg-card-hover hover:text-foreground"
                      }`}
                    >
                      <div
                        className={`absolute left-0 top-1/2 w-[3px] -translate-y-1/2 rounded-r-full bg-accent transition-all duration-200 ${
                          isActive ? "h-5 opacity-100" : "h-0 opacity-0"
                        }`}
                      />
                      <span
                        className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                          isActive
                            ? "bg-accent/15 text-accent"
                            : "bg-card text-muted group-hover:bg-card-hover group-hover:text-foreground"
                        }`}
                      >
                        {tab.icon}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className={`text-sm font-medium truncate ${isActive ? "text-accent" : ""}`}>
                          {tab.label}
                        </div>
                        {tab.desc && (
                          <div className="mt-0.5 truncate text-xs leading-tight text-muted">
                            {tab.desc}
                          </div>
                        )}
                      </div>
                      {tab.href && <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted/50" />}
                    </button>
                  );
                })}
            </div>
          ))}
          {/* Search empty state */}
          {searchQuery && !hasSearchResults && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Search className="h-8 w-8 text-muted/20 mb-2" />
              <p className="text-sm text-muted/50">没有匹配的设置项</p>
              <button
                onClick={() => setSearchQuery("")}
                className="mt-2 min-h-10 text-xs text-accent transition-colors hover:underline"
              >
                清除搜索
              </button>
            </div>
          )}
        </aside>

        <main className="min-h-[calc(100vh-4rem)] min-w-0 flex-1">
          <div className={`p-4 sm:p-8 ${isFullWidthTab ? "" : "max-w-3xl"}`}>
            {activePanel}
          </div>
        </main>
      </div>
    </AppShell>
  );
}

/* ── Reader Preferences Panel ── */
function ReaderPreferencesPanel() {
  const { options, updateOptions, loaded } = useReaderOptions();
  const [resetConfirm, setResetConfirm] = useState(false);

  // Derive UI state from real ReaderOptions
  const directionUI = options.direction === "rtl" ? "rtl" : options.infiniteScroll ? "vertical" : "ltr";
  const zoomUI = options.fitMode === "width" ? "fit-width" : options.fitMode === "height" ? "fit-height" : "original";

  const handleDirectionChange = (val: string) => {
    if (val === "ltr") updateOptions({ direction: "ltr", infiniteScroll: false, mode: "single" });
    else if (val === "rtl") updateOptions({ direction: "rtl", infiniteScroll: false, mode: "single" });
    else if (val === "vertical") updateOptions({ direction: "ttb", infiniteScroll: true, mode: "webtoon" });
  };

  const handleZoomChange = (val: string) => {
    if (val === "fit-width") updateOptions({ fitMode: "width" });
    else if (val === "fit-height") updateOptions({ fitMode: "height" });
    else if (val === "original") updateOptions({ fitMode: "container", containerWidth: "100%" });
  };

  const handleResetDefaults = () => {
    if (!resetConfirm) {
      setResetConfirm(true);
      return;
    }
    updateOptions({ ...defaultReaderOptions });
    setResetConfirm(false);
  };

  if (!loaded) {
    return (
      <div className="space-y-4 p-2">
        <div className="h-24 animate-pulse rounded-lg bg-card" />
        <div className="h-48 animate-pulse rounded-lg bg-card" />
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="rounded-lg border border-border bg-card p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <Eye className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-foreground">阅读器偏好</h2>
            <p className="text-xs text-muted">调整阅读方向、缩放与进度跟踪，设置会保存到当前浏览器并在阅读器中自动生效。</p>
          </div>
        </div>
        <p className="mt-3 rounded-lg border border-border bg-background p-3 text-xs text-muted">
          跨设备同步将在后续版本支持。
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="divide-y divide-border/25">
          {/* Direction */}
          <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div>
              <div className="text-sm font-medium text-foreground">默认阅读方向</div>
              <div className="text-xs text-muted">控制漫画翻页和小说排版的主要阅读流向。</div>
            </div>
            <select
              value={directionUI}
              onChange={(e) => handleDirectionChange(e.target.value)}
              className="h-9 w-full rounded-lg border border-border/50 bg-card/60 px-3 text-sm outline-none focus:border-accent/40 sm:w-56"
            >
              <option value="ltr">从左到右</option>
              <option value="rtl">从右到左</option>
              <option value="vertical">垂直滚动</option>
            </select>
          </div>

          {/* Zoom */}
          <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div>
              <div className="text-sm font-medium text-foreground">默认缩放模式</div>
              <div className="text-xs text-muted">决定打开阅读器时的默认页面适配方式。</div>
            </div>
            <select
              value={zoomUI}
              onChange={(e) => handleZoomChange(e.target.value)}
              className="h-9 w-full rounded-lg border border-border/50 bg-card/60 px-3 text-sm outline-none focus:border-accent/40 sm:w-56"
            >
              <option value="fit-width">适应宽度</option>
              <option value="fit-height">适应高度</option>
              <option value="original">原始大小</option>
            </select>
          </div>

          {/* Page flip effect */}
          <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div>
              <div className="text-sm font-medium text-foreground">翻页效果 <span className="ml-1 inline-flex items-center rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400 border border-amber-500/20">实验</span></div>
              <div className="text-xs text-muted">真实翻页仅适用于图片漫画的单页/双页模式；小屏、PDF、小说、Webtoon 和减少动态效果模式下会自动禁用。</div>
            </div>
            <select
              value={options.pageFlipEffect}
              onChange={(e) => updateOptions({ pageFlipEffect: e.target.value as "none" | "realistic" })}
              className="h-9 w-full rounded-lg border border-border/50 bg-card/60 px-3 text-sm outline-none transition-colors focus:border-accent/50 sm:w-56"
            >
              <option value="none">关闭</option>
              <option value="realistic">真实翻页（实验）</option>
            </select>
          </div>

          {/* Background — disabled, coming soon */}
          <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4 opacity-50">
            <div>
              <div className="text-sm font-medium text-foreground">阅读背景 <span className="ml-1 text-[10px] text-muted">即将支持</span></div>
              <div className="text-xs text-muted">为长时间阅读选择更舒适的背景主题。</div>
            </div>
            <select disabled className="h-9 w-full rounded-lg border border-border/50 bg-card/60 px-3 text-sm outline-none sm:w-56">
              <option>跟随主题</option>
            </select>
          </div>

          {/* Toggle: progress tracking */}
          {[
            { label: "自动保存阅读进度", desc: "跟踪并自动记录最后阅读位置，下次打开继续阅读。", checked: options.progressTracking, onChange: (v: boolean) => updateOptions({ progressTracking: v }) },
          ].map((item) => (
            <div key={item.label} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div>
                <div className="text-sm font-medium text-foreground">{item.label}</div>
                <div className="text-xs text-muted">{item.desc}</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={item.checked}
                onClick={() => item.onChange(!item.checked)}
                className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${item.checked ? "bg-accent" : "bg-muted/40"}`}
              >
                <span
                  aria-hidden
                  className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${item.checked ? "translate-x-5" : "translate-x-0"}`}
                />
              </button>
            </div>
          ))}

          {/* Reset button */}
          <div className="p-4 flex items-center gap-2">
            <button
              onClick={handleResetDefaults}
              className={`inline-flex min-h-10 items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                resetConfirm
                  ? "bg-red-500/10 text-red-500 hover:bg-red-500/20"
                  : "border border-border/40 text-muted hover:text-foreground hover:bg-card-hover"
              }`}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {resetConfirm ? "确认恢复默认设置" : "恢复默认阅读器设置"}
            </button>
            {resetConfirm && (
              <button onClick={() => setResetConfirm(false)} className="text-xs text-muted hover:text-foreground">取消</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
/* ── Sync & Backup Panel ── */
function SyncBackupPanel() {
  return (
    <div className="max-w-2xl space-y-5">
      <div className="rounded-lg border border-border bg-card p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <HardDrive className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-foreground">同步与备份</h2>
              <span className="rounded-full border border-border bg-background px-2 py-0.5 text-xs text-muted">
                规划中
              </span>
            </div>
            <p className="mt-1 text-sm text-muted">
              用于备份应用配置、阅读数据和跨设备同步进度。
            </p>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="divide-y divide-border">
          {[
            { title: "自动备份", description: "按计划备份应用配置和阅读数据。" },
            { title: "配置导入与导出", description: "迁移站点设置、书库配置与权限规则。" },
            { title: "阅读数据备份", description: "导出阅读历史、进度与统计数据。" },
            { title: "跨设备同步", description: "同步阅读进度、书签和阅读历史。" },
          ].map((item) => (
            <div key={item.title} className="flex min-h-16 items-center gap-4 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground">{item.title}</div>
                <p className="mt-0.5 text-xs text-muted">{item.description}</p>
              </div>
              <span className="shrink-0 text-xs text-muted">暂未开放</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-border bg-background p-4 text-xs text-muted">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
        <p>该页面仅展示后续能力范围，相关接口就绪前不会保存任何设置。</p>
      </div>
    </div>
  );
}

/* ── About Panel ── */
/* ═══════════════════════════════════════════
   About Panel — 品牌展示卡 + 技术栈
   ═══════════════════════════════════════════ */
function AboutPanel() {
  const t = useTranslation();
  const [versionInfo, setVersionInfo] = useState<{ version: string; uptime: string; runtime?: { go: string; os: string; arch: string; cpus: number; goroutines: number; memoryMB: number } } | null>(null);

  useEffect(() => {
    fetch(apiPath("/api/health"))
      .then((res) => res.json())
      .then((data) => setVersionInfo(data))
      .catch(() => {});
  }, []);

  const techStack = [
    { icon: <Server className="h-4 w-4" />, label: "Backend", value: "Go (Gin)" },
    { icon: <Monitor className="h-4 w-4" />, label: "Frontend", value: "Vite + React 19" },
    { icon: <Database className="h-4 w-4" />, label: "Database", value: "SQLite (WAL)" },
    { icon: <FileText className="h-4 w-4" />, label: "Comics", value: "ZIP/CBZ/RAR/CBR/7Z/PDF/AZW3" },
    { icon: <BookOpen className="h-4 w-4" />, label: "Novels", value: "TXT/EPUB/MOBI/AZW3" },
    { icon: <Sparkles className="h-4 w-4" />, label: "AI", value: "OpenAI / 国内大模型" },
    { icon: <Globe className="h-4 w-4" />, label: "i18n", value: "中文 / English / 日本語" },
  ];

  return (
    <div className="space-y-6 max-w-lg mx-auto">
      {/* Brand Card */}
      <div className="overflow-hidden rounded-lg border border-border bg-card p-6 sm:p-8">
        <div className="flex flex-col items-center gap-4 text-center">
          {/* Logo */}
          <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-accent">
            <BookOpen className="h-8 w-8 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-foreground tracking-tight">NowenReader</h2>
            <p className="mt-1 text-sm text-muted">
              {t.settings?.aboutSlogan || "高性能自托管漫画 & 小说管理平台"}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-center">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
              <Sparkles className="h-3 w-3" />
              {formatAppVersion(versionInfo?.version)}
            </span>
            {versionInfo?.runtime && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-1 text-xs text-muted">
                {versionInfo.runtime.go} · {versionInfo.runtime.os}/{versionInfo.runtime.arch}
              </span>
            )}
          </div>
          {versionInfo && (
            <div className="flex items-center gap-3 text-[11px] text-muted/60">
              <span className="inline-flex items-center gap-1">
                <Server className="h-3 w-3" />
                运行时间: {versionInfo.uptime}
              </span>
              {versionInfo.runtime && (
                <span className="inline-flex items-center gap-1">
                  <HardDrive className="h-3 w-3" />
                  {versionInfo.runtime.memoryMB} MB
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Tech Stack */}
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="px-5 py-3.5 border-b border-border/30">
          <h3 className="text-sm font-semibold text-foreground">
            {t.settings?.aboutTechStack || "技术栈"}
          </h3>
        </div>
        <div className="divide-y divide-border/20">
          {techStack.map((item, i) => (
            <div key={i} className="flex items-center gap-3.5 px-5 py-3 hover:bg-card-hover/50 transition-colors">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-accent">
                {item.icon}
              </span>
              <span className="text-sm text-muted w-20 shrink-0">{item.label}</span>
              <span className="text-sm font-medium text-foreground">{item.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Links */}
      <div className="flex items-center justify-center gap-4">
        <a
          href="https://github.com/cropflre/nowen-reader"
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-10 items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-muted transition-colors hover:border-accent/40 hover:bg-accent/5 hover:text-accent"
        >
          <Github className="h-4 w-4" />
          GitHub
          <ExternalLink className="h-3 w-3 opacity-50" />
        </a>
        <a
          href={appPath("/api-doc.html")}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-10 items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-muted transition-colors hover:border-accent/40 hover:bg-accent/5 hover:text-accent"
        >
          <FileText className="h-4 w-4" />
          API Docs
          <ExternalLink className="h-3 w-3 opacity-50" />
        </a>
      </div>

      {/* Footer */}
      <p className="text-center text-xs text-muted/50 flex items-center justify-center gap-1">
        Made with <Heart className="h-3 w-3 text-rose-400/60 fill-rose-400/60" /> by Nowen
      </p>
    </div>
  );
}
