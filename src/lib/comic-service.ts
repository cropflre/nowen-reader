import { prisma } from "./db";
import { invalidateComicCaches, filenameToId, filenameToTitle } from "./comic-parser";
import { getAllComicsDirs, SUPPORTED_EXTENSIONS } from "./config";
import {
  createArchiveReader,
  getImageEntriesFromArchive,
  getPdfPageCount,
} from "./archive-parser";
import path from "path";
import { promises as fsp } from "fs";

/**
 * 封面 URL: 纯路径，不带版本号参数。
 * 缩略图 API 已支持 ETag + 304，浏览器自动处理缓存。
 */
function getCoverUrl(comicId: string): string {
  return `/api/comics/${comicId}/thumbnail`;
}

// ============================================================
// Utility: chunk array for batched operations
// ============================================================

function chunkArray<T>(array: T[], size: number): T[][] {
  const chunked: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunked.push(array.slice(i, i + size));
  }
  return chunked;
}

/** Yield event loop control — prevents blocking the main thread */
function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

// ============================================================
// Sync state
// ============================================================

let syncInProgress = false;
let lastSyncTime = 0;
const SYNC_COOLDOWN = 30_000; // minimum 30s between quick syncs

/** Track directory mtimes to detect changes quickly */
let lastDirMtimes = new Map<string, number>();

/** Async directory change detection — no fs.*Sync */
async function directoriesChanged(): Promise<boolean> {
  const allDirs = getAllComicsDirs();
  for (const dir of allDirs) {
    try {
      const stat = await fsp.stat(dir);
      const mtime = stat.mtimeMs;
      const lastMtime = lastDirMtimes.get(dir);
      if (lastMtime === undefined || lastMtime !== mtime) {
        return true;
      }
    } catch {
      // directory doesn't exist or inaccessible — skip
    }
  }
  return false;
}

async function updateDirMtimes() {
  const allDirs = getAllComicsDirs();
  const newMap = new Map<string, number>();
  for (const dir of allDirs) {
    try {
      const stat = await fsp.stat(dir);
      newMap.set(dir, stat.mtimeMs);
    } catch {
      // skip
    }
  }
  lastDirMtimes = newMap;
}

// ============================================================
// Quick sync: async + batched, no archive opening
// ============================================================

/** Concurrency limit for fs.stat calls to prevent EMFILE */
const STAT_BATCH_SIZE = 100;
/** Batch size for Prisma createMany / deleteMany */
const DB_BATCH_SIZE = 500;

async function quickSync() {
  const allDirs = getAllComicsDirs();

  const filesOnDisk: { id: string; filename: string; title: string; fileSize: number }[] = [];

  for (const dir of allDirs) {
    // Async readdir — no blocking
    let files: string[];
    try {
      files = await fsp.readdir(dir);
    } catch {
      continue; // directory doesn't exist
    }

    const validFiles = files.filter((f) =>
      SUPPORTED_EXTENSIONS.includes(path.extname(f).toLowerCase())
    );

    // Batched async stat — limit concurrency to prevent EMFILE
    const fileChunks = chunkArray(validFiles, STAT_BATCH_SIZE);
    for (const chunk of fileChunks) {
      await Promise.all(
        chunk.map(async (file) => {
          try {
            const stat = await fsp.stat(path.join(dir, file));
            filesOnDisk.push({
              id: filenameToId(file),
              filename: file,
              title: filenameToTitle(file),
              fileSize: stat.size,
            });
          } catch { /* skip unreadable files */ }
        })
      );
      // Yield event loop between batches
      await yieldEventLoop();
    }
  }

  const fileMap = new Map(filesOnDisk.map((f) => [f.id, f]));
  // Only select id from DB — minimal memory
  const dbComics = await prisma.comic.findMany({ select: { id: true } });
  const dbSet = new Set(dbComics.map((c) => c.id));

  // Add new comics in batches (pageCount=0, filled by fullSync later)
  const toAdd = filesOnDisk.filter((f) => !dbSet.has(f.id));
  if (toAdd.length > 0) {
    const addChunks = chunkArray(toAdd, DB_BATCH_SIZE);
    for (const chunk of addChunks) {
      await prisma.comic.createMany({
        data: chunk.map((f) => ({
          id: f.id,
          filename: f.filename,
          title: f.title,
          pageCount: 0,
          fileSize: f.fileSize,
        })),
        skipDuplicates: true,
      });
      await yieldEventLoop();
    }
  }

  // Remove stale entries in batches
  const fileIdSet = new Set(filesOnDisk.map((f) => f.id));
  const toRemove = dbComics.filter((c) => !fileIdSet.has(c.id));
  if (toRemove.length > 0) {
    const removeChunks = chunkArray(toRemove, DB_BATCH_SIZE);
    for (const chunk of removeChunks) {
      await prisma.comic.deleteMany({
        where: { id: { in: chunk.map((c) => c.id) } },
      });
      await yieldEventLoop();
    }
  }

  if (toAdd.length > 0 || toRemove.length > 0) {
    console.log(`[quick-sync] Added ${toAdd.length}, removed ${toRemove.length}`);
  }
  return { added: toAdd.length, removed: toRemove.length };
}

