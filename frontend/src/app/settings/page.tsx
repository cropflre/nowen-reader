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
  ChevronDown,
  Mail,
  Settings as SettingsIcon,
} from "lucide-react";
import { useLocale, useTranslation } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";
import { formatAppVersion } from "@/lib/version";
import { useReaderOptions } from "@/hooks/useReaderOptions";
import { defaultReaderOptions } from "@/types/reader";
import dynamic from "next/dynamic";
import { appPath } from "@/lib/base-path";
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
  | "libraries"
  | "user-groups"
  | "diagnostics"
  | "reader"
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
    "reader",
    ...(isAdmin
      ? ["site" as const, "ai" as const, "scan-rules" as const, "users" as const, "libraries" as const, "user-groups" as const, "diagnostics" as const]
      : []),
    "about",
  ];

  const tabFromUrl = searchParams.get("tab") as SettingsTab | null;
  const [activeTab, setActiveTab] = useState<SettingsTab>(
    tabFromUrl && validTabs.includes(tabFromUrl)
      ? tabFromUrl
      : "account"
  );
  const [mobileDetailOpen, setMobileDetailOpen] = useState(
    Boolean(tabFromUrl && validTabs.includes(tabFromUrl))
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [contentKey, setContentKey] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);

  useEffect(() => {
    if (!tabFromUrl) return;
    if (validTabs.includes(tabFromUrl)) {
      setActiveTab(tabFromUrl);
      setMobileDetailOpen(true);
    }
  }, [isAdmin, router, tabFromUrl]);

  /* ── Tab 定义 ── */
  const groups: TabGroup[] = [
    {
      title: "个人",
      tabs: [
        { id: "account", label: "我的账户", icon: <UserCog className="h-[18px] w-[18px]" />, desc: "密码、昵称", keywords: ["密码", "昵称", "password", "profile"] },
        { id: "reader", label: "阅读与显示", icon: <Eye className="h-[18px] w-[18px]" />, desc: "模式、方向、隐私、语言", keywords: ["reader", "reading", "page", "zoom", "direction", "animation", "progress", "阅读器", "阅读", "方向", "缩放", "翻页", "模式", "进度", "隐私", "成人", "封面", "语言", "中文", "英文"] },
      ],
    },
    {
      title: "站点",
      tabs: [
        ...(isAdmin
          ? [
              { id: "site" as const, label: "站点配置", icon: <Globe className="h-[18px] w-[18px]" />, desc: "名称、识别、元数据", keywords: ["站点", "名称", "图标", "识别", "电子书", "缩略图", "刮削", "元数据", "默认语言", "site"] },
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
              { id: "ai" as const, label: "AI 服务", icon: <Brain className="h-[18px] w-[18px]" />, desc: "模型、连接与用量", keywords: ["AI", "模型", "服务", "连接", "云端", "本地", "llama", "用量"] },
              { id: "scan-rules" as const, label: "扫描自动化", icon: <Wand2 className="h-[18px] w-[18px]" />, desc: "识别、归类与目录整理", keywords: ["扫描", "规则", "归类", "目录", "硬链接", "过滤", "scan", "rules"] },
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
  ];

  const allTabs = groups.flatMap((g) => g.tabs);
  const currentTab = allTabs.find((tab) => tab.id === activeTab);
  const isFullWidthTab = activeTab === "libraries";

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
      router.replace(`/settings?tab=${tabId}`);
      setSearchQuery("");
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
      {activeTab === "about" && <AboutPanel />}
    </div>
  );

  const searchResultTabs = filteredGroups.flatMap((group) =>
    group.tabs.map((tab) => ({ ...tab, groupTitle: group.title }))
  );

  const displayedPanel = searchQuery.trim() ? (
    <div className="max-w-2xl space-y-4">
      <div>
        <h2 className="text-base font-semibold text-foreground">搜索结果</h2>
        <p className="mt-1 text-sm text-muted">
          {searchResultTabs.length > 0
            ? `找到 ${searchResultTabs.length} 个相关设置分类`
            : `没有找到与“${searchQuery.trim()}”相关的设置`}
        </p>
      </div>
      {searchResultTabs.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {searchResultTabs.map((tab, index) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => switchTab(tab.id)}
              className={`flex min-h-16 w-full items-center gap-3 px-4 text-left transition-colors hover:bg-card-hover ${index > 0 ? "border-t border-border" : ""}`}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background text-accent">{tab.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-muted">{tab.groupTitle}</span>
                <span className="block text-sm font-medium text-foreground">{tab.label}</span>
                {tab.desc && <span className="block text-xs text-muted">{tab.desc}</span>}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted" />
            </button>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center text-sm text-muted">
          请尝试搜索“隐私”“缩略图”“权限”或“扫描”等具体功能。
        </div>
      )}
    </div>
  ) : activePanel;

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
    <>
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
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted" />
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
            <div className="p-4">{displayedPanel}</div>
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
            {displayedPanel}
          </div>
        </main>
      </div>
    </>
  );
}
/* ── Reader Preferences Panel ── */
function ReaderPreferencesPanel() {
  const { options, updateOptions, loaded } = useReaderOptions();
  const { locale, setLocale } = useLocale();
  const [resetConfirm, setResetConfirm] = useState(false);
  const [privacyEnabled, setPrivacyEnabled] = useState(() =>
    typeof window !== "undefined" && localStorage.getItem("privacy:enabled") === "true"
  );
  const [blurNSFW, setBlurNSFW] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("privacy:blurNSFW") !== "false";
  });

  // Derive UI state from real ReaderOptions
  const modeUI = options.infiniteScroll ? "webtoon" : options.mode;
  const directionUI = options.direction === "rtl" ? "rtl" : "ltr";
  const zoomUI = options.fitMode === "width" ? "fit-width" : options.fitMode === "height" ? "fit-height" : "original";

  const handleModeChange = (val: string) => {
    if (val === "webtoon") updateOptions({ mode: "webtoon", direction: "ttb", infiniteScroll: true });
    else updateOptions({ mode: val as "single" | "double", direction: options.direction === "rtl" ? "rtl" : "ltr", infiniteScroll: false });
  };

  const handleDirectionChange = (val: string) => {
    updateOptions({ direction: val === "rtl" ? "rtl" : "ltr" });
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

  const togglePrivacy = () => {
    const next = !privacyEnabled;
    setPrivacyEnabled(next);
    localStorage.setItem("privacy:enabled", String(next));
  };

  const toggleBlur = () => {
    const next = !blurNSFW;
    setBlurNSFW(next);
    localStorage.setItem("privacy:blurNSFW", String(next));
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
            <h2 className="text-base font-semibold text-foreground">阅读与显示</h2>
            <p className="text-xs text-muted">这些个人偏好会保存到当前浏览器，并在修改后立即生效。</p>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="divide-y divide-border/25">
          <div id="reader-mode" className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div>
              <div className="text-sm font-medium text-foreground">默认阅读模式</div>
              <div className="text-xs text-muted">选择单页、双页或长条滚动模式。</div>
            </div>
            <select value={modeUI} onChange={(e) => handleModeChange(e.target.value)} className="h-9 w-full rounded-lg border border-border/50 bg-card/60 px-3 text-sm outline-none focus:border-accent/40 sm:w-56">
              <option value="single">单页模式</option>
              <option value="double">双页模式</option>
              <option value="webtoon">长条滚动</option>
            </select>
          </div>

          {/* Direction */}
          <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div>
              <div className="text-sm font-medium text-foreground">默认阅读方向</div>
              <div className="text-xs text-muted">控制漫画翻页和小说排版的主要阅读流向。</div>
            </div>
            <select
              value={directionUI}
              disabled={modeUI === "webtoon"}
              onChange={(e) => handleDirectionChange(e.target.value)}
              className="h-9 w-full rounded-lg border border-border/50 bg-card/60 px-3 text-sm outline-none focus:border-accent/40 disabled:opacity-50 sm:w-56"
            >
              <option value="ltr">从左到右</option>
              <option value="rtl">从右到左</option>
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
                aria-label={item.label}
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

          <div id="display-language" className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div>
              <div className="text-sm font-medium text-foreground">界面语言</div>
              <div className="text-xs text-muted">只影响当前浏览器中的界面文字。</div>
            </div>
            <select value={locale} onChange={(e) => setLocale(e.target.value as "zh-CN" | "en")} className="h-9 w-full rounded-lg border border-border/50 bg-card/60 px-3 text-sm outline-none focus:border-accent/40 sm:w-56">
              <option value="zh-CN">中文</option>
              <option value="en">English</option>
            </select>
          </div>

          <div id="privacy-mode" className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div>
              <div className="text-sm font-medium text-foreground">隐私模式</div>
              <div className="text-xs text-muted">在书库中模糊成人内容封面。</div>
            </div>
            <button type="button" role="switch" aria-label="隐私模式" aria-checked={privacyEnabled} onClick={togglePrivacy} className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${privacyEnabled ? "bg-accent" : "bg-muted/40"}`}>
              <span aria-hidden className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${privacyEnabled ? "translate-x-5" : "translate-x-0"}`} />
            </button>
          </div>

          {privacyEnabled && (
            <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div>
                <div className="text-sm font-medium text-foreground">模糊成人封面</div>
                <div className="text-xs text-muted">匹配 R18 或 NSFW 标签的封面会被模糊。</div>
              </div>
              <button type="button" role="switch" aria-label="模糊成人封面" aria-checked={blurNSFW} onClick={toggleBlur} className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${blurNSFW ? "bg-accent" : "bg-muted/40"}`}>
                <span aria-hidden className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${blurNSFW ? "translate-x-5" : "translate-x-0"}`} />
              </button>
            </div>
          )}

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
/* ── About Panel ── */
/* ═══════════════════════════════════════════
   About Panel — 品牌展示卡 + 技术栈 + 社区与支持
   ═══════════════════════════════════════════ */
