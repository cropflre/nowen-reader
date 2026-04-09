/**
 * 小说阅读器 — 主题色卡配置
 */

import type { ReaderTheme } from "@/components/reader/ReaderToolbar";

// ============ 主题色卡配置 ============
export interface ThemeColors {
  bg: string;
  text: string;
  titleText: string;
  contentText: string;
  headerBg: string;
  headerText: string;
  hoverBg: string;
  navBtnBg: string;
  navBtnText: string;
  navBtnHoverBg: string;
  statusBarBg: string;
  statusBarText: string;
  settingsBg: string;
  settingsText: string;
  settingsLabel: string;
  settingsBtnBg: string;
  settingsBtnText: string;
  settingsBtnHoverBg: string;
  activeRing: string;
  tocBg: string;
  tocText: string;
  tocHoverBg: string;
  tocActiveText: string;
  tocActiveBg: string;
  epubCodeBg: string;
  epubBorderColor: string;
  isDark: boolean;
}

export const themeColorMap: Record<string, ThemeColors> = {
  night: {
    bg: "bg-zinc-900", text: "text-zinc-200", titleText: "text-zinc-100",
    contentText: "text-zinc-300", headerBg: "bg-zinc-800/80", headerText: "text-zinc-400",
    hoverBg: "hover:bg-zinc-700", navBtnBg: "bg-zinc-800", navBtnText: "text-zinc-300",
    navBtnHoverBg: "hover:bg-zinc-700", statusBarBg: "bg-zinc-900/60",
    statusBarText: "text-zinc-500", settingsBg: "bg-zinc-800", settingsText: "text-zinc-200",
    settingsLabel: "text-zinc-400", settingsBtnBg: "bg-zinc-700", settingsBtnText: "text-zinc-300",
    settingsBtnHoverBg: "hover:bg-zinc-600", activeRing: "ring-accent/40",
    tocBg: "bg-zinc-900", tocText: "text-zinc-400", tocHoverBg: "hover:bg-zinc-800",
    tocActiveText: "text-accent", tocActiveBg: "bg-accent/20",
    epubCodeBg: "rgba(255,255,255,0.05)", epubBorderColor: "rgba(255,255,255,0.15)",
    isDark: true,
  },
  day: {
    bg: "bg-amber-50", text: "text-zinc-800", titleText: "text-zinc-800",
    contentText: "text-zinc-700", headerBg: "bg-amber-100/80", headerText: "text-zinc-500",
    hoverBg: "hover:bg-amber-200", navBtnBg: "bg-amber-100", navBtnText: "text-zinc-600",
    navBtnHoverBg: "hover:bg-amber-200", statusBarBg: "bg-amber-50/60",
    statusBarText: "text-zinc-400", settingsBg: "bg-white", settingsText: "text-zinc-700",
    settingsLabel: "text-zinc-500", settingsBtnBg: "bg-zinc-100", settingsBtnText: "text-zinc-600",
    settingsBtnHoverBg: "hover:bg-zinc-200", activeRing: "ring-accent/30",
    tocBg: "bg-white", tocText: "text-zinc-600", tocHoverBg: "hover:bg-zinc-100",
    tocActiveText: "text-accent", tocActiveBg: "bg-accent/10",
    epubCodeBg: "rgba(0,0,0,0.05)", epubBorderColor: "rgba(0,0,0,0.15)",
    isDark: false,
  },
  green: {
    bg: "bg-[#C7EDCC]", text: "text-zinc-800", titleText: "text-zinc-800",
    contentText: "text-zinc-700", headerBg: "bg-[#b5e0ba]/80", headerText: "text-zinc-600",
    hoverBg: "hover:bg-[#a8d4ad]", navBtnBg: "bg-[#b5e0ba]", navBtnText: "text-zinc-600",
    navBtnHoverBg: "hover:bg-[#a8d4ad]", statusBarBg: "bg-[#C7EDCC]/60",
    statusBarText: "text-zinc-500", settingsBg: "bg-[#d8f0db]", settingsText: "text-zinc-700",
    settingsLabel: "text-zinc-500", settingsBtnBg: "bg-[#b5e0ba]", settingsBtnText: "text-zinc-600",
    settingsBtnHoverBg: "hover:bg-[#a8d4ad]", activeRing: "ring-green-600/40",
    tocBg: "bg-[#d8f0db]", tocText: "text-zinc-600", tocHoverBg: "hover:bg-[#c0e4c5]",
    tocActiveText: "text-green-700", tocActiveBg: "bg-green-500/20",
    epubCodeBg: "rgba(0,0,0,0.04)", epubBorderColor: "rgba(0,0,0,0.12)",
    isDark: false,
  },
  gray: {
    bg: "bg-[#E0E0E0]", text: "text-zinc-800", titleText: "text-zinc-800",
    contentText: "text-zinc-700", headerBg: "bg-[#d0d0d0]/80", headerText: "text-zinc-600",
    hoverBg: "hover:bg-[#c8c8c8]", navBtnBg: "bg-[#d0d0d0]", navBtnText: "text-zinc-600",
    navBtnHoverBg: "hover:bg-[#c8c8c8]", statusBarBg: "bg-[#E0E0E0]/60",
    statusBarText: "text-zinc-500", settingsBg: "bg-[#eaeaea]", settingsText: "text-zinc-700",
    settingsLabel: "text-zinc-500", settingsBtnBg: "bg-[#d0d0d0]", settingsBtnText: "text-zinc-600",
    settingsBtnHoverBg: "hover:bg-[#c8c8c8]", activeRing: "ring-zinc-600/40",
    tocBg: "bg-[#eaeaea]", tocText: "text-zinc-600", tocHoverBg: "hover:bg-[#d4d4d4]",
    tocActiveText: "text-zinc-800", tocActiveBg: "bg-zinc-500/20",
    epubCodeBg: "rgba(0,0,0,0.04)", epubBorderColor: "rgba(0,0,0,0.12)",
    isDark: false,
  },
  white: {
    bg: "bg-white", text: "text-zinc-900", titleText: "text-zinc-900",
    contentText: "text-zinc-800", headerBg: "bg-zinc-100/80", headerText: "text-zinc-500",
    hoverBg: "hover:bg-zinc-200", navBtnBg: "bg-zinc-100", navBtnText: "text-zinc-700",
    navBtnHoverBg: "hover:bg-zinc-200", statusBarBg: "bg-white/60",
    statusBarText: "text-zinc-400", settingsBg: "bg-white", settingsText: "text-zinc-700",
    settingsLabel: "text-zinc-500", settingsBtnBg: "bg-zinc-100", settingsBtnText: "text-zinc-600",
    settingsBtnHoverBg: "hover:bg-zinc-200", activeRing: "ring-accent/30",
    tocBg: "bg-white", tocText: "text-zinc-600", tocHoverBg: "hover:bg-zinc-100",
    tocActiveText: "text-accent", tocActiveBg: "bg-accent/10",
    epubCodeBg: "rgba(0,0,0,0.04)", epubBorderColor: "rgba(0,0,0,0.12)",
    isDark: false,
  },
};