// ============================================================
// Full sync: incremental queue — processes N comics per tick
// ============================================================

/** Number of archives to process per fullSync tick */
const FULL_SYNC_BATCH_SIZE = 50;
/** Pause between each archive to yield CPU */
const FULL_SYNC_YIELD_MS = 30;

/**
 * Full sync: incrementally processes comics with pageCount=0.
 * Each invocation handles at most FULL_SYNC_BATCH_SIZE archives,
 * yielding the event loop between each one.
 * Called repeatedly by the background scheduler until all are done.
 */
async function fullSync() {
  // Find comics that still need page count calculation
  const comicsToProcess = await prisma.comic.findMany({
    where: { pageCount: 0 },
    select: { id: true, filename: true },
    take: FULL_SYNC_BATCH_SIZE,
  });

  if (comicsToProcess.length === 0) return;

  const allDirs = getAllComicsDirs();

  let processed = 0;
  for (const dbComic of comicsToProcess) {
    // Find the file on disk
    let filepath: string | null = null;
    for (const dir of allDirs) {
      const candidate = path.join(dir, dbComic.filename);
      try {
        await fsp.access(candidate);
        filepath = candidate;
        break;
      } catch { /* not in this dir */ }
    }

    if (!filepath) continue;

    try {
      let pageCount = 0;
      const ext = path.extname(dbComic.filename).toLowerCase();

      if (ext === ".pdf") {
        pageCount = await getPdfPageCount(filepath);
      } else {
        const reader = await createArchiveReader(filepath);
        if (reader) {
          try {
            const images = getImageEntriesFromArchive(reader);
            pageCount = images.length;
          } finally {
            reader.close();
          }
        }
      }

      if (pageCount > 0) {
        await prisma.comic.update({
          where: { id: dbComic.id },
          data: { pageCount },
        });
        processed++;
      }
    } catch (err) {
      console.error(`[full-sync] Failed to parse ${dbComic.filename}:`, err);
      // Mark with pageCount=-1 to avoid retrying broken files forever
      await prisma.comic.update({
        where: { id: dbComic.id },
        data: { pageCount: -1 },
      }).catch(() => {});
    }

    // Yield CPU between each archive to keep API responsive
    await new Promise((res) => setTimeout(res, FULL_SYNC_YIELD_MS));
  }

  if (processed > 0) {
    invalidateComicCaches();
    console.log(`[full-sync] Processed ${processed}/${comicsToProcess.length} archives`);
  }
}

// ============================================================
// Main sync orchestrator
// ============================================================

export async function syncComicsToDatabase() {
  const now = Date.now();

  // Skip if a sync was done recently
  if (now - lastSyncTime < SYNC_COOLDOWN) return;

  // Skip if already running
  if (syncInProgress) return;

  // Quick check: if directories haven't changed, skip sync entirely
  if (lastSyncTime > 0 && !(await directoriesChanged())) {
    lastSyncTime = now;
    return;
  }

  syncInProgress = true;
  lastSyncTime = now;

  try {
    await quickSync();
    await updateDirMtimes();
  } catch (err) {
    console.error("[sync] Quick sync failed:", err);
  } finally {
    syncInProgress = false;
  }
}

