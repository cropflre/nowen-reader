import { NextRequest, NextResponse } from "next/server";
import { getGalleryDetail, getRealImageUrl, delay } from "@/lib/ehentai-service";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ gid: string; token: string }> }
) {
  const { gid, token } = await params;

  try {
    const detail = await getGalleryDetail(gid, token);
    return NextResponse.json(detail);
  } catch (err) {
    console.error("[ehentai/gallery] Error:", err);
    return NextResponse.json(
      { error: "Failed to fetch gallery detail" },
      { status: 500 }
    );
  }
}

/**
 * POST: Fetch real image URLs for a batch of page links.
 * Body: { pageLinks: string[], startIndex?: number, count?: number }
 * Returns resolved image URLs one batch at a time to stay under rate limits.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ gid: string; token: string }> }
) {
  await params; // consume params to avoid unused warning

  try {
    const body = await request.json();
    const pageLinks: string[] = body.pageLinks || [];
    const startIndex = body.startIndex || 0;
    const count = Math.min(body.count || 5, 10); // max 10 per batch

    const batch = pageLinks.slice(startIndex, startIndex + count);
    const results: { index: number; imageUrl: string; filename: string }[] = [];

    for (let i = 0; i < batch.length; i++) {
      try {
        const { imageUrl, filename } = await getRealImageUrl(batch[i]);
        results.push({
          index: startIndex + i,
          imageUrl,
          filename,
        });
      } catch (err) {
        console.error(`[ehentai] Failed to resolve page ${startIndex + i}:`, err);
        results.push({
          index: startIndex + i,
          imageUrl: "",
          filename: "",
        });
      }

      // Rate limiting: delay between each page request
      if (i < batch.length - 1) {
        await delay(1500);
      }
    }

    return NextResponse.json({
      results,
      hasMore: startIndex + count < pageLinks.length,
      nextIndex: startIndex + count,
    });
  } catch (err) {
    console.error("[ehentai/gallery] POST Error:", err);
    return NextResponse.json(
      { error: "Failed to resolve image URLs" },
      { status: 500 }
    );
  }
}
