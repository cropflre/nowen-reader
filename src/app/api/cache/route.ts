import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { THUMBNAILS_DIR } from "@/lib/config";

const CACHE_DIR = path.join(process.cwd(), ".cache");

export async function POST(request: NextRequest) {
  try {
    const { action } = await request.json();

    if (action === "clear-thumbnails") {
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

    if (action === "clear-search") {
      // Clear phash cache and any search-related caches
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
      let count = 0;
      // Clear thumbnails
      if (fs.existsSync(THUMBNAILS_DIR)) {
        const files = fs.readdirSync(THUMBNAILS_DIR);
        for (const file of files) {
          fs.unlinkSync(path.join(THUMBNAILS_DIR, file));
          count++;
        }
      }
      // Clear other caches (preserve site-config and ai-config)
      const preserve = new Set(["site-config.json", "ai-config.json", "thumbnails"]);
      if (fs.existsSync(CACHE_DIR)) {
        const items = fs.readdirSync(CACHE_DIR);
        for (const item of items) {
          if (preserve.has(item)) continue;
          const fp = path.join(CACHE_DIR, item);
          const stat = fs.statSync(fp);
          if (stat.isFile()) {
            fs.unlinkSync(fp);
            count++;
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