// ============================================================
// Background sync scheduler
// ============================================================

let bgSyncStarted = false;
/** Quick sync interval — checks for new/removed files */
const BG_QUICK_SYNC_INTERVAL = 60_000; // 60 seconds
/** Full sync interval — processes archives for page counts */
const BG_FULL_SYNC_INTERVAL = 10_000; // 10 seconds (processes up to 50 per tick)

export function ensureBackgroundSync() {
  if (bgSyncStarted) return;
  bgSyncStarted = true;

  // Initial quick sync on startup
  syncComicsToDatabase().catch((err) =>
    console.error("[bg-sync] Initial sync failed:", err)
  );

  // Periodic quick sync (detect file changes)
  setInterval(() => {
    syncComicsToDatabase().catch((err) =>
      console.error("[bg-sync] Quick sync failed:", err)
    );
  }, BG_QUICK_SYNC_INTERVAL);

  // Periodic full sync (incremental page count processing)
  setInterval(() => {
    fullSync().catch((err) =>
      console.error("[bg-sync] Full sync failed:", err)
    );
  }, BG_FULL_SYNC_INTERVAL);
}

// Auto-start background sync when this module is first imported on the server
if (typeof process !== "undefined" && typeof window === "undefined") {
  ensureBackgroundSync();
}

/**
 * Get all comics with their tags
 */
