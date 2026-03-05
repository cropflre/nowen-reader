import { prisma } from "./db";
import { scanComicsDirectory, ComicArchiveInfo } from "./comic-parser";

/**
 * Sync the comics directory with the database.
 * - Adds new comics found on disk
 * - Removes DB entries for deleted files
 * - Updates page count / file size if changed
 */
export async function syncComicsToDatabase() {
  const filesOnDisk = await scanComicsDirectory();
  const fileMap = new Map(filesOnDisk.map((f) => [f.id, f]));

  // Get all comics in DB
  const dbComics = await prisma.comic.findMany({ select: { id: true, filename: true } });
  const dbMap = new Map(dbComics.map((c) => [c.id, c]));

  // Add new comics
  const toAdd: ComicArchiveInfo[] = [];
  for (const file of filesOnDisk) {
    if (!dbMap.has(file.id)) {
      toAdd.push(file);
    }
  }

  if (toAdd.length > 0) {
    await prisma.comic.createMany({
      data: toAdd.map((f) => ({
        id: f.id,
        filename: f.filename,
        title: f.title,
        pageCount: f.pageCount,
        fileSize: f.fileSize,
      })),
    });
  }

  // Remove stale entries (files deleted from disk)
  const toRemove = dbComics.filter((c) => !fileMap.has(c.id));
  if (toRemove.length > 0) {
    await prisma.comic.deleteMany({
      where: { id: { in: toRemove.map((c) => c.id) } },
    });
  }

  // Update changed entries
  for (const file of filesOnDisk) {
    if (dbMap.has(file.id)) {
      await prisma.comic.update({
        where: { id: file.id },
        data: {
          pageCount: file.pageCount,
          fileSize: file.fileSize,
        },
      });
    }
  }
}

/**
 * Get all comics with their tags
 */
export async function getAllComics(options?: {
  search?: string;
  tags?: string[];
  favoritesOnly?: boolean;
  sortBy?: "title" | "addedAt" | "lastReadAt" | "rating";
  sortOrder?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}) {
  const { search, tags, favoritesOnly, sortBy = "title", sortOrder = "asc", page, pageSize } = options || {};

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};

  if (search) {
    where.title = { contains: search };
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orderBy: any = {};
  orderBy[sortBy] = sortOrder;

  // Get total count for pagination
  const total = await prisma.comic.count({ where });

  // Build pagination options
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const findOptions: any = {
    where,
    orderBy,
    include: {
      tags: {
        include: {
          tag: true,
        },
      },
    },
  };

  if (page && pageSize) {
    findOptions.skip = (page - 1) * pageSize;
    findOptions.take = pageSize;
  }

  const comics = await prisma.comic.findMany(findOptions);

  const items = comics.map((c) => ({
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
    groupName: c.groupName,
    totalReadTime: c.totalReadTime,
    coverUrl: `/api/comics/${c.id}/thumbnail`,
    tags: c.tags.map((ct) => ({ name: ct.tag.name, color: ct.tag.color })),
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
    groupName: comic.groupName,
    totalReadTime: comic.totalReadTime,
    tags: comic.tags.map((ct) => ({ name: ct.tag.name, color: ct.tag.color })),
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

  // Clean up orphan tags
  const usageCount = await prisma.comicTag.count({ where: { tagId: tag.id } });
  if (usageCount === 0) {
    await prisma.tag.delete({ where: { id: tag.id } });
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
  for (const name of tagNames) {
    const tag = await prisma.tag.upsert({
      where: { name },
      create: { name },
      update: {},
    });
    for (const comicId of comicIds) {
      await prisma.comicTag.upsert({
        where: { comicId_tagId: { comicId, tagId: tag.id } },
        create: { comicId, tagId: tag.id },
        update: {},
      });
    }
  }
}

/**
 * Batch set group
 */
export async function batchSetGroup(comicIds: string[], groupName: string) {
  return prisma.comic.updateMany({
    where: { id: { in: comicIds } },
    data: { groupName },
  });
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
 * Get reading statistics
 */
export async function getReadingStats() {
  const sessions = await prisma.readingSession.findMany({
    orderBy: { startedAt: "desc" },
    take: 50,
    include: {
      comic: { select: { title: true } },
    },
  });

  const allSessions = await prisma.readingSession.findMany({
    select: { duration: true, comicId: true, startedAt: true },
  });

  const totalReadTime = allSessions.reduce((sum, s) => sum + s.duration, 0);
  const totalSessions = allSessions.length;
  const uniqueComics = new Set(allSessions.map((s) => s.comicId));
  const totalComicsRead = uniqueComics.size;

  // Daily stats (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const recentAllSessions = allSessions.filter(
    (s) => s.startedAt >= thirtyDaysAgo
  );

  const dailyMap = new Map<string, { duration: number; sessions: number }>();
  for (const s of recentAllSessions) {
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
    totalComicsRead,
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
  for (const item of orders) {
    await prisma.comic.update({
      where: { id: item.id },
      data: { sortOrder: item.sortOrder },
    });
  }
}

// ============================================================
// Group Management
// ============================================================

/**
 * Update comic group
 */
export async function updateComicGroup(comicId: string, groupName: string) {
  return prisma.comic.update({
    where: { id: comicId },
    data: { groupName },
  });
}

/**
 * Get all groups
 */
export async function getAllGroups() {
  const comics = await prisma.comic.findMany({
    where: { groupName: { not: "" } },
    select: { groupName: true },
    distinct: ["groupName"],
    orderBy: { groupName: "asc" },
  });

  const groups: { name: string; count: number }[] = [];
  for (const c of comics) {
    const count = await prisma.comic.count({
      where: { groupName: c.groupName },
    });
    groups.push({ name: c.groupName, count });
  }

  return groups;
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
  const { COMICS_DIR } = await import("./config");

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
          coverUrl: `/api/comics/${c.id}/thumbnail`,
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
  const { COMICS_DIR } = await import("./config");
  const filePath = path.join(COMICS_DIR, comic.filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  return comic;
}
