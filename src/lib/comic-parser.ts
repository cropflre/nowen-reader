import fs from "fs";
import { promises as fsPromises } from "fs";
import path from "path";
import {
  getComicsDir,
  getAllComicsDirs,
  SUPPORTED_EXTENSIONS,
} from "./config";
import {
  ArchiveReader,
  createArchiveReader,
  getImageEntriesFromArchive,
  getArchiveType,
  generateArchiveThumbnail,
  renderPdfPage,
  getPdfPageCount,
} from "./archive-parser";

export interface ComicArchiveInfo {
  id: string;
  filename: string;
  filepath: string;
  title: string;
  pageCount: number;
  fileSize: number;
  lastModified: string;
}

// Natural sort helper for page filenames
function naturalSort(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

// Generate a stable ID from filename
export function filenameToId(filename: string): string {
  const crypto = require("crypto");
  return crypto
    .createHash("md5")
    .update(filename)
    .digest("hex")
    .substring(0, 12);
}

// Derive a clean title from filename
export function filenameToTitle(filename: string): string {
  return path.basename(filename, path.extname(filename));
}

// ============================================================
// ArchiveReader instance cache pool (prevents re-opening same file)
// ============================================================

interface CachedReader {
  reader: ArchiveReader;
  lastUsed: number;
}

const readerCache = new Map<string, CachedReader>();
const READER_CACHE_TTL = 60_000; // 60 seconds
const READER_CACHE_MAX_SIZE = 5; // 最多缓存 5 个 reader，防止内存失控

// 定期清理过期 reader
setInterval(() => {
  const now = Date.now();
  for (const [filepath, cached] of readerCache.entries()) {
    if (now - cached.lastUsed > READER_CACHE_TTL) {
      cached.reader.close();
      readerCache.delete(filepath);
    }
  }
}, 30_000);

/**
 * Get or create an ArchiveReader, with instance pooling.
 * The caller should NOT call reader.close() — the pool manages lifecycle.
 */
async function getPooledReader(filepath: string): Promise<ArchiveReader | null> {
  const cached = readerCache.get(filepath);
  if (cached) {
    cached.lastUsed = Date.now();
    return cached.reader;
  }

  const reader = await createArchiveReader(filepath);
  if (!reader) return null;

  // 如果池满，淘汰最久未使用的
  if (readerCache.size >= READER_CACHE_MAX_SIZE) {
    let oldestKey = "";
    let oldestTime = Infinity;
    for (const [key, val] of readerCache.entries()) {
      if (val.lastUsed < oldestTime) {
        oldestTime = val.lastUsed;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      readerCache.get(oldestKey)?.reader.close();
      readerCache.delete(oldestKey);
    }
  }

  readerCache.set(filepath, { reader, lastUsed: Date.now() });
  return reader;
}

// ============================================================
// In-memory caches (persist across requests within same process)
// ============================================================

/** ID → ComicArchiveInfo lookup cache */
let comicByIdCache = new Map<string, ComicArchiveInfo>();
/** Full scan result cache */
let fullScanCache: ComicArchiveInfo[] | null = null;
/** Timestamp of last full scan */
let fullScanTimestamp = 0;
/** Max age for full scan cache (30 seconds) */
const FULL_SCAN_MAX_AGE = 30_000;

/** Page list cache: comicId → entry names[] */
const pageListCache = new Map<string, { entries: string[]; ts: number }>();
/** Page list cache TTL (5 minutes — page lists rarely change) */
const PAGE_LIST_MAX_AGE = 300_000;

/** Page image disk cache directory */
const PAGE_CACHE_DIR = path.join(process.cwd(), ".cache", "pages");

/** MIME type lookup */
const MIME_MAP: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
};

/**
 * Invalidate all caches (call after sync / directory change)
 */
export function invalidateComicCaches() {
  comicByIdCache.clear();
  fullScanCache = null;
  fullScanTimestamp = 0;
  pageListCache.clear();
  // 关闭并清理所有池化的 reader
  for (const [, cached] of readerCache.entries()) {
    cached.reader.close();
  }
  readerCache.clear();
}

/**
 * Scan all comics directories and return info about all archives.
 * Results are cached in memory for FULL_SCAN_MAX_AGE ms.
 */
export async function scanComicsDirectory(): Promise<ComicArchiveInfo[]> {
  const now = Date.now();
  if (fullScanCache && now - fullScanTimestamp < FULL_SCAN_MAX_AGE) {
    return fullScanCache;
  }

  const allDirs = getAllComicsDirs();
  const comics: ComicArchiveInfo[] = [];

  for (const comicsDir of allDirs) {
    try {
      await fsPromises.access(comicsDir);
    } catch {
      if (comicsDir === getComicsDir()) {
        await fsPromises.mkdir(comicsDir, { recursive: true });
      }
      continue;
    }

    const files = await fsPromises.readdir(comicsDir);

    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.includes(ext)) continue;

      const filepath = path.join(comicsDir, file);
      const stat = await fsPromises.stat(filepath);

      try {
        let pageCount = 0;

        if (ext === ".pdf") {
          pageCount = await getPdfPageCount(filepath);
        } else {
          const reader = await createArchiveReader(filepath);
          if (!reader) continue;

          try {
            const images = getImageEntriesFromArchive(reader);
            pageCount = images.length;
          } finally {
            reader.close();
          }
        }

        comics.push({
          id: filenameToId(file),
          filename: file,
          filepath,
          title: filenameToTitle(file),
          pageCount,
          fileSize: stat.size,
          lastModified: stat.mtime.toISOString(),
        });
      } catch (err) {
        console.error(`Failed to parse ${file}:`, err);
      }
    }
  }

  comics.sort((a, b) => naturalSort(a.title, b.title));

  // Update caches
  fullScanCache = comics;
  fullScanTimestamp = now;
  comicByIdCache = new Map(comics.map((c) => [c.id, c]));

  return comics;
}

