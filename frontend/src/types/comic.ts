export interface ComicCategory {
  id: number;
  name: string;
  slug: string;
  icon: string;
}

export interface Comic {
  id: string;
  title: string;
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
