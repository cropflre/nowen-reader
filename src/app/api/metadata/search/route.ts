import { NextRequest, NextResponse } from "next/server";
import { searchMetadata } from "@/lib/metadata-scraper";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q");
    const sourcesParam = searchParams.get("sources");
    const lang = searchParams.get("lang") || undefined;

    if (!query) {
      return NextResponse.json(
        { error: "Query parameter 'q' is required" },
        { status: 400 }
      );
    }

    const sources = sourcesParam ? sourcesParam.split(",") : undefined;
    const results = await searchMetadata(query, sources, lang);

    return NextResponse.json({ results });
  } catch (err) {
    console.error("Metadata search error:", err);
    return NextResponse.json(
      { error: "Search failed" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query, sources, lang } = body;

    if (!query) {
      return NextResponse.json(
        { error: "Field 'query' is required" },
        { status: 400 }
      );
    }

    const results = await searchMetadata(query, sources, lang);

    return NextResponse.json({ results });
  } catch (err) {
    console.error("Metadata search error:", err);
    return NextResponse.json(
      { error: "Search failed" },
      { status: 500 }
    );
  }
}
