export interface ComicCategory {
  id: number;
  name: string;
  slug: string;
  icon: string;
}

export interface ComicFileLocation {
  libraryId: string;
  libraryName: string;
  filename: string;
  relativePath: string;
  relativeDir: string;
  baseName: string;
  format: string;
  editionLabel?: string;
  canDownload: boolean;
  canManage?: boolean;
  rootPath?: string;
  realDirPath?: string;
  absolutePath?: string;
  existsOnDisk?: boolean;
}

export interface ComicEditionInfo {
  comicId: string;
  title: string;
  format: string;
  editionLabel?: string;
  isCurrent: boolean;
  isFormatPrimary: boolean;
  isPreferred: boolean;
  detectionSource?: string;
  fileSize: number;
  pageCount: number;
  lastReadPage: number;
  lastReadAt: string | null;
  readingStatus: string;
  totalReadTime: number;
  readerUrl: string;
  downloadUrl?: string;
  fileLocation?: ComicFileLocation;
}

export interface Comic {
  id: string;
  title: string;
  titleSortKey?: string;
  coverUrl: string;
  coverAspectRatio?: number;
  tags: string[];
  tagData?: { name: string; color: string }[];
  categories?: ComicCategory[];
  author?: string;
  pageCount?: number;
  fileSize?: number;
  addedAt?: string;
  lastRead?: string;
  lastReadAt?: string | null;
  progress?: number; // 0-100
  isFavorite?: boolean;
  rating?: number; // 1-5
  lastReadPage?: number;
  sortOrder?: number;
  filename?: string;

  totalReadTime?: number; // seconds
  // Metadata fields
  publisher?: string;
  year?: number;
  description?: string;
  language?: string;
  genre?: string;
  metadataSource?: string;
  readingStatus?: string; // "want" | "reading" | "finished" | "shelved" | ""
  type?: string; // "comic" | "novel"

  // External rating from scraping sources
  externalRating?: number; // 外部评分原始分数
  externalRatingMax?: number; // 满分值（如 10, 100）
  externalRatingSource?: string; // 评分来源（"anilist", "bangumi"）
  externalRatingUpdatedAt?: string; // 评分更新时间

  // Library & Multi-format Editions
  libraryId?: string;
  comicCount?: number;
  canManage?: boolean;
  canDownload?: boolean;
  relativePath?: string;
  format?: string;
  editionLabel?: string;
  editionGroupId?: string;
  formats?: string[];
  editionCount?: number;
  preferredComicId?: string;
  fileLocation?: ComicFileLocation;
  editions?: ComicEditionInfo[];
}

export interface ReadingSessionData {
  id: number;
  comicId: string;
  comicTitle?: string;
  startedAt: string;
  endedAt: string | null;
  duration: number;
  startPage: number;
  endPage: number;
}

export interface ReadingStats {
  totalReadTime: number; // seconds
  totalSessions: number;
  totalComicsRead: number;
  recentSessions: ReadingSessionData[];
  dailyStats: { date: string; duration: number; sessions: number }[];
}
