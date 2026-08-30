/**
 * 小说阅读器 — 类型定义
 */

// 书签类型
export interface NovelBookmark {
  id: string;
  chapterIndex: number;
  chapterTitle: string;
  name: string;
  note: string;
  positionRatio: number;
  timestamp: number;
  updatedAt: number;
}

// 划线标注类型
export interface TextHighlight {
  id: string;
  chapterIndex: number;
  text: string;
  note?: string;
  color: string;
  timestamp: number;
}

// 全书搜索结果类型
export interface SearchResult {
  chapterIndex: number;
  chapterTitle: string;
  matchText: string; // 匹配的上下文片段
  matchCount: number;
}

export interface ChapterInfo {
  index: number;
  name: string;
  url: string;
  title?: string;
  level?: number;
  parentIndex?: number;
  hasChildren?: boolean;
}

export interface TextReaderViewProps {
  chapters: ChapterInfo[];
  currentPage: number;
  onPageChange: (page: number) => void;
  onTapCenter: () => void;
  readerTheme?: import("@/components/reader/ReaderToolbar").ReaderTheme;
  onShowTOCChange?: (show: boolean) => void;
  onShowSettingsChange?: (show: boolean) => void;
  externalShowTOC?: boolean;
  externalShowSettings?: boolean;
  comicId?: string;
}