export async function getAllComics(options?: {
  search?: string;
  tags?: string[];
  favoritesOnly?: boolean;
  sortBy?: "title" | "addedAt" | "lastReadAt" | "rating" | "custom";
  sortOrder?: "asc" | "desc";
  page?: number;
  pageSize?: number;
  category?: string;
}) {
  const { search, tags, favoritesOnly, sortBy = "title", sortOrder = "asc", page, pageSize, category } = options || {};

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};

  if (search) {
    where.OR = [
      { title: { contains: search } },
      { author: { contains: search } },
      { filename: { contains: search } },
    ];
  }

  if (favoritesOnly) {
    where.isFavorite = true;
  }

  if (tags && tags.length > 0) {
    where.tags = {
      some: {
        tag: {
          name: { in: tags },
        },
      },
    };
  }

  if (category) {
    if (category === "uncategorized") {
      where.categories = { none: {} };
    } else {
      where.categories = {
        some: {
          category: {
            slug: category,
          },
        },
      };
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orderBy: any = {};
  const dbSortField = sortBy === "custom" ? "sortOrder" : sortBy;
  orderBy[dbSortField] = sortOrder;

  // Build pagination options
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const findOptions: any = {
    where,
    orderBy,
    select: {
      id: true,
      filename: true,
      title: true,
      pageCount: true,
      fileSize: true,
      addedAt: true,
      updatedAt: true,
      lastReadPage: true,
      lastReadAt: true,
      isFavorite: true,
      rating: true,
      sortOrder: true,
      totalReadTime: true,
      author: true,
      publisher: true,
      year: true,
      description: true,
      language: true,
      seriesName: true,
      seriesIndex: true,
      genre: true,
      metadataSource: true,
      tags: {
        select: {
          tag: { select: { name: true, color: true } },
        },
      },
      categories: {
        select: {
          category: { select: { id: true, name: true, slug: true, icon: true } },
        },
      },
    },
  };

  if (page && pageSize) {
    findOptions.skip = (page - 1) * pageSize;
    findOptions.take = pageSize;
  }

  // Execute count and findMany in parallel
  const [total, comics] = await Promise.all([
    prisma.comic.count({ where }),
    prisma.comic.findMany(findOptions),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = comics.map((c: any) => ({
    id: c.id,
    filename: c.filename,
    title: c.title,
    pageCount: c.pageCount,
    fileSize: c.fileSize,
    addedAt: c.addedAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    lastReadPage: c.lastReadPage,
    lastReadAt: c.lastReadAt?.toISOString() || null,
    isFavorite: c.isFavorite,
    rating: c.rating,
    sortOrder: c.sortOrder,
    totalReadTime: c.totalReadTime,
    coverUrl: getCoverUrl(c.id),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tags: c.tags.map((ct: any) => ({ name: ct.tag.name, color: ct.tag.color })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    categories: c.categories.map((cc: any) => ({ id: cc.category.id, name: cc.category.name, slug: cc.category.slug, icon: cc.category.icon })),
    author: c.author,
    publisher: c.publisher,
    year: c.year,
    description: c.description,
    language: c.language,
    seriesName: c.seriesName,
    seriesIndex: c.seriesIndex,
    genre: c.genre,
    metadataSource: c.metadataSource,
  }));

  return {
    comics: items,
    total,
    page: page || 1,
    pageSize: pageSize || total,
    totalPages: pageSize ? Math.ceil(total / pageSize) : 1,
  };
}

/**
 * Get a single comic by ID
 */
export async function getComicById(id: string) {
  const comic = await prisma.comic.findUnique({
    where: { id },
    include: {
      tags: {
        include: { tag: true },
      },
      categories: {
        include: { category: true },
      },
    },
  });

  if (!comic) return null;

  return {
    id: comic.id,
    filename: comic.filename,
    title: comic.title,
    pageCount: comic.pageCount,
    fileSize: comic.fileSize,
    addedAt: comic.addedAt.toISOString(),
    lastReadPage: comic.lastReadPage,
    lastReadAt: comic.lastReadAt?.toISOString() || null,
    isFavorite: comic.isFavorite,
    rating: comic.rating,
    sortOrder: comic.sortOrder,
    totalReadTime: comic.totalReadTime,
    tags: comic.tags.map((ct) => ({ name: ct.tag.name, color: ct.tag.color })),
    categories: comic.categories.map((cc) => ({ id: cc.category.id, name: cc.category.name, slug: cc.category.slug, icon: cc.category.icon })),
    author: comic.author,
    publisher: comic.publisher,
    year: comic.year,
    description: comic.description,
    language: comic.language,
    seriesName: comic.seriesName,
    seriesIndex: comic.seriesIndex,
    genre: comic.genre,
    metadataSource: comic.metadataSource,
  };
}

/**
 * Update reading progress
 */
export async function updateReadingProgress(comicId: string, page: number) {
  return prisma.comic.update({
    where: { id: comicId },
    data: {
      lastReadPage: page,
      lastReadAt: new Date(),
    },
  });
}

/**
 * Toggle favorite status
 */
export async function toggleFavorite(comicId: string) {
  const comic = await prisma.comic.findUnique({ where: { id: comicId } });
  if (!comic) return null;

  return prisma.comic.update({
    where: { id: comicId },
    data: { isFavorite: !comic.isFavorite },
  });
}

/**
 * Update rating
 */
export async function updateRating(comicId: string, rating: number | null) {
  return prisma.comic.update({
    where: { id: comicId },
    data: { rating },
  });
}

/**
 * Add tags to a comic
 */
export async function addTagsToComic(comicId: string, tagNames: string[]) {
  for (const name of tagNames) {
    // Upsert tag
    const tag = await prisma.tag.upsert({
      where: { name },
      create: { name },
      update: {},
    });

    // Link to comic (ignore if already linked)
    await prisma.comicTag.upsert({
      where: { comicId_tagId: { comicId, tagId: tag.id } },
      create: { comicId, tagId: tag.id },
      update: {},
    });
  }
}

/**
 * Remove a tag from a comic
 */
export async function removeTagFromComic(comicId: string, tagName: string) {
  const tag = await prisma.tag.findUnique({ where: { name: tagName } });
  if (!tag) return;

  await prisma.comicTag.deleteMany({
    where: { comicId, tagId: tag.id },
  });

  // Clean up orphan tags (use try-catch to handle concurrent deletion race condition)
  const usageCount = await prisma.comicTag.count({ where: { tagId: tag.id } });
  if (usageCount === 0) {
    try {
      await prisma.tag.delete({ where: { id: tag.id } });
    } catch (err: unknown) {
      // P2025: record not found — another concurrent request already deleted it
      if (err && typeof err === "object" && "code" in err && err.code === "P2025") {
        // Silently ignore — tag was already cleaned up
      } else {
        throw err;
      }
    }
  }
}

/**
 * Get all unique tags
 */
export async function getAllTags() {
  const tags = await prisma.tag.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: {
        select: { comics: true },
      },
    },
  });

  return tags.map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    count: t._count.comics,
  }));
}