// 主题色卡预览色（用于设置面板选择器）
export const themePreviewColorKeys: Record<string, { bg: string; labelKey: string }> = {
  night: { bg: "#18181b", labelKey: "themeNight" },
  day: { bg: "#fffbeb", labelKey: "themeDay" },
  green: { bg: "#C7EDCC", labelKey: "themeGreen" },
  gray: { bg: "#E0E0E0", labelKey: "themeGray" },
  white: { bg: "#ffffff", labelKey: "themeWhite" },
};

// 页边距档位
export const paddingOptions = [
  { value: "compact", labelKey: "marginCompact" as const, class: "px-2 sm:px-4 md:px-8" },
  { value: "standard", labelKey: "marginStandard" as const, class: "px-4 sm:px-8 md:px-16 lg:px-32" },
  { value: "wide", labelKey: "marginWide" as const, class: "px-8 sm:px-16 md:px-24 lg:px-40" },
];

// 翻页模式
export type PageMode = "scroll" | "swipe";
export const pageModeOptions = [
  { value: "scroll" as PageMode, labelKey: "pageModeScroll" as const },
  { value: "swipe" as PageMode, labelKey: "pageModeSwipe" as const },
];

// 书签类型
interface NovelBookmark {
  chapterIndex: number;
  chapterTitle: string;
  timestamp: number;
}

// 划线标注类型
interface TextHighlight {
  id: string;
  chapterIndex: number;
  text: string;
  note?: string;
  color: string;
  timestamp: number;
}

// 全书搜索结果类型
interface SearchResult {
  chapterIndex: number;
  chapterTitle: string;
  matchText: string; // 匹配的上下文片段
  matchCount: number;
}

interface ChapterInfo {
  index: number;
  name: string;
  url: string;
  title?: string;
}

interface TextReaderViewProps {
  chapters: ChapterInfo[];
  currentPage: number;
  onPageChange: (page: number) => void;
  onTapCenter: () => void;
  readerTheme?: ReaderTheme;
  onShowTOCChange?: (show: boolean) => void;
  onShowSettingsChange?: (show: boolean) => void;
  externalShowTOC?: boolean;
  externalShowSettings?: boolean;
  comicId?: string;
}

