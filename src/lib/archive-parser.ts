import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import sharp from "sharp";
import { IMAGE_EXTENSIONS, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, THUMBNAILS_DIR } from "./config";

// Natural sort helper
function naturalSort(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function isImageFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext);
}

function getBaseName(entryName: string): string {
  return path.basename(entryName);
}

// ============================================================
// Unified Archive Interface
// ============================================================

export interface ArchiveEntry {
  name: string;
  isDirectory: boolean;
}

export interface ArchiveReader {
  listEntries(): ArchiveEntry[];
  extractEntry(entryName: string): Buffer | null;
  close(): void;
}

// ============================================================
// ZIP/CBZ Reader (using AdmZip)
// ============================================================

class ZipArchiveReader implements ArchiveReader {
  private zip: AdmZip;

  constructor(filepath: string) {
    this.zip = new AdmZip(filepath);
  }

  listEntries(): ArchiveEntry[] {
    return this.zip.getEntries().map((e) => ({
      name: e.entryName,
      isDirectory: e.isDirectory,
    }));
  }

  extractEntry(entryName: string): Buffer | null {
    const entry = this.zip.getEntries().find((e) => e.entryName === entryName);
    if (!entry) return null;
    return entry.getData();
  }

  close() {
    // AdmZip doesn't need explicit close
  }
}

// ============================================================
// RAR/CBR Reader (using node-unrar-js)
// ============================================================

class RarArchiveReader implements ArchiveReader {
  private entries: { name: string; isDirectory: boolean; data?: Uint8Array }[] = [];

  private constructor() {}

  static async create(filepath: string): Promise<RarArchiveReader> {
    const instance = new RarArchiveReader();
    const fileBuffer = fs.readFileSync(filepath);
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createExtractorFromData } = require("node-unrar-js");

      // node-unrar-js v2.x: createExtractorFromData is async and needs wasmBinary
      // Use process.cwd() to avoid Next.js RSC bundler rewriting require.resolve paths with (rsc)
      const wasmPath = path.join(
        process.cwd(),
        "node_modules",
        "node-unrar-js",
        "dist",
        "js",
        "unrar.wasm"
      );
      const wasmBinary = fs.readFileSync(wasmPath);

      const extractor = await createExtractorFromData({
        data: fileBuffer,
        wasmBinary,
      });
      const list = extractor.getFileList();
      const fileHeaders = [...list.fileHeaders];

      for (const header of fileHeaders) {
        instance.entries.push({
          name: header.name,
          isDirectory: header.flags.directory,
        });
      }

      // Extract all files
      const extracted = extractor.extract();
      const files = [...extracted.files];
      for (const file of files) {
        const existing = instance.entries.find((e) => e.name === file.fileHeader.name);
        if (existing && file.extraction) {
          existing.data = file.extraction;
        }
      }
    } catch (err) {
      console.error("Failed to read RAR file:", err);
    }
    return instance;
  }

  listEntries(): ArchiveEntry[] {
    return this.entries.map((e) => ({
      name: e.name,
      isDirectory: e.isDirectory,
    }));
  }

  extractEntry(entryName: string): Buffer | null {
    const entry = this.entries.find((e) => e.name === entryName);
    if (!entry?.data) return null;
    return Buffer.from(entry.data);
  }

  close() {
    this.entries = [];
  }
}

// ============================================================
// 7z/CB7 Reader (using node-7z + 7zip-bin)
// ============================================================

class SevenZipArchiveReader implements ArchiveReader {
  private filepath: string;
  private entryList: ArchiveEntry[] = [];
  private tempDir: string;
  private extracted = false;

