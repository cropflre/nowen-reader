import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { THUMBNAILS_DIR } from "@/lib/config";
import { PrismaClient } from "@prisma/client";
import { getComicThumbnail } from "@/lib/comic-parser";

const prisma = new PrismaClient();

export async function POST(request: NextRequest) {
  try {
    const { action } = await request.json();

    const comics = await prisma.comic.findMany({
      select: { id: true, filename: true },
    });

    if (!fs.existsSync(THUMBNAILS_DIR)) {
      fs.mkdirSync(THUMBNAILS_DIR, { recursive: true });
    }

    if (action === "generate-missing") {
      let generated = 0;
      let skipped = 0;
      for (const comic of comics) {
        const cachePath = path.join(THUMBNAILS_DIR, `${comic.id}.webp`);
        if (fs.existsSync(cachePath)) {
          skipped++;
          continue;
        }
        try {
          await getComicThumbnail(comic.id);
          generated++;
        } catch {
          // skip failed
        }
      }
      return NextResponse.json({ success: true, generated, skipped, total: comics.length });
    }

    if (action === "regenerate-all") {
      // Delete all existing thumbnails first
      if (fs.existsSync(THUMBNAILS_DIR)) {
        const files = fs.readdirSync(THUMBNAILS_DIR);
        for (const file of files) {
          fs.unlinkSync(path.join(THUMBNAILS_DIR, file));
        }
      }
      let generated = 0;
      let failed = 0;
      for (const comic of comics) {
        try {
          await getComicThumbnail(comic.id);
          generated++;
        } catch {
          failed++;
        }
      }
      return NextResponse.json({ success: true, generated, failed, total: comics.length });
    }

    // Stats
    if (action === "stats") {
      let existing = 0;
      let missing = 0;
      for (const comic of comics) {
        const cachePath = path.join(THUMBNAILS_DIR, `${comic.id}.webp`);
        if (fs.existsSync(cachePath)) {
          existing++;
        } else {
          missing++;
        }
      }
      return NextResponse.json({ total: comics.length, existing, missing });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: "Thumbnail operation failed", detail: String(err) },
      { status: 500 }
    );
  }
}
