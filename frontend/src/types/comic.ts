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
  tags: string[];
  tagData?: { name: string; color: string }[];
  categories?: ComicCategory[];
  author?: string;
  pageCount?: number;
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
  seriesName?: string;
  seriesIndex?: number;
  genre?: string;
  metadataSource?: string;
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