/**
 * Update tag color
 */
export async function updateTagColor(tagName: string, color: string) {
  return prisma.tag.update({
    where: { name: tagName },
    data: { color },
  });
}

// ============================================================
// Batch Operations
// ============================================================

/**
 * Batch delete comics
 */
export async function batchDeleteComics(comicIds: string[]) {
  // Delete related data first (cascade should handle, but be explicit)
  await prisma.comicTag.deleteMany({
    where: { comicId: { in: comicIds } },
  });
  await prisma.readingSession.deleteMany({
    where: { comicId: { in: comicIds } },
  });
  return prisma.comic.deleteMany({
    where: { id: { in: comicIds } },
  });
}

/**
 * Batch toggle favorite
 */
export async function batchSetFavorite(comicIds: string[], isFavorite: boolean) {
  return prisma.comic.updateMany({
    where: { id: { in: comicIds } },
    data: { isFavorite },
  });
}

/**
 * Batch add tags
 */
export async function batchAddTags(comicIds: string[], tagNames: string[]) {
  // First upsert all tags
  const tags = [];
  for (const name of tagNames) {
    const tag = await prisma.tag.upsert({
      where: { name },
      create: { name },
      update: {},
    });
    tags.push(tag);
  }

  // Then batch link all comics to tags in a transaction
  const upserts = [];
  for (const tag of tags) {
    for (const comicId of comicIds) {
      upserts.push(
        prisma.comicTag.upsert({
          where: { comicId_tagId: { comicId, tagId: tag.id } },
          create: { comicId, tagId: tag.id },
          update: {},
        })
      );
    }
  }
  if (upserts.length > 0) {
    await prisma.$transaction(upserts);
  }
}


// ============================================================
// Reading Statistics
// ============================================================

/**
 * Start a reading session
 */
export async function startReadingSession(comicId: string, startPage: number) {
  return prisma.readingSession.create({
    data: {
      comicId,
      startPage,
      startedAt: new Date(),
    },
  });
}

/**
 * End a reading session
 */
export async function endReadingSession(sessionId: number, endPage: number, duration: number) {
  // Update the session
  const session = await prisma.readingSession.update({
    where: { id: sessionId },
    data: {
      endedAt: new Date(),
      endPage,
      duration,
    },
  });

  // Update total read time on comic
  await prisma.comic.update({
    where: { id: session.comicId },
    data: {
      totalReadTime: { increment: duration },
    },
  });

  return session;
}

/**
 * Get reading statistics (optimized: uses aggregate queries instead of fetching all sessions)
 */
