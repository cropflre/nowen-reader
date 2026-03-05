import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { semanticSearch, loadAIConfig } from "@/lib/ai-service";

export async function GET(request: NextRequest) {
  try {
    const config = loadAIConfig();
    if (!config.enableSemanticSearch) {
      return NextResponse.json({ error: "Semantic search is disabled" }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q");
    const limit = parseInt(searchParams.get("limit") || "10", 10);

    if (!query) {
      return NextResponse.json({ error: "Query parameter 'q' required" }, { status: 400 });
    }

    // Get all comics with their tags
    const comics = await prisma.comic.findMany({
      include: {
        tags: { include: { tag: true } },
      },
    });

    // Build search corpus
    const corpus = comics.map((c) => ({
      id: c.id,
      title: c.title,
      tags: c.tags.map((ct) => ct.tag.name),
      genre: c.genre,
      author: c.author,
      description: c.description,
    }));

    // Run semantic search
    const results = semanticSearch(query, corpus, limit);

    // Map back to comic data
    const comicMap = new Map(comics.map((c) => [c.id, c]));
    const enrichedResults = results.map((r) => {
      const comic = comicMap.get(r.id)!;
      return {
        id: comic.id,
        title: comic.title,
        coverUrl: `/api/comics/${comic.id}/thumbnail`,
        score: Math.round(r.score * 100) / 100,
        author: comic.author,
        genre: comic.genre,
        tags: comic.tags.map((ct) => ({ name: ct.tag.name, color: ct.tag.color })),
      };
    });

    return NextResponse.json({ results: enrichedResults, query });
  } catch (err) {
    console.error("Semantic search error:", err);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