  constructor(filepath: string) {
    this.filepath = filepath;
    this.tempDir = path.join(
      path.dirname(filepath),
      ".7z-temp-" + path.basename(filepath, path.extname(filepath))
    );

    // List entries synchronously using child_process
    try {
      const sevenBin = require("7zip-bin");
      const { execFileSync } = require("child_process");
      const result = execFileSync(sevenBin.path7za, ["l", "-slt", filepath], {
        encoding: "utf-8",
        maxBuffer: 50 * 1024 * 1024,
      });

      // Parse 7z list output
      const blocks = result.split("----------");
      if (blocks.length > 1) {
        const lines = blocks[1].split("\n");
        let currentName = "";
        let isDir = false;

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("Path = ")) {
            currentName = trimmed.substring(7);
          } else if (trimmed.startsWith("Folder = ")) {
            isDir = trimmed.substring(9) === "+";
          } else if (trimmed === "" && currentName) {
            this.entryList.push({ name: currentName, isDirectory: isDir });
            currentName = "";
            isDir = false;
          }
        }
        if (currentName) {
          this.entryList.push({ name: currentName, isDirectory: isDir });
        }
      }
    } catch (err) {
      console.error("Failed to list 7z entries:", err);
    }
  }

  listEntries(): ArchiveEntry[] {
    return this.entryList;
  }

  extractEntry(entryName: string): Buffer | null {
    if (!this.extracted) {
      this.extractAll();
    }

    const filePath = path.join(this.tempDir, entryName);
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath);
    }
    return null;
  }

  private extractAll() {
    try {
      if (!fs.existsSync(this.tempDir)) {
        fs.mkdirSync(this.tempDir, { recursive: true });
      }

      const sevenBin = require("7zip-bin");
      const { execFileSync } = require("child_process");
      execFileSync(sevenBin.path7za, ["x", "-y", `-o${this.tempDir}`, this.filepath], {
        encoding: "utf-8",
        maxBuffer: 100 * 1024 * 1024,
      });
      this.extracted = true;
    } catch (err) {
      console.error("Failed to extract 7z:", err);
    }
  }

  close() {
    // Clean up temp dir
    if (fs.existsSync(this.tempDir)) {
      fs.rmSync(this.tempDir, { recursive: true, force: true });
    }
  }
}

// ============================================================
// PDF Reader (render pages to images using pdf-lib for page count)
// ============================================================

class PdfArchiveReader implements ArchiveReader {
  private filepath: string;
  private pageCount: number = 0;

  constructor(filepath: string) {
    this.filepath = filepath;
    // Get page count synchronously via pdf-lib
    try {
      // We'll do lazy page count via sync read of the PDF structure
      const data = fs.readFileSync(filepath);
      // Quick page count: count /Type /Page occurrences (rough estimate)
      const content = data.toString("binary");
      const matches = content.match(/\/Type\s*\/Page[^s]/g);
      this.pageCount = matches ? matches.length : 0;
    } catch (err) {
      console.error("Failed to read PDF:", err);
    }
  }

  listEntries(): ArchiveEntry[] {
    // Return virtual entries for each page
    const entries: ArchiveEntry[] = [];
    for (let i = 0; i < this.pageCount; i++) {
      entries.push({
        name: `page-${String(i + 1).padStart(4, "0")}.png`,
        isDirectory: false,
      });
    }
    return entries;
  }

  extractEntry(entryName: string): Buffer | null {
    // For PDF, we need to render the page - this is handled separately
    // Return null here; PDF page rendering is done async in getPageImageAsync
    return null;
  }

  close() {
    // Nothing to clean up
  }
}

// ============================================================
// Factory function
// ============================================================

export function getArchiveType(filepath: string): "zip" | "rar" | "7z" | "pdf" | null {
  const ext = path.extname(filepath).toLowerCase();
  switch (ext) {
    case ".zip":
    case ".cbz":
      return "zip";
    case ".rar":
    case ".cbr":
      return "rar";
    case ".7z":
    case ".cb7":
      return "7z";
    case ".pdf":
      return "pdf";
    default:
      return null;
  }
}

export async function createArchiveReader(filepath: string): Promise<ArchiveReader | null> {
  const type = getArchiveType(filepath);
  if (!type) return null;

  switch (type) {
    case "zip":
      return new ZipArchiveReader(filepath);
    case "rar":
      return await RarArchiveReader.create(filepath);
    case "7z":
      return new SevenZipArchiveReader(filepath);
    case "pdf":
      return new PdfArchiveReader(filepath);
    default:
      return null;
  }
}

// ============================================================
// Helper functions (used by comic-parser)
// ============================================================

export function getImageEntriesFromArchive(reader: ArchiveReader): string[] {
  return reader
    .listEntries()
    .filter((entry) => {
      if (entry.isDirectory) return false;
      const name = entry.name;
      if (name.startsWith("__MACOSX") || getBaseName(name).startsWith(".")) return false;
      return isImageFile(name);
    })
    .map((e) => e.name)
    .sort(naturalSort);
}