export async function getReadingStats() {
  // Recent sessions (for display)
  const sessions = await prisma.readingSession.findMany({
    orderBy: { startedAt: "desc" },
    take: 50,
    include: {
      comic: { select: { title: true } },
    },
  });

  // Aggregate total stats using DB-level aggregation
  const [totalAgg, totalComicsRead] = await Promise.all([
    prisma.readingSession.aggregate({
      _sum: { duration: true },
      _count: true,
    }),
    prisma.readingSession.groupBy({
      by: ["comicId"],
    }),
  ]);

  const totalReadTime = totalAgg._sum.duration || 0;
  const totalSessions = totalAgg._count;

  // Daily stats (last 30 days) — only fetch recent sessions
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const recentSessions = await prisma.readingSession.findMany({
    where: { startedAt: { gte: thirtyDaysAgo } },
    select: { duration: true, startedAt: true },
  });

  const dailyMap = new Map<string, { duration: number; sessions: number }>();
  for (const s of recentSessions) {
    const date = s.startedAt.toISOString().split("T")[0];
    const existing = dailyMap.get(date) || { duration: 0, sessions: 0 };
    existing.duration += s.duration;
    existing.sessions += 1;
    dailyMap.set(date, existing);
  }

  const dailyStats = Array.from(dailyMap.entries())
    .map(([date, data]) => ({ date, ...data }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    totalReadTime,
    totalSessions,
    totalComicsRead: totalComicsRead.length,
    recentSessions: sessions.map((s) => ({
      id: s.id,
      comicId: s.comicId,
      comicTitle: s.comic.title,
      startedAt: s.startedAt.toISOString(),
      endedAt: s.endedAt?.toISOString() || null,
      duration: s.duration,
      startPage: s.startPage,
      endPage: s.endPage,
    })),
    dailyStats,
  };
}

/**
 * Get reading history for a specific comic
 */
export async function getComicReadingHistory(comicId: string) {
  const sessions = await prisma.readingSession.findMany({
    where: { comicId },
    orderBy: { startedAt: "desc" },
    take: 20,
  });

  return sessions.map((s) => ({
    id: s.id,
    startedAt: s.startedAt.toISOString(),
    endedAt: s.endedAt?.toISOString() || null,
    duration: s.duration,
    startPage: s.startPage,
    endPage: s.endPage,
  }));
}

// ============================================================
// Sort Order (Drag & Drop)
// ============================================================

/**
 * Update sort order for multiple comics
 */
export async function updateSortOrders(orders: { id: string; sortOrder: number }[]) {
  // Use transaction for batch update — much faster than sequential updates
  await prisma.$transaction(
    orders.map((item) =>
      prisma.comic.update({
        where: { id: item.id },
        data: { sortOrder: item.sortOrder },
      })
    )
  );
}

// ============================================================
// Category Management (Webtoons-style genre classification)
// ============================================================

/**
 * Predefined categories (Webtoons-style)
 */
export const PREDEFINED_CATEGORIES = [
  { slug: "romance", icon: "💕", names: { zh: "恋爱", en: "Romance" } },
  { slug: "action", icon: "⚔️", names: { zh: "动作", en: "Action" } },
  { slug: "fantasy", icon: "🔮", names: { zh: "奇幻", en: "Fantasy" } },
  { slug: "comedy", icon: "😂", names: { zh: "搞笑", en: "Comedy" } },
  { slug: "drama", icon: "🎭", names: { zh: "剧情", en: "Drama" } },
  { slug: "horror", icon: "👻", names: { zh: "恐怖", en: "Horror" } },
  { slug: "thriller", icon: "😱", names: { zh: "惊悚", en: "Thriller" } },
  { slug: "mystery", icon: "🔍", names: { zh: "悬疑", en: "Mystery" } },
  { slug: "slice-of-life", icon: "☀️", names: { zh: "日常", en: "Slice of Life" } },
  { slug: "school", icon: "🏫", names: { zh: "校园", en: "School" } },
  { slug: "sci-fi", icon: "🚀", names: { zh: "科幻", en: "Sci-Fi" } },
  { slug: "sports", icon: "⚽", names: { zh: "运动", en: "Sports" } },
  { slug: "historical", icon: "📜", names: { zh: "历史", en: "Historical" } },
  { slug: "isekai", icon: "🌀", names: { zh: "异世界", en: "Isekai" } },
  { slug: "mecha", icon: "🤖", names: { zh: "机甲", en: "Mecha" } },
  { slug: "supernatural", icon: "✨", names: { zh: "超自然", en: "Supernatural" } },
  { slug: "martial-arts", icon: "🥋", names: { zh: "武侠", en: "Martial Arts" } },
  { slug: "shounen", icon: "👦", names: { zh: "少年", en: "Shounen" } },
  { slug: "shoujo", icon: "👧", names: { zh: "少女", en: "Shoujo" } },
  { slug: "seinen", icon: "🧑", names: { zh: "青年", en: "Seinen" } },
  { slug: "josei", icon: "👩", names: { zh: "女性", en: "Josei" } },
  { slug: "adventure", icon: "🗺️", names: { zh: "冒险", en: "Adventure" } },
  { slug: "psychological", icon: "🧠", names: { zh: "心理", en: "Psychological" } },
  { slug: "gourmet", icon: "🍜", names: { zh: "美食", en: "Gourmet" } },
];

/**
 * Initialize predefined categories (call on first run / startup)
 */
export async function initCategories(lang: string = "zh") {
  const isZh = lang.startsWith("zh");
  for (let i = 0; i < PREDEFINED_CATEGORIES.length; i++) {
    const cat = PREDEFINED_CATEGORIES[i];
    const name = isZh ? cat.names.zh : cat.names.en;
    await prisma.category.upsert({
      where: { slug: cat.slug },
      create: { name, slug: cat.slug, icon: cat.icon, sortOrder: i },
      update: { icon: cat.icon, sortOrder: i },
    });
  }
}

/**
 * Get all categories with comic counts
 */
export async function getAllCategories() {
  const categories = await prisma.category.findMany({
    orderBy: { sortOrder: "asc" },
    include: {
      _count: { select: { comics: true } },
    },
  });

  return categories.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    icon: c.icon,
    count: c._count.comics,
  }));
}

