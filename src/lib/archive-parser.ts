import fs from "fs";
import path from "path";
import StreamZip from "node-stream-zip";
import sharp from "sharp";
import { IMAGE_EXTENSIONS, getThumbnailWidth, getThumbnailHeight, THUMBNAILS_DIR } from "./config";

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
// ZIP/CBZ Reader (using node-stream-zip — supports ZIP64 / >2GB)
// ============================================================

class ZipArchiveReader implements ArchiveReader {
  private zip: StreamZip;
  private entriesCache: ArchiveEntry[] = [];

  private constructor(zip: StreamZip, entries: ArchiveEntry[]) {
    this.zip = zip;
    this.entriesCache = entries;
  }

  /**
   * Factory method: opens the zip asynchronously and returns null on failure
   * (invalid format, >2GB with old lib, corrupted file, etc.)
   */
  static async create(filepath: string): Promise<ZipArchiveReader | null> {
    try {
      const zip = new StreamZip({ file: filepath, storeEntries: true });
      // Wait for the zip to be ready
      await new Promise<void>((resolve, reject) => {
        zip.on("ready", resolve);
        zip.on("error", reject);
      });
      const rawEntries = zip.entries();
      const entries: ArchiveEntry[] = Object.values(rawEntries).map((e) => ({
        name: e.name,
        isDirectory: !e.isFile,
      }));
      return new ZipArchiveReader(zip, entries);
    } catch (err) {
      console.warn(`Skipping invalid/unsupported ZIP file: ${filepath}`, String(err));
      return null;
    }
  }

  listEntries(): ArchiveEntry[] {
    return this.entriesCache;
  }

  extractEntry(entryName: string): Buffer | null {
    try {
      return this.zip.entryDataSync(entryName);
    } catch {
      return null;
    }
  }

  close() {
    try { this.zip.close(); } catch { /* ignore */ }
  }
}

// ============================================================
// RAR/CBR Reader (using node-unrar-js)
// ============================================================

class RarArchiveReader implements ArchiveReader {
  private entries: { name: string; isDirectory: boolean; data?: Uint8Array }[] = [];

  private constructor() {}

  static async create(filepath: string): Promise<RarArchiveReader | null> {
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
      const fileHeaders = [...(list.fileHeaders || [])];

      if (fileHeaders.length === 0) {
        console.warn("RAR file has no entries:", filepath);
        return null;
      }

      for (const header of fileHeaders) {
        instance.entries.push({
          name: header.name,
          isDirectory: header.flags.directory,
        });
      }

      // Extract all files
      const extracted = extractor.extract();
      if (extracted && extracted.files) {
        const files = [...extracted.files];
        for (const file of files) {
          const existing = instance.entries.find((e) => e.name === file.fileHeader.name);
          if (existing && file.extraction) {
            existing.data = file.extraction;
          }
        }
      }
    } catch (err: unknown) {
      console.warn("Skipping invalid RAR file:", filepath);
      return null;
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

  private constructor(filepath: string, pageCount: number) {
    this.filepath = filepath;
    this.pageCount = pageCount;
  }

  static async create(filepath: string): Promise<PdfArchiveReader> {
    const count = await getPdfPageCount(filepath);
    return new PdfArchiveReader(filepath, count);
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
      return await ZipArchiveReader.create(filepath);
    case "rar":
      return await RarArchiveReader.create(filepath);
    case "7z":
      return new SevenZipArchiveReader(filepath);
    case "pdf":
      return await PdfArchiveReader.create(filepath);
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
 * Render a PDF page to PNG using pdfjs-dist with @napi-rs/canvas
 */
export async function renderPdfPage(
  filepath: string,
  pageIndex: number
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  try {
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const data = new Uint8Array(fs.readFileSync(filepath));

    const loadingTask = pdfjsLib.getDocument({
      data,
      cMapUrl: path.join(process.cwd(), "node_modules", "pdfjs-dist", "cmaps") + "/",
      cMapPacked: true,
      standardFontDataUrl: path.join(process.cwd(), "node_modules", "pdfjs-dist", "standard_fonts") + "/",
      useSystemFonts: true,
    });
    const pdfDoc = await loadingTask.promise;

    if (pageIndex < 0 || pageIndex >= pdfDoc.numPages) {
      pdfDoc.destroy();
      return null;
    }

    const page = await pdfDoc.getPage(pageIndex + 1); // pdfjs uses 1-based index
    const viewport = page.getViewport({ scale: 2.0 });

    // Use @napi-rs/canvas for Node.js rendering
    const { createCanvas } = await import("@napi-rs/canvas");
    const canvas = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height));
    const context = canvas.getContext("2d");

    // Fill white background
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      canvas: canvas as any,
      canvasContext: context as any,
      viewport,
    }).promise;

    const pngBuffer = canvas.toBuffer("image/png");
    pdfDoc.destroy();

    return { buffer: Buffer.from(pngBuffer), mimeType: "image/png" };
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
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const data = new Uint8Array(fs.readFileSync(filepath));
    const loadingTask = pdfjsLib.getDocument({ data });
    const pdfDoc = await loadingTask.promise;
    const count = pdfDoc.numPages;
    pdfDoc.destroy();
    return count;
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
      .resize(getThumbnailWidth(), getThumbnailHeight(), {
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
