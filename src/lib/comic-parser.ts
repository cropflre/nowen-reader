import fs from "fs";
import path from "path";
import {
  COMICS_DIR,
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

/**
 * Scan the comics directory and return info about all archives
 */
export async function scanComicsDirectory(): Promise<ComicArchiveInfo[]> {
  if (!fs.existsSync(COMICS_DIR)) {
    fs.mkdirSync(COMICS_DIR, { recursive: true });
    return [];
  }

  const files = fs.readdirSync(COMICS_DIR);
  const comics: ComicArchiveInfo[] = [];

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.includes(ext)) continue;

    const filepath = path.join(COMICS_DIR, file);
    const stat = fs.statSync(filepath);

    try {
      let pageCount = 0;

      if (ext === ".pdf") {
        const data = fs.readFileSync(filepath);
        const content = data.toString("binary");
        const matches = content.match(/\/Type\s*\/Page[^s]/g);
        pageCount = matches ? matches.length : 0;
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

  comics.sort((a, b) => naturalSort(a.title, b.title));
  return comics;
}

/**
 * Get the list of page image filenames for a comic (sorted)
 */
export async function getComicPages(comicId: string): Promise<string[]> {
  const info = await findComicById(comicId);
  if (!info) return [];

  const type = getArchiveType(info.filepath);

  if (type === "pdf") {
    // Return virtual page entries
    const data = fs.readFileSync(info.filepath);
    const content = data.toString("binary");
    const matches = content.match(/\/Type\s*\/Page[^s]/g);
    const count = matches ? matches.length : 0;
    return Array.from({ length: count }, (_, i) => `page-${String(i + 1).padStart(4, "0")}.png`);
  }

  const reader = await createArchiveReader(info.filepath);
  if (!reader) return [];

  try {
    return getImageEntriesFromArchive(reader);
  } finally {
    reader.close();
  }
}

/**
 * Extract a single page image as a Buffer
 */
export async function getPageImage(
  comicId: string,
  pageIndex: number
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const info = await findComicById(comicId);
  if (!info) return null;

  const type = getArchiveType(info.filepath);

  // PDF pages need async rendering
  if (type === "pdf") return null;

  const reader = await createArchiveReader(info.filepath);
  if (!reader) return null;

  try {
    const entries = getImageEntriesFromArchive(reader);

    if (pageIndex < 0 || pageIndex >= entries.length) return null;

    const entryName = entries[pageIndex];
    const buffer = reader.extractEntry(entryName);
    if (!buffer) return null;

    const ext = path.extname(entryName).toLowerCase();
    const mimeMap: Record<string, string> = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".bmp": "image/bmp",
      ".avif": "image/avif",
    };

    return {
      buffer,
      mimeType: mimeMap[ext] || "image/jpeg",
    };
  } finally {
    reader.close();
  }
}

/**
 * Extract a page image asynchronously (supports PDF rendering)
 */
export async function getPageImageAsync(
  comicId: string,
  pageIndex: number
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const info = await findComicById(comicId);
  if (!info) return null;

  const type = getArchiveType(info.filepath);

  if (type === "pdf") {
    return renderPdfPage(info.filepath, pageIndex);
  }

  // For non-PDF, use async version
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

/**
 * Find a comic by its ID
 */
export async function findComicById(comicId: string): Promise<ComicArchiveInfo | null> {
  const comics = await scanComicsDirectory();
  return comics.find((c) => c.id === comicId) || null;
}
