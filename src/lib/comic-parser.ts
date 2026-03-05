import fs from "fs";
import path from "path";
import {
  getComicsDir,
  getAllComicsDirs,
  SUPPORTED_EXTENSIONS,
} from "./config";
import {
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
function filenameToId(filename: string): string {
  const crypto = require("crypto");
  return crypto
    .createHash("md5")
    .update(filename)
    .digest("hex")
    .substring(0, 12);
}

// Derive a clean title from filename
function filenameToTitle(filename: string): string {
  return path.basename(filename, path.extname(filename));
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
    if (!fs.existsSync(comicsDir)) {
      if (comicsDir === getComicsDir()) {
        fs.mkdirSync(comicsDir, { recursive: true });
      }
      continue;
    }

    const files = fs.readdirSync(comicsDir);

    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.includes(ext)) continue;

      const filepath = path.join(comicsDir, file);
      const stat = fs.statSync(filepath);

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
    if (fs.existsSync(cached.filepath)) return cached;
    comicByIdCache.delete(comicId);
  }

  // Lightweight fallback: scan directories without opening archives
  const allDirs = getAllComicsDirs();
  for (const dir of allDirs) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.includes(ext)) continue;
      if (filenameToId(file) === comicId) {
        const filepath = path.join(dir, file);
        const stat = fs.statSync(filepath);
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
    const reader = await createArchiveReader(info.filepath);
    if (!reader) return [];
    try {
      entries = getImageEntriesFromArchive(reader);
    } finally {
      reader.close();
    }
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
  if (fs.existsSync(cacheDir)) {
    const files = fs.readdirSync(cacheDir);
    const prefix = `${pageIndex}.`;
    const cached = files.find((f) => f.startsWith(prefix));
    if (cached) {
      const ext = path.extname(cached).toLowerCase();
      return {
        buffer: fs.readFileSync(path.join(cacheDir, cached)),
        mimeType: MIME_MAP[ext] || "image/jpeg",
      };
    }
  }

  // Extract from archive
  const reader = await createArchiveReader(info.filepath);
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
    try {
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }
      const cachePath = getPageCachePath(comicId, pageIndex, ext);
      fs.writeFileSync(cachePath, buffer);
    } catch {
      // Cache write failure is non-critical
    }

    return { buffer, mimeType };
  } finally {
    reader.close();
  }
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
    if (fs.existsSync(cachePath)) {
      return { buffer: fs.readFileSync(cachePath), mimeType: "image/png" };
    }

    const result = await renderPdfPage(info.filepath, pageIndex);
    if (result) {
      // Cache to disk
      try {
        const cacheDir = path.join(PAGE_CACHE_DIR, comicId);
        if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(cachePath, result.buffer);
      } catch { /* non-critical */ }
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
