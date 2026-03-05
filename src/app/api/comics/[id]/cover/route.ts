import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { THUMBNAILS_DIR, getThumbnailWidth, getThumbnailHeight } from "@/lib/config";
import { findComicById } from "@/lib/comic-parser";

// Ensure thumbnails dir exists
function ensureDir() {
  if (!fs.existsSync(THUMBNAILS_DIR)) {
    fs.mkdirSync(THUMBNAILS_DIR, { recursive: true });
  }
}

/**
 * POST - Upload or fetch cover image
 * Body can be:
 *   - FormData with "file" field (user upload)
 *   - JSON { url: string } (fetch from URL)
 *   - JSON { reset: true } (reset to archive first page)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const comic = await findComicById(id);
  if (!comic) {
    return NextResponse.json({ error: "Comic not found" }, { status: 404 });
  }

  ensureDir();
  const cachePath = path.join(THUMBNAILS_DIR, `${id}.webp`);

  const contentType = request.headers.get("content-type") || "";

  try {
    // Case 1: FormData file upload
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file") as File | null;
      if (!file) {
        return NextResponse.json({ error: "No file provided" }, { status: 400 });
      }

      const arrayBuf = await file.arrayBuffer();
      const imgBuffer = Buffer.from(arrayBuf);

      const thumbnail = await sharp(imgBuffer)
        .resize(getThumbnailWidth(), getThumbnailHeight(), {
          fit: "cover",
          position: "top",
        })
        .webp({ quality: 85 })
        .toBuffer();

      fs.writeFileSync(cachePath, thumbnail);

      return NextResponse.json({ success: true, source: "upload" });
    }

    // Case 2: JSON body
    const body = await request.json();

    // Reset to default (regenerate from archive)
    if (body.reset) {
      if (fs.existsSync(cachePath)) {
        fs.unlinkSync(cachePath);
      }
      return NextResponse.json({ success: true, source: "reset" });
    }

    // Fetch from URL
    if (body.url) {
      const coverRes = await fetch(body.url, {
        signal: AbortSignal.timeout(30000),
        headers: { "User-Agent": "NowenReader/1.0" },
      });

      if (!coverRes.ok) {
        return NextResponse.json(
          { error: `Failed to fetch image: ${coverRes.status}` },
          { status: 400 }
        );
      }

      const arrayBuf = await coverRes.arrayBuffer();
      const imgBuffer = Buffer.from(arrayBuf);

      const thumbnail = await sharp(imgBuffer)
        .resize(getThumbnailWidth(), getThumbnailHeight(), {
          fit: "cover",
          position: "top",
        })
        .webp({ quality: 85 })
        .toBuffer();

      fs.writeFileSync(cachePath, thumbnail);

      return NextResponse.json({ success: true, source: "url" });
    }

    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  } catch (err) {
    console.error("Failed to update cover:", err);
    return NextResponse.json(
      { error: "Failed to update cover" },
      { status: 500 }
    );
  }
}
