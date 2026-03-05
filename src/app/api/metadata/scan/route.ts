import { NextRequest, NextResponse } from "next/server";
import { extractComicInfoFromArchive, applyMetadata, searchMetadata, translateMetadataForDisplay } from "@/lib/metadata-scraper";
import { findComicById } from "@/lib/comic-parser";
import path from "path";

/**
 * Clean filename to extract a usable search query.
 * Removes file extension, common tags like [Author], (C99), resolution, etc.
 */
function extractSearchQuery(filename: string): string {
  let name = path.parse(filename).name;

  // Remove content inside brackets: [xxx] (xxx) {xxx}
  name = name.replace(/[\[【\(（{][^\]】\)）}]*[\]】\)）}]/g, " ");
  // Remove common suffixes like v01, vol.1, #1, c01, ch.1
  name = name.replace(/\b(v|vol|ch|c|#)\.?\s*\d+/gi, " ");
  // Remove resolution/quality tags
  name = name.replace(/\b\d{3,4}[px]\b/gi, " ");
  // Remove file-related noise
  name = name.replace(/[-_\.]+/g, " ");
  // Collapse whitespace
  name = name.replace(/\s+/g, " ").trim();

  return name;
}

export async function POST(request: NextRequest) {
  try {
    const { comicId, lang } = await request.json();

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

    // Step 1: Try extracting ComicInfo.xml from the archive
    const metadata = await extractComicInfoFromArchive(comic.filepath);

    if (metadata) {
      // Translate ComicInfo.xml metadata if not in target language
      const translatedMeta = lang ? await translateMetadataForDisplay(metadata, lang) : metadata;
      const updated = await applyMetadata(comicId, translatedMeta, lang);
      return NextResponse.json({
        found: true,
        source: "comicinfo",
        metadata: translatedMeta,
        comic: updated,
      });
    }

    // Step 2: Fallback — search online sources using filename
    const searchQuery = extractSearchQuery(comic.filename);
    if (!searchQuery) {
      return NextResponse.json({
        found: false,
        message: "No ComicInfo.xml found and could not derive search query from filename",
      });
    }

    const onlineResults = await searchMetadata(searchQuery, undefined, lang);

    if (onlineResults.length === 0) {
      return NextResponse.json({
        found: false,
        message: `No ComicInfo.xml found. Online search for "${searchQuery}" returned no results`,
      });
    }

    // Apply the first (best match) result (already translated by searchMetadata)
    const bestMatch = onlineResults[0];
    const updated = await applyMetadata(comicId, bestMatch, lang);

    return NextResponse.json({
      found: true,
      source: bestMatch.source,
      searchQuery,
      metadata: bestMatch,
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
