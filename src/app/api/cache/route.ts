import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { THUMBNAILS_DIR } from "@/lib/config";
import { invalidateComicCaches } from "@/lib/comic-parser";

const CACHE_DIR = path.join(process.cwd(), ".cache");

/** Recursively delete a directory's contents */
function clearDir(dirPath: string): number {
  let count = 0;
  if (!fs.existsSync(dirPath)) return 0;
  const items = fs.readdirSync(dirPath);
  for (const item of items) {
    const fp = path.join(dirPath, item);
    const stat = fs.statSync(fp);
    if (stat.isDirectory()) {
      count += clearDir(fp);
      fs.rmdirSync(fp);
    } else {
      fs.unlinkSync(fp);
      count++;
    }
  }
  return count;
}

export async function POST(request: NextRequest) {
  try {
    const { action } = await request.json();

    if (action === "clear-thumbnails") {
      invalidateComicCaches();
      let count = 0;
      if (fs.existsSync(THUMBNAILS_DIR)) {
        const files = fs.readdirSync(THUMBNAILS_DIR);
        for (const file of files) {
          fs.unlinkSync(path.join(THUMBNAILS_DIR, file));
          count++;
        }
      }
      return NextResponse.json({ success: true, deleted: count });
    }

    if (action === "clear-pages") {
      invalidateComicCaches();
      const pagesDir = path.join(CACHE_DIR, "pages");
      const count = clearDir(pagesDir);
      return NextResponse.json({ success: true, deleted: count });
    }

    if (action === "clear-search") {
      const cacheFiles = ["phash-cache.json"];
      let count = 0;
      for (const f of cacheFiles) {
        const fp = path.join(CACHE_DIR, f);
        if (fs.existsSync(fp)) {
          fs.unlinkSync(fp);
          count++;
        }
      }
      return NextResponse.json({ success: true, deleted: count });
    }

    if (action === "clear-all") {
      invalidateComicCaches();
      let count = 0;
      // Clear thumbnails
      if (fs.existsSync(THUMBNAILS_DIR)) {
        const files = fs.readdirSync(THUMBNAILS_DIR);
        for (const file of files) {
          fs.unlinkSync(path.join(THUMBNAILS_DIR, file));
          count++;
        }
      }
      // Clear pages cache
      const pagesDir = path.join(CACHE_DIR, "pages");
      count += clearDir(pagesDir);
      // Clear other caches (preserve site-config and ai-config)
      const preserve = new Set(["site-config.json", "ai-config.json", "thumbnails", "pages"]);
      if (fs.existsSync(CACHE_DIR)) {
        const items = fs.readdirSync(CACHE_DIR);
        for (const item of items) {
          if (preserve.has(item)) continue;
          const fp = path.join(CACHE_DIR, item);
          const stat = fs.statSync(fp);
          if (stat.isFile()) {
            fs.unlinkSync(fp);
            count++;
          } else if (stat.isDirectory()) {
            count += clearDir(fp);
            fs.rmdirSync(fp);
          }
        }
      }
      return NextResponse.json({ success: true, deleted: count });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: "Cache operation failed", detail: String(err) },
      { status: 500 }
    );
  }
}
