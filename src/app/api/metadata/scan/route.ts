import { NextRequest, NextResponse } from "next/server";
import { extractComicInfoFromArchive, applyMetadata } from "@/lib/metadata-scraper";
import { findComicById } from "@/lib/comic-parser";

export async function POST(request: NextRequest) {
  try {
    const { comicId } = await request.json();

    if (!comicId) {
      return NextResponse.json(
        { error: "comicId is required" },
        { status: 400 }
      );
    }

    const comic = await findComicById(comicId);
    if (!comic) {
      return NextResponse.json(
        { error: "Comic not found" },
        { status: 404 }
      );
    }

    const metadata = await extractComicInfoFromArchive(comic.filepath);

    if (!metadata) {
      return NextResponse.json({
        found: false,
        message: "No ComicInfo.xml found in archive",
      });
    }

    // Apply the extracted metadata
    const updated = await applyMetadata(comicId, metadata);

    return NextResponse.json({
      found: true,
      metadata,
      comic: updated,
    });
  } catch (err) {
    console.error("Metadata scan error:", err);
    return NextResponse.json(
      { error: "Failed to scan metadata" },
      { status: 500 }
    );
  }
}