function AboutPanel() {
  const t = useTranslation();
  const feedbackEmail = "nowenlab@qq.com";
  const feedbackQqGroupNumber = "1093473044";
  const feedbackMailto = `mailto:${feedbackEmail}?subject=${encodeURIComponent("[NowenReader 反馈]")}`;
  const releaseUrl = "https://github.com/cropflre/nowen-reader/releases";
  const noteAssetRevision = "884f5bc7654fe5f5dced8c5207e36cbce11d1872";
  const noteAssetBase = `https://raw.githubusercontent.com/cropflre/nowen-note/${noteAssetRevision}/frontend/src/assets`;
  const communityQr = `${noteAssetBase}/community/nowen-lab-wechat.jpg`;
  const qqGroupQr = `${noteAssetBase}/feedback/qq-group.jpg`;
  const wechatSponsorQr = `${noteAssetBase}/sponsor/weixin.jpg`;
  const alipaySponsorQr = `${noteAssetBase}/sponsor/zhifubao.png`;
  const [showSponsor, setShowSponsor] = useState(false);
  const [versionInfo, setVersionInfo] = useState<{ version: string; uptime: string; runtime?: { go: string; os: string; arch: string; cpus: number; goroutines: number; memoryMB: number } } | null>(null);

  useEffect(() => {
    fetch(apiPath("/api/health"))
      .then((res) => {
        if (!res.ok) throw new Error(`health request failed: ${res.status}`);
        return res.json();
      })
      .then((data) => setVersionInfo(data))
      .catch((error) => {
        console.error("[AboutPanel] Failed to load version info:", error);
      });
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
            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent" title="当前版本">
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

      {/* Nowen 开源实验室 */}
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <Globe className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">Nowen 开源实验室</div>
            <div className="mt-0.5 text-xs leading-relaxed text-muted">扫码关注公众号，获取 Nowen 最新动态。</div>
          </div>
        </div>
        <img
          src={communityQr}
          alt="Nowen 开源实验室公众号二维码"
          className="h-28 w-28 self-center rounded-lg bg-white object-contain p-1 sm:self-auto"
          loading="lazy"
          draggable={false}
        />
      </div>

      {/* 更新日志 */}
      <a
        href={releaseUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex min-h-20 items-center justify-between gap-4 rounded-lg border border-border bg-card p-5 text-left transition-colors hover:border-accent/30 hover:bg-card-hover/50"
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">更新日志</div>
            <div className="mt-0.5 text-xs text-muted">查看本版新功能与历次修复</div>
          </div>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted transition-colors group-hover:text-accent">
          查看更新
          <ExternalLink className="h-3 w-3" />
        </span>
      </a>

      {/* 意见与 Bug 反馈 */}
      <a
        href={feedbackMailto}
        className="flex min-h-20 items-center justify-between gap-4 rounded-lg border border-border bg-card p-5 text-left transition-colors hover:border-accent/30 hover:bg-card-hover/50"
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-500">
            <Mail className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">意见与 Bug 反馈</div>
            <div className="mt-0.5 text-xs leading-relaxed text-muted">遇到问题或有功能建议，欢迎通过邮件联系我们。</div>
            <div className="mt-1 text-[11px] text-muted/70">{feedbackEmail}</div>
          </div>
        </div>
        <span className="shrink-0 text-xs text-muted">发送邮件</span>
      </a>

      {/* 加入 QQ 群反馈 */}
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-500">
            <Users className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">加入 QQ 群反馈</div>
            <div className="mt-0.5 text-xs leading-relaxed text-muted">扫码加入 nowen 开发群，也可搜索群号加入。</div>
            <div className="mt-1 text-xs font-medium text-foreground">QQ群：{feedbackQqGroupNumber}</div>
          </div>
        </div>
        <img
          src={qqGroupQr}
          alt={`Nowen 开发群 QQ 群 ${feedbackQqGroupNumber} 二维码`}
          className="h-28 w-28 self-center rounded-lg bg-white object-contain p-1 sm:self-auto"
          loading="lazy"
          draggable={false}
        />
      </div>

      {/* 支持作者 */}
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <button
          type="button"
          onClick={() => setShowSponsor((current) => !current)}
          aria-expanded={showSponsor}
          aria-controls="about-sponsor-codes"
          className="flex min-h-20 w-full items-center justify-between gap-4 p-5 text-left transition-colors hover:bg-card-hover/50"
        >
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rose-500/10 text-rose-500">
              <Heart className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">支持作者</div>
              <div className="mt-0.5 text-xs leading-relaxed text-muted">如果这个项目对你有帮助，欢迎请作者喝杯咖啡 ☕</div>
            </div>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted">
            {showSponsor ? "收起赞赏码" : "展开赞赏码"}
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showSponsor ? "rotate-180" : ""}`} />
          </span>
        </button>
        {showSponsor && (
          <div id="about-sponsor-codes" className="grid gap-4 border-t border-border/30 bg-background/30 p-5 sm:grid-cols-2">
            <div className="flex flex-col items-center gap-2 rounded-lg border border-border/50 bg-card p-3">
              <img
                src={wechatSponsorQr}
                alt="微信赞赏码"
                className="h-40 w-40 rounded-lg bg-white object-contain p-1"
                loading="lazy"
                draggable={false}
              />
              <span className="text-xs font-medium text-foreground">微信赞赏</span>
            </div>
            <div className="flex flex-col items-center gap-2 rounded-lg border border-border/50 bg-card p-3">
              <img
                src={alipaySponsorQr}
                alt="支付宝赞赏码"
                className="h-40 w-40 rounded-lg bg-white object-contain p-1"
                loading="lazy"
                draggable={false}
              />
              <span className="text-xs font-medium text-foreground">支付宝赞赏</span>
            </div>
          </div>
        )}
      </div>

      {/* Links */}
      <div className="flex flex-wrap items-center justify-center gap-4">
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