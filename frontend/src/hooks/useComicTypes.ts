/**
 * 漫画相关的共享类型定义
 * 被所有 useComic*.ts hooks 和 api/comics.ts 共用
 */

export interface ApiComicTag {
  name: string;
  color: string;
}

export interface ApiComic {
  id: string;
  title: string;
  filename: string;
  pageCount: number;
  fileSize: number;
  addedAt: string;
  lastReadPage: number;
  lastReadAt: string | null;
  isFavorite: boolean;
  rating: number | null;
  coverUrl: string;
  coverAspectRatio: number;
  sortOrder: number;
  totalReadTime: number;
  tags: ApiComicTag[];
  categories: { id: number; name: string; slug: string; icon: string }[];
  // 元数据字段
  author: string;
  publisher: string;
  year: number | null;
  description: string;
  language: string;
  genre: string;
  metadataSource: string;
  type: string; // 内容类型："comic" | "novel"
}

export interface ComicsResponse {
  comics: ApiComic[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ApiCategory {
  id: number;
  name: string;
  slug: string;
  icon: string;
  count: number;
}

// ============================================================
// Comic Groups (自定义合并分组)
// ============================================================

export interface ComicGroup {
  id: number;
  name: string;
  coverUrl: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  comicCount: number;
}

export interface GroupComicItem {
  id: string;
  filename: string;
  title: string;
  pageCount: number;
  fileSize: number;
  lastReadPage: number;
  totalReadTime: number;
  coverUrl: string;
  sortIndex: number;
  readingStatus: string;
  lastReadAt: string | null;
}

export interface ComicGroupDetail {
  id: number;
  name: string;
  coverUrl: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  comicCount: number;
  comics: GroupComicItem[];
}

export interface AutoDetectGroup {
  name: string;
  comicIds: string[];
  titles: string[];
  reason?: string;  // AI 分析理由
  source?: "local" | "ai"; // 检测来源
}
