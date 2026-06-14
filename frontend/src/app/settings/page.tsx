"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
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
} from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";
import dynamic from "next/dynamic";

/* ── 懒加载面板 ── */
const LoadingSkeleton = () => (
  <div className="space-y-4 p-2">
    <div className="h-6 w-40 animate-pulse rounded-lg bg-card" />
    <div className="h-32 animate-pulse rounded-2xl bg-card" />
    <div className="h-48 animate-pulse rounded-2xl bg-card" />
    <div className="h-24 animate-pulse rounded-2xl bg-card" />
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

const StatsPanel = dynamic(
  () => import("@/components/StatsPanel"),
  { loading: LoadingSkeleton }
);

const LogsPanel = dynamic(
  () => import("@/components/LogsPanel"),
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
  | "about";

interface TabDef {
  id: SettingsTab;
  label: string;
  icon: React.ReactNode;
  desc?: string;
  keywords?: string[];
}

interface TabGroup {
  title: string;
  tabs: TabDef[];
}

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
      ? ["site" as const, "ai" as const, "scan-rules" as const, "users" as const, "stats" as const, "file-stats" as const, "logs" as const, "libraries" as const, "user-groups" as const, "diagnostics" as const]
      : []),
    "about",
  ];

  const tabFromUrl = searchParams.get("tab") as SettingsTab | null;
  const [activeTab, setActiveTab] = useState<SettingsTab>(
    tabFromUrl && validTabs.includes(tabFromUrl) ? tabFromUrl : "account"
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [contentKey, setContentKey] = useState(0);
  const mobileTabsRef = useRef<HTMLDivElement>(null);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);

  /* 滚动检测 */
  const checkScroll = useCallback(() => {
    const el = mobileTabsRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    const el = mobileTabsRef.current;
    if (!el) return;
    checkScroll();
    el.addEventListener("scroll", checkScroll, { passive: true });
    return () => el.removeEventListener("scroll", checkScroll);
  }, [checkScroll]);

  useEffect(() => {
    const el = mobileTabsRef.current;
    if (!el) return;
    const btn = el.querySelector<HTMLElement>("[data-active='true']");
    if (btn) btn.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [activeTab]);

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
              { id: "site" as const, label: t.siteSettings?.tab || "站点设置", icon: <Globe className="h-[18px] w-[18px]" />, desc: "名称、目录、缓存", keywords: ["站点", "目录", "缓存", "site", "cache"] },
              { id: "ai" as const, label: t.ai?.title || "AI 功能", icon: <Brain className="h-[18px] w-[18px]" />, desc: "智能识别与推荐", keywords: ["AI", "智能", "推荐", "识别", "模型"] },
              { id: "scan-rules" as const, label: "扫描规则", icon: <Wand2 className="h-[18px] w-[18px]" />, desc: "AI 识别 + 自动归类", keywords: ["扫描", "规则", "归类", "scan", "rules"] },
              { id: "users" as const, label: "用户管理", icon: <Users className="h-[18px] w-[18px]" />, desc: "账号、角色、注册策略", keywords: ["用户", "账号", "角色", "user", "role"] },
              { id: "libraries" as const, label: "书库管理", icon: <BookOpen className="h-[18px] w-[18px]" />, desc: "目录、权限、公开策略", keywords: ["书库", "目录", "权限", "library"] },
              { id: "user-groups" as const, label: "用户组", icon: <Users className="h-[18px] w-[18px]" />, desc: "批量管理用户权限", keywords: ["用户组", "权限", "group"] },
              { id: "diagnostics" as const, label: "系统诊断", icon: <Shield className="h-[18px] w-[18px]" />, desc: "环境检查、权限、工具", keywords: ["诊断", "检查", "权限", "diagnostics"] },
            ]
          : []),
      ],
    },
    {
      title: t.settings?.groupData || "数据",
      tabs: [
        ...(isAdmin
          ? [
              { id: "stats" as const, label: t.stats?.title || "阅读统计", icon: <BarChart3 className="h-[18px] w-[18px]" />, desc: "时长、趋势、目标", keywords: ["统计", "时长", "趋势", "stats", "reading"] },
              { id: "file-stats" as const, label: "文件统计", icon: <HardDrive className="h-[18px] w-[18px]" />, desc: "格式、大小、分布", keywords: ["文件", "大小", "格式", "file", "storage"] },
              { id: "logs" as const, label: tAny.errorLogs?.title || "错误日志", icon: <AlertTriangle className="h-[18px] w-[18px]" />, desc: "接口异常记录", keywords: ["日志", "错误", "异常", "logs", "error"] },
            ]
          : []),
        { id: "about", label: t.settings?.about || "关于", icon: <Info className="h-[18px] w-[18px]" />, desc: t.settings?.aboutDesc || "版本与项目信息", keywords: ["关于", "版本", "about", "version"] },
      ],
    },
  ];

  const allTabs = groups.flatMap((g) => g.tabs);
  const currentTab = allTabs.find((tab) => tab.id === activeTab);
  const isFullWidthTab = ["stats", "file-stats", "logs"].includes(activeTab);

  /* ── 搜索过滤 ── */
  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return groups;
    return groups
      .map((group) => ({
        ...group,
        tabs: group.tabs.filter((tab) => validTabs.includes(tab.id) && matchesSearch(tab, group.title, searchQuery)),
      }))
      .filter((group) => group.tabs.length > 0);
  }, [groups, searchQuery, validTabs]);

  const hasSearchResults = filteredGroups.some((g) => g.tabs.length > 0);

  /* ── Tab 切换动画 ── */
  const switchTab = useCallback(
    (tabId: SettingsTab) => {
      if (tabId === activeTab) return;
      setIsTransitioning(true);
      setContentKey((k) => k + 1);
      // Small delay for exit animation
      requestAnimationFrame(() => {
        setActiveTab(tabId);
        requestAnimationFrame(() => {
          setIsTransitioning(false);
        });
      });
    },
    [activeTab]
  );

  return (
    <div className="min-h-screen bg-background pb-20 sm:pb-0">
      {/* ═══════════ Header ═══════════ */}
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-2xl">
        <div className="mx-auto flex h-14 sm:h-16 max-w-[1800px] items-center gap-3 px-3 sm:px-6">
          <button
            onClick={() => router.push("/")}
            className="group flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-xl border border-border/50 text-muted transition-all hover:border-accent/40 hover:text-accent hover:bg-accent/5"
          >
            <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="text-base sm:text-lg font-bold text-foreground truncate">
              {t.settings?.title || "设置"}
            </h1>
            {/* 面包屑：当前 tab 名 */}
            {currentTab && (
              <span className="hidden sm:inline-flex items-center gap-1.5 text-sm text-muted/60">
                <span>/</span>
                <span className="truncate max-w-[200px]">{currentTab.label}</span>
              </span>
            )}
          </div>
          {/* Search */}
          <div className="ml-auto relative hidden sm:flex items-center">
            <Search className="absolute left-3 h-3.5 w-3.5 text-muted/50 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索设置…"
              className="h-8 w-48 rounded-lg border border-border/50 bg-card/50 pl-9 pr-8 text-sm text-foreground placeholder:text-muted/40 outline-none transition-all duration-200 focus:border-accent/40 focus:w-64 focus:bg-card"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 text-muted/40 hover:text-foreground transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ═══════════ Mobile Tab Bar ═══════════ */}
      <div className="sm:hidden border-b border-border/40 bg-background/60 backdrop-blur-xl relative">
        {/* Mobile search */}
        <div className="px-3 pt-2 pb-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted/50 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索设置…"
              className="h-9 w-full rounded-lg border border-border/50 bg-card/50 pl-9 pr-8 text-sm text-foreground placeholder:text-muted/40 outline-none transition-all focus:border-accent/40"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted/40 hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        {canScrollLeft && (
          <div className="pointer-events-none absolute left-0 top-12 bottom-0 w-8 z-10 bg-gradient-to-r from-background to-transparent" />
        )}
        {canScrollRight && (
          <div className="pointer-events-none absolute right-0 top-12 bottom-0 w-8 z-10 bg-gradient-to-l from-background to-transparent" />
        )}
        <div
          ref={mobileTabsRef}
          className="flex px-2 py-2 gap-1 overflow-x-auto scrollbar-hide"
        >
          {(searchQuery ? filteredGroups.flatMap((g) => g.tabs) : allTabs)
            .filter((tab) => validTabs.includes(tab.id))
            .map((tab) => (
              <button
                key={tab.id}
                data-active={activeTab === tab.id}
                onClick={() => switchTab(tab.id)}
                className={`relative flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium whitespace-nowrap transition-all duration-200 ${
                  activeTab === tab.id
                    ? "bg-accent text-white shadow-sm shadow-accent/25"
                    : "text-muted hover:text-foreground hover:bg-card"
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
        </div>
        {!hasSearchResults && searchQuery && (
          <div className="px-4 py-3 text-center text-xs text-muted/50">
            没有匹配的设置项
          </div>
        )}
      </div>

      {/* ═══════════ Main Layout ═══════════ */}
      <div className={`mx-auto flex ${isFullWidthTab ? "max-w-[1800px]" : "max-w-5xl"} transition-all duration-300`}>

        {/* ── Desktop Sidebar ── */}
        <aside className="hidden sm:flex flex-col w-60 flex-shrink-0 border-r border-border/40 sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto p-3 gap-1 bg-background/40 backdrop-blur-sm">
          {filteredGroups.map((group, gi) => (
            <div key={gi} className={gi > 0 ? "mt-4" : ""}>
              {/* 合集标题 */}
              <div className="flex items-center gap-2 px-3 mb-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted/60">
                  {group.title}
                </span>
                <div className="flex-1 h-px bg-border/30" />
              </div>
              {/* Tab 按钮 */}
              {group.tabs
                .filter((tab) => validTabs.includes(tab.id))
                .map((tab) => {
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => switchTab(tab.id)}
                      className={`group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all duration-200 ${
                        isActive
                          ? "bg-accent/10 text-accent shadow-sm shadow-accent/5"
                          : "text-muted hover:bg-card-hover hover:text-foreground"
                      }`}
                    >
                      {/* 滑动高亮条 */}
                      <div
                        className={`absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full bg-accent transition-all duration-200 ${
                          isActive ? "h-5 opacity-100" : "h-0 opacity-0"
                        }`}
                      />
                      <span
                        className={`flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-200 ${
                          isActive
                            ? "bg-accent/15 text-accent scale-105"
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
                          <div className="text-[10px] text-muted/60 truncate leading-tight mt-0.5">
                            {tab.desc}
                          </div>
                        )}
                      </div>
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
                className="mt-2 text-xs text-accent/60 hover:text-accent transition-colors"
              >
                清除搜索
              </button>
            </div>
          )}
        </aside>

        {/* ── Content Area ── */}
        <main className="flex-1 min-h-[calc(100vh-4rem)] min-w-0">
          <div className={`p-4 sm:p-8 ${isFullWidthTab ? "" : "max-w-3xl"}`}>
            <div
              key={contentKey}
              className={`transition-all duration-250 ease-out ${
                isTransitioning
                  ? "opacity-0 translate-y-1"
                  : "opacity-100 translate-y-0"
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
              {activeTab === "stats" && <StatsPanel />}
              {activeTab === "file-stats" && <FileStatsPanel />}
              {activeTab === "logs" && <LogsPanel />}
              {activeTab === "about" && <AboutPanel />}
            </div>
          </div>
        </main>
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
    fetch("/api/health")
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
      <div className="relative overflow-hidden rounded-2xl border border-border/40 bg-gradient-to-br from-accent/5 via-card to-card p-6 sm:p-8">
        {/* 装饰背景 */}
        <div className="absolute -top-20 -right-20 h-56 w-56 rounded-full bg-accent/5 blur-3xl" />
        <div className="absolute -bottom-16 -left-16 h-40 w-40 rounded-full bg-accent/5 blur-3xl" />

        <div className="relative flex flex-col items-center text-center gap-4">
          {/* Logo */}
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent shadow-lg shadow-accent/25">
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
              {versionInfo ? `v${versionInfo.version}` : "..."}
            </span>
            {versionInfo?.runtime && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-1 text-xs text-muted">
                {versionInfo.runtime.go} · {versionInfo.runtime.os}/{versionInfo.runtime.arch}
              </span>
            )}
          </div>
          {versionInfo && (
            <div className="flex items-center gap-3 text-[11px] text-muted/60">
              <span>⏱ 运行时间: {versionInfo.uptime}</span>
              {versionInfo.runtime && (
                <span>💾 {versionInfo.runtime.memoryMB} MB</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Tech Stack */}
      <div className="rounded-2xl border border-border/40 bg-card overflow-hidden">
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
          className="flex items-center gap-2 rounded-xl border border-border/40 bg-card px-4 py-2.5 text-sm text-muted transition-all hover:border-accent/40 hover:text-accent hover:bg-accent/5"
        >
          <Github className="h-4 w-4" />
          GitHub
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





