import { NextRequest, NextResponse } from "next/server";
import {
  getGalleryDetail,
  getRealImageUrl,
  getGalleryMetadata,
  delay,
  fetchImageStream,
} from "@/lib/ehentai-service";
import { getComicsDir } from "@/lib/config";
import path from "path";
import fs from "fs";

// Track active downloads
const activeDownloads = new Map<
  string,
  { status: string; progress: number; total: number; error?: string }
>();

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const gid = searchParams.get("gid");

  if (!gid) {
    // Return all active downloads status
    const downloads = Object.fromEntries(activeDownloads);
    return NextResponse.json({ downloads });
  }

  // Return status for specific download
  const status = activeDownloads.get(gid);
  if (!status) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }

  return NextResponse.json(status);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { gid, token } = body;

    if (!gid || !token) {
      return NextResponse.json(
        { error: "Missing gid or token" },
        { status: 400 }
      );
    }

    // Check if already downloading
    const existing = activeDownloads.get(gid);
    if (existing && existing.status === "downloading") {
      return NextResponse.json({
        message: "Download already in progress",
        ...existing,
      });
    }

    // Start download in background
    activeDownloads.set(gid, {
      status: "starting",
      progress: 0,
      total: 0,
    });

    // Don't await - run in background
    downloadGallery(gid, token).catch((err) => {
      console.error(`[ehentai/download] Fatal error for ${gid}:`, err);
      activeDownloads.set(gid, {
        status: "error",
        progress: 0,
        total: 0,
        error: String(err),
      });
    });

    return NextResponse.json({
      message: "Download started",
      gid,
    });
  } catch (err) {
    console.error("[ehentai/download] Error:", err);
    return NextResponse.json(
      { error: "Failed to start download" },
      { status: 500 }
    );
  }
}

async function downloadGallery(gid: string, token: string) {
  const comicsDir = getComicsDir();

  // 1. Get gallery detail
  activeDownloads.set(gid, {
    status: "fetching_info",
    progress: 0,
    total: 0,
  });

  const detail = await getGalleryDetail(gid, token);
  const pageLinks = detail.pageLinks;
  const total = pageLinks.length;

  activeDownloads.set(gid, {
    status: "downloading",
    progress: 0,
    total,
  });

  // 2. Create temporary download directory
  const sanitizedTitle = detail.title
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, 120);
  const tmpDir = path.join(comicsDir, `.ehentai_tmp_${gid}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  // 3. Download each page
  for (let i = 0; i < pageLinks.length; i++) {
    try {
      const { imageUrl, filename } = await getRealImageUrl(pageLinks[i]);

      if (!imageUrl) {
        console.warn(`[ehentai/download] Empty URL for page ${i + 1}`);
        continue;
      }

      // Determine file extension and create sequential filename
      const ext = path.extname(filename) || ".jpg";
      const paddedIndex = String(i + 1).padStart(4, "0");
      const localFilename = `${paddedIndex}${ext}`;
      const localPath = path.join(tmpDir, localFilename);

      // Download image
      const { body } = await fetchImageStream(imageUrl);
      if (body) {
        const reader = body.getReader();
        const chunks: Uint8Array[] = [];
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        const buffer = Buffer.concat(chunks);
        fs.writeFileSync(localPath, buffer);
      }

      activeDownloads.set(gid, {
        status: "downloading",
        progress: i + 1,
        total,
      });

      // Rate limiting
      if (i < pageLinks.length - 1) {
        await delay(2000);
      }
    } catch (err) {
      console.error(`[ehentai/download] Failed page ${i + 1}:`, err);
      // Continue with next page
    }
  }

  // 4. Package into CBZ (which is just a ZIP)
  activeDownloads.set(gid, {
    status: "packaging",
    progress: total,
    total,
  });

  try {
    const AdmZip = (await import("adm-zip")).default;
    const zip = new AdmZip();

    // Add all downloaded images to ZIP
    const files = fs
      .readdirSync(tmpDir)
      .sort()
      .filter((f) => !f.startsWith("."));
    for (const file of files) {
      zip.addLocalFile(path.join(tmpDir, file));
    }

    // Write CBZ file
    const cbzFilename = `${sanitizedTitle}.cbz`;
    const cbzPath = path.join(comicsDir, cbzFilename);
    zip.writeZip(cbzPath);

    // 5. Clean up temp directory
    fs.rmSync(tmpDir, { recursive: true, force: true });

    // 6. Optionally store metadata via API call
    try {
      const metadata = await getGalleryMetadata([[parseInt(gid), token]]);
      if (metadata.length > 0) {
        // Write ComicInfo.xml style metadata alongside
        const meta = metadata[0];
        console.log(
          `[ehentai/download] Metadata retrieved for ${gid}: ${meta.title}`
        );
      }
    } catch {
      // Metadata fetch is optional
    }

    activeDownloads.set(gid, {
      status: "completed",
      progress: total,
      total,
    });

    // Clear from active downloads after 5 minutes
    setTimeout(() => {
      activeDownloads.delete(gid);
    }, 5 * 60 * 1000);
  } catch (err) {
    console.error(`[ehentai/download] Packaging failed for ${gid}:`, err);
    activeDownloads.set(gid, {
      status: "error",
      progress: total,
      total,
      error: "Failed to create CBZ archive",
    });

    // Clean up on error
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
}