/**
 * Render a PDF page to PNG
 * Since Node.js doesn't have canvas natively, we generate a placeholder 
 * with page info. For full PDF rendering, users should convert PDFs to images first.
 */
export async function renderPdfPage(
  filepath: string,
  pageIndex: number
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  try {
    const { PDFDocument } = await import("pdf-lib");
    const data = fs.readFileSync(filepath);
    const pdfDoc = await PDFDocument.load(data);
    const pageCount = pdfDoc.getPageCount();

    if (pageIndex < 0 || pageIndex >= pageCount) return null;

    const page = pdfDoc.getPage(pageIndex);
    const { width, height } = page.getSize();

    // Generate a page placeholder using sharp with the correct dimensions
    // Scale to reasonable size
    const scale = Math.min(1600 / width, 2400 / height, 2.0);
    const renderWidth = Math.round(width * scale);
    const renderHeight = Math.round(height * scale);

    // Create a placeholder image with page number text rendered via SVG overlay
    const svgText = `
      <svg width="${renderWidth}" height="${renderHeight}">
        <rect width="100%" height="100%" fill="#f8f8f8"/>
        <text x="50%" y="45%" font-size="48" fill="#888" text-anchor="middle" font-family="sans-serif">PDF</text>
        <text x="50%" y="55%" font-size="32" fill="#aaa" text-anchor="middle" font-family="sans-serif">Page ${pageIndex + 1} / ${pageCount}</text>
        <rect x="2" y="2" width="${renderWidth - 4}" height="${renderHeight - 4}" fill="none" stroke="#ddd" stroke-width="2"/>
      </svg>
    `;

    const placeholder = await sharp({
      create: {
        width: renderWidth,
        height: renderHeight,
        channels: 3,
        background: { r: 248, g: 248, b: 248 },
      },
    })
      .composite([{
        input: Buffer.from(svgText),
        top: 0,
        left: 0,
      }])
      .png()
      .toBuffer();

    return { buffer: placeholder, mimeType: "image/png" };
  } catch (err) {
    console.error(`Failed to render PDF page ${pageIndex}:`, err);

    // Fallback placeholder
    try {
      const placeholder = await sharp({
        create: {
          width: 800,
          height: 1200,
          channels: 3,
          background: { r: 240, g: 240, b: 240 },
        },
      })
        .png()
        .toBuffer();

      return { buffer: placeholder, mimeType: "image/png" };
    } catch {
      return null;
    }
  }
}

/**
 * Get PDF page count accurately (async)
 */
export async function getPdfPageCount(filepath: string): Promise<number> {
  try {
    const { PDFDocument } = await import("pdf-lib");
    const data = fs.readFileSync(filepath);
    const pdfDoc = await PDFDocument.load(data);
    return pdfDoc.getPageCount();
  } catch (err) {
    console.error("Failed to get PDF page count:", err);
    return 0;
  }
}

/**
 * Generate thumbnail for archive (first page)
 */
export async function generateArchiveThumbnail(
  filepath: string,
  comicId: string
): Promise<Buffer | null> {
  if (!fs.existsSync(THUMBNAILS_DIR)) {
    fs.mkdirSync(THUMBNAILS_DIR, { recursive: true });
  }

  const cachePath = path.join(THUMBNAILS_DIR, `${comicId}.webp`);
  if (fs.existsSync(cachePath)) {
    return fs.readFileSync(cachePath);
  }

  const type = getArchiveType(filepath);

  let pageBuffer: Buffer | null = null;

  if (type === "pdf") {
    // For PDF, render first page
    const result = await renderPdfPage(filepath, 0);
    if (result) pageBuffer = result.buffer;
  } else {
    const reader = await createArchiveReader(filepath);
    if (!reader) return null;

    try {
      const images = getImageEntriesFromArchive(reader);
      if (images.length === 0) return null;

      pageBuffer = reader.extractEntry(images[0]);
    } finally {
      reader.close();
    }
  }

  if (!pageBuffer) return null;

  try {
    const thumbnail = await sharp(pageBuffer)
      .resize(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, {
        fit: "cover",
        position: "top",
      })
      .webp({ quality: 80 })
      .toBuffer();

    fs.writeFileSync(cachePath, thumbnail);
    return thumbnail;
  } catch (err) {
    console.error(`Failed to generate thumbnail for ${comicId}:`, err);
    return null;
  }
}
