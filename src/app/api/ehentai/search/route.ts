import { NextRequest, NextResponse } from "next/server";
import { search, isConfigured } from "@/lib/ehentai-service";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") || "";
  const page = parseInt(searchParams.get("page") || "0", 10);
  const category = parseInt(searchParams.get("category") || "0", 10);

  if (!query) {
    return NextResponse.json({ error: "Missing search query" }, { status: 400 });
  }

  try {
    const result = await search(query, page, category);

    return NextResponse.json({
      ...result,
      configured: isConfigured(),
    });
  } catch (err) {
    console.error("[ehentai/search] Error:", err);
    return NextResponse.json(
      { error: "Failed to search E-Hentai" },
      { status: 500 }
    );
  }
}