/**
 * Add categories to a comic (by slug)
 */
export async function addCategoriesToComic(comicId: string, categorySlugs: string[]) {
  for (const slug of categorySlugs) {
    let category = await prisma.category.findUnique({ where: { slug } });
    if (!category) {
      // Auto-create category if not predefined
      const predefined = PREDEFINED_CATEGORIES.find((c) => c.slug === slug);
      category = await prisma.category.create({
        data: {
          name: predefined?.names.zh || slug,
          slug,
          icon: predefined?.icon || "📚",
          sortOrder: 999,
        },
      });
    }

    await prisma.comicCategory.upsert({
      where: { comicId_categoryId: { comicId, categoryId: category.id } },
      create: { comicId, categoryId: category.id },
      update: {},
    });
  }
}

/**
 * Remove a category from a comic
 */
export async function removeCategoryFromComic(comicId: string, categorySlug: string) {
  const category = await prisma.category.findUnique({ where: { slug: categorySlug } });
  if (!category) return;

  await prisma.comicCategory.deleteMany({
    where: { comicId, categoryId: category.id },
  });
}

/**
 * Set comic categories (replace all)
 */
export async function setComicCategories(comicId: string, categorySlugs: string[]) {
  // Remove all existing
  await prisma.comicCategory.deleteMany({ where: { comicId } });
  // Add new
  if (categorySlugs.length > 0) {
    await addCategoriesToComic(comicId, categorySlugs);
  }
}

/**
 * Batch set category for multiple comics
 */
export async function batchSetCategory(comicIds: string[], categorySlugs: string[]) {
  for (const comicId of comicIds) {
    await addCategoriesToComic(comicId, categorySlugs);
  }
}

// ============================================================
// Duplicate Detection
// ============================================================

export interface DuplicateGroup {
  reason: string; // "sameFile" | "sameName" | "sameSize"
  comics: {
    id: string;
    filename: string;
    title: string;
    fileSize: number;
    pageCount: number;
    addedAt: string;
    coverUrl: string;
  }[];
}

/**
 * Detect duplicate comics by multiple criteria:
 * 1. Exact file content hash (SHA-256) — definite duplicates
 * 2. Same file size + same page count — likely duplicates
 * 3. Similar title (normalized) — possible duplicates
 */