/**
 * Find a comic by its ID — uses fast O(1) lookup cache.
 * Falls back to a lightweight filesystem scan if cache miss.
 */
export async function findComicById(comicId: string): Promise<ComicArchiveInfo | null> {
  // Fast path: check in-memory cache
  const cached = comicByIdCache.get(comicId);
  if (cached) {
    // Verify file still exists
    try {
      await fsPromises.access(cached.filepath);
      return cached;
    } catch {
      comicByIdCache.delete(comicId);
    }
  }

  // Lightweight fallback: scan directories without opening archives
  const allDirs = getAllComicsDirs();
  for (const dir of allDirs) {
    try {
      await fsPromises.access(dir);
    } catch {
      continue;
    }
    const files = await fsPromises.readdir(dir);
    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.includes(ext)) continue;
      if (filenameToId(file) === comicId) {
        const filepath = path.join(dir, file);
        const stat = await fsPromises.stat(filepath);
        const info: ComicArchiveInfo = {
          id: comicId,
          filename: file,
          filepath,
          title: filenameToTitle(file),
          pageCount: 0, // lazy — will be filled when needed
          fileSize: stat.size,
          lastModified: stat.mtime.toISOString(),
        };
        comicByIdCache.set(comicId, info);
        return info;
      }
    }
  }

  return null;
}

/**
 * Get the list of page image filenames for a comic (sorted).
 * Cached in memory per comic.
 */
export async function getComicPages(comicId: string): Promise<string[]> {
  // Check page list cache
  const now = Date.now();
  const cachedPages = pageListCache.get(comicId);
  if (cachedPages && now - cachedPages.ts < PAGE_LIST_MAX_AGE) {
    return cachedPages.entries;
  }

  const info = await findComicById(comicId);
  if (!info) return [];

  const type = getArchiveType(info.filepath);
  let entries: string[];

  if (type === "pdf") {
    const count = await getPdfPageCount(info.filepath);
    entries = Array.from({ length: count }, (_, i) => `page-${String(i + 1).padStart(4, "0")}.png`);
  } else {
    const reader = await getPooledReader(info.filepath);
    if (!reader) return [];
    entries = getImageEntriesFromArchive(reader);
    // 不调用 reader.close()，由缓存池统一管理
  }

  pageListCache.set(comicId, { entries, ts: now });
  return entries;
}

