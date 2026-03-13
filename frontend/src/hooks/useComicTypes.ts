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
  seriesName: string;
  seriesIndex: number | null;
  genre: string;
  metadataSource: string;
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