export async function detectDuplicates(): Promise<DuplicateGroup[]> {
  const fs = await import("fs");
  const path = await import("path");
  const crypto = await import("crypto");
  const { getComicsDir } = await import("./config");
  const COMICS_DIR = getComicsDir();

  const comics = await prisma.comic.findMany({
    select: {
      id: true,
      filename: true,
      title: true,
      fileSize: true,
      pageCount: true,
      addedAt: true,
    },
    orderBy: { title: "asc" },
  });

  const groups: DuplicateGroup[] = [];
  const usedIds = new Set<string>();

  // --- Pass 1: Exact content hash ---
  const hashMap = new Map<string, typeof comics>();
  for (const comic of comics) {
    const filepath = path.join(COMICS_DIR, comic.filename);
    try {
      if (!fs.existsSync(filepath)) continue;
      const buf = fs.readFileSync(filepath);
      const hash = crypto.createHash("sha256").update(buf).digest("hex");
      const arr = hashMap.get(hash) || [];
      arr.push(comic);
      hashMap.set(hash, arr);
    } catch {
      // skip unreadable files
    }
  }

  for (const [, arr] of hashMap) {
    if (arr.length > 1) {
      const ids = arr.map((c) => c.id);
      ids.forEach((id) => usedIds.add(id));
      groups.push({
        reason: "sameFile",
        comics: arr.map((c) => ({
          id: c.id,
          filename: c.filename,
          title: c.title,
          fileSize: c.fileSize,
          pageCount: c.pageCount,
          addedAt: c.addedAt.toISOString(),
          coverUrl: getCoverUrl(c.id),
        })),
      });
    }
  }

  // --- Pass 2: Same file size + same page count ---
  const sizePageMap = new Map<string, typeof comics>();
  for (const comic of comics) {
    if (usedIds.has(comic.id)) continue;
    const key = `${comic.fileSize}_${comic.pageCount}`;
    const arr = sizePageMap.get(key) || [];
    arr.push(comic);
    sizePageMap.set(key, arr);
  }

  for (const [, arr] of sizePageMap) {
    if (arr.length > 1) {
      const ids = arr.map((c) => c.id);
      ids.forEach((id) => usedIds.add(id));
      groups.push({
        reason: "sameSize",
        comics: arr.map((c) => ({
          id: c.id,
          filename: c.filename,
          title: c.title,
          fileSize: c.fileSize,
          pageCount: c.pageCount,
          addedAt: c.addedAt.toISOString(),
          coverUrl: `/api/comics/${c.id}/thumbnail`,
        })),
      });
    }
  }

  // --- Pass 3: Similar title (normalized) ---
  function normalizeTitle(title: string): string {
    return title
      .toLowerCase()
      .replace(/[\s_\-\.]+/g, "")
      .replace(/[\(\)\[\]\{\}【】（）「」『』]/g, "")
      .replace(/vol\.?\d+/gi, "")
      .replace(/v\d+/gi, "")
      .replace(/\d+$/g, "")
      .trim();
  }

  const titleMap = new Map<string, typeof comics>();
  for (const comic of comics) {
    if (usedIds.has(comic.id)) continue;
    const normalized = normalizeTitle(comic.title);
    if (!normalized) continue;
    const arr = titleMap.get(normalized) || [];
    arr.push(comic);
    titleMap.set(normalized, arr);
  }

  for (const [, arr] of titleMap) {
    if (arr.length > 1) {
      groups.push({
        reason: "sameName",
        comics: arr.map((c) => ({
          id: c.id,
          filename: c.filename,
          title: c.title,
          fileSize: c.fileSize,
          pageCount: c.pageCount,
          addedAt: c.addedAt.toISOString(),
          coverUrl: `/api/comics/${c.id}/thumbnail`,
        })),
      });
    }
  }

  return groups;
}

/**
 * Delete a comic file from disk and database
 */
export async function deleteComic(comicId: string) {
  const comic = await prisma.comic.findUnique({ where: { id: comicId } });
  if (!comic) return null;

  // Delete from DB (cascade will handle relations)
  await prisma.comic.delete({ where: { id: comicId } });

  // Try to delete file from disk
  const fs = await import("fs");
  const path = await import("path");
  const { getComicsDir } = await import("./config");
  const filePath = path.join(getComicsDir(), comic.filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  return comic;
}