/**
 * Get the disk cache path for a page image
 */
function getPageCachePath(comicId: string, pageIndex: number, ext: string): string {
  return path.join(PAGE_CACHE_DIR, comicId, `${pageIndex}${ext}`);
}

/**
 * Extract a single page image as a Buffer.
 * Uses disk cache to avoid re-extracting from archive.
 */
export async function getPageImage(
  comicId: string,
  pageIndex: number
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const info = await findComicById(comicId);
  if (!info) return null;

  const type = getArchiveType(info.filepath);
  if (type === "pdf") return null;

  // Check disk cache first
  const cacheDir = path.join(PAGE_CACHE_DIR, comicId);
  try {
    const files = await fsPromises.readdir(cacheDir);
    const prefix = `${pageIndex}.`;
    const cached = files.find((f) => f.startsWith(prefix));
    if (cached) {
      const ext = path.extname(cached).toLowerCase();
      return {
        buffer: await fsPromises.readFile(path.join(cacheDir, cached)),
        mimeType: MIME_MAP[ext] || "image/jpeg",
      };
    }
  } catch {
    // Cache dir doesn't exist yet, proceed to extract
  }

  // Extract from archive (using pooled reader)
  const reader = await getPooledReader(info.filepath);
  if (!reader) return null;

  try {
    const entries = getImageEntriesFromArchive(reader);
    if (pageIndex < 0 || pageIndex >= entries.length) return null;

    const entryName = entries[pageIndex];
    const buffer = reader.extractEntry(entryName);
    if (!buffer) return null;

    const ext = path.extname(entryName).toLowerCase();
    const mimeType = MIME_MAP[ext] || "image/jpeg";

    // Write to disk cache (fire-and-forget, don't block response)
    fsPromises.mkdir(cacheDir, { recursive: true })
      .then(() => fsPromises.writeFile(getPageCachePath(comicId, pageIndex, ext), buffer))
      .catch(() => { /* Cache write failure is non-critical */ });

    return { buffer, mimeType };
  } catch (e) {
    console.error("getPageImage extract error:", e);
    return null;
  }
  // 不调用 reader.close()，由缓存池统一管理
}

/**
 * Extract a page image asynchronously (supports PDF rendering).
 * PDF pages are also disk-cached.
 */
export async function getPageImageAsync(
  comicId: string,
  pageIndex: number
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const info = await findComicById(comicId);
  if (!info) return null;

  const type = getArchiveType(info.filepath);

  if (type === "pdf") {
    // Check disk cache
    const cachePath = getPageCachePath(comicId, pageIndex, ".png");
    try {
      const cached = await fsPromises.readFile(cachePath);
      return { buffer: cached, mimeType: "image/png" };
    } catch {
      // Not cached, render from PDF
    }

    const result = await renderPdfPage(info.filepath, pageIndex);
    if (result) {
      // Cache to disk (fire-and-forget)
      const cacheDir = path.join(PAGE_CACHE_DIR, comicId);
      fsPromises.mkdir(cacheDir, { recursive: true })
        .then(() => fsPromises.writeFile(cachePath, result.buffer))
        .catch(() => { /* non-critical */ });
    }
    return result;
  }

  return getPageImage(comicId, pageIndex);
}

/**
 * Get accurate PDF page count (async)
 */
export async function getAccuratePdfPageCount(comicId: string): Promise<number> {
  const info = await findComicById(comicId);
  if (!info) return 0;
  return getPdfPageCount(info.filepath);
}

/**
 * Generate or get cached thumbnail for a comic's cover (first page)
 */
export async function getComicThumbnail(
  comicId: string
): Promise<Buffer | null> {
  const info = await findComicById(comicId);
  if (!info) return null;

  return generateArchiveThumbnail(info.filepath, comicId);
}
