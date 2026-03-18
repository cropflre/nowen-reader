"use client";

import { useState, useRef, useEffect, useCallback } from "react";
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
} from "lucide-react";
import { useTranslation } from "@/lib/i18n";
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

/* ── 类型 ── */
type SettingsTab =
  | "site"
  | "ai"
  | "stats"
  | "file-stats"
  | "logs"
  | "about";

interface TabDef {
  id: SettingsTab;
  label: string;
  icon: React.ReactNode;
  desc?: string;
}

interface TabGroup {
  title: string;
  tabs: TabDef[];
}

/* ── 主页面 ── */
export default function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslation();
  const validTabs: SettingsTab[] = ["site", "ai", "stats", "file-stats", "logs", "about"];
  const tabFromUrl = searchParams.get("tab") as SettingsTab | null;
  const [activeTab, setActiveTab] = useState<SettingsTab>(
    tabFromUrl && validTabs.includes(tabFromUrl) ? tabFromUrl : "site"
  );
  const mobileTabsRef = useRef<HTMLDivElement>(null);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [canScrollLeft, setCanScrollLeft] = useState(false);

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

  /* ── Tab 定义（分组） ── */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tAny = t as any;
  const groups: TabGroup[] = [
    {
      title: t.settings?.groupGeneral || "通用",
      tabs: [
        { id: "site", label: t.siteSettings?.tab || "站点设置", icon: <Globe className="h-[18px] w-[18px]" />, desc: "名称、目录、缓存" },
        { id: "ai", label: t.ai?.title || "AI 功能", icon: <Brain className="h-[18px] w-[18px]" />, desc: "智能识别与推荐" },
      ],
    },
    {
      title: t.settings?.groupData || "数据",
      tabs: [
        { id: "stats", label: t.stats?.title || "阅读统计", icon: <BarChart3 className="h-[18px] w-[18px]" />, desc: "时长、趋势、目标" },
        { id: "file-stats", label: "文件统计", icon: <HardDrive className="h-[18px] w-[18px]" />, desc: "格式、大小、分布" },
        { id: "logs", label: tAny.errorLogs?.title || "错误日志", icon: <AlertTriangle className="h-[18px] w-[18px]" />, desc: "接口异常记录" },
        { id: "about", label: t.settings?.about || "关于", icon: <Info className="h-[18px] w-[18px]" />, desc: t.settings?.aboutDesc || "版本与项目信息" },
      ],
    },
  ];

  const allTabs = groups.flatMap((g) => g.tabs);
  const currentTab = allTabs.find((tab) => tab.id === activeTab);
  const isFullWidthTab = ["stats", "file-stats", "logs"].includes(activeTab);

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
            {/* 面包屑分隔 + 当前 tab 名 */}
            <span className="hidden sm:inline text-muted/40 text-sm">/</span>
            <span className="hidden sm:inline text-sm text-muted truncate">
              {currentTab?.label}
            </span>
          </div>
        </div>
      </header>

      {/* ═══════════ Mobile Tab Bar ═══════════ */}
      <div className="sm:hidden border-b border-border/40 bg-background/60 backdrop-blur-xl relative">
        {canScrollLeft && (
          <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-8 z-10 bg-gradient-to-r from-background to-transparent" />
        )}
        {canScrollRight && (
          <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 z-10 bg-gradient-to-l from-background to-transparent" />
        )}
        <div
          ref={mobileTabsRef}
          className="flex px-2 py-2 gap-1 overflow-x-auto scrollbar-hide"
        >
          {allTabs.map((tab) => (
            <button
              key={tab.id}
              data-active={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
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
      </div>

      {/* ═══════════ Main Layout ═══════════ */}
      <div className={`mx-auto flex ${isFullWidthTab ? "max-w-[1800px]" : "max-w-5xl"} transition-all duration-300`}>

        {/* ── Desktop Sidebar ── */}
        <aside className="hidden sm:flex flex-col w-56 flex-shrink-0 border-r border-border/40 sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto p-3 gap-1">
          {groups.map((group, gi) => (
            <div key={gi} className={gi > 0 ? "mt-4" : ""}>
              {/* 分组标题 */}
              <div className="flex items-center gap-2 px-3 mb-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted/60">
                  {group.title}
                </span>
                <div className="flex-1 h-px bg-border/30" />
              </div>
              {/* Tab 按钮 */}
              {group.tabs.map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all duration-200 ${
                      isActive
                        ? "bg-accent/10 text-accent"
                        : "text-muted hover:bg-card-hover hover:text-foreground"
                    }`}
                  >
                    {/* 左侧高亮条 */}
                    {isActive && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-accent" />
                    )}
                    <span className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors duration-200 ${
                      isActive
                        ? "bg-accent/15 text-accent"
                        : "bg-card text-muted group-hover:bg-card-hover group-hover:text-foreground"
                    }`}>
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
        </aside>

        {/* ── Content Area ── */}
        <main className="flex-1 min-h-[calc(100vh-4rem)] min-w-0">
          <div className={`p-4 sm:p-8 ${isFullWidthTab ? "" : "max-w-3xl"}`}>
            {activeTab === "site" && <SiteSettingsPanel />}
            {activeTab === "ai" && <AISettingsPanel />}
            {activeTab === "stats" && <StatsPanel />}
            {activeTab === "file-stats" && <FileStatsPanel />}
            {activeTab === "logs" && <LogsPanel />}
            {activeTab === "about" && <AboutPanel />}
          </div>
        </main>
      </div>
    </div>
  );
}

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
    { icon: <FileText className="h-4 w-4" />, label: "Comics", value: "ZIP/CBZ/RAR/CBR/7Z/PDF" },
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
