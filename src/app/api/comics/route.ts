import { NextRequest, NextResponse } from "next/server";
import { syncComicsToDatabase, getAllComics } from "@/lib/comic-service";

export async function GET(request: NextRequest) {
  try {
    // Sync filesystem with database first
    await syncComicsToDatabase();

    // Parse query params
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || undefined;
    const tagsParam = searchParams.get("tags");
    const tags = tagsParam ? tagsParam.split(",").filter(Boolean) : undefined;
    const favoritesOnly = searchParams.get("favorites") === "true";
    const sortBy = (searchParams.get("sortBy") as "title" | "addedAt" | "lastReadAt" | "rating" | "custom") || "title";
    const sortOrder = (searchParams.get("sortOrder") as "asc" | "desc") || "asc";

    const page = parseInt(searchParams.get("page") || "0", 10) || undefined;
    const pageSize = parseInt(searchParams.get("pageSize") || "0", 10) || undefined;
    const category = searchParams.get("category") || undefined;

    const result = await getAllComics({
      search,
      tags,
      favoritesOnly,
      sortBy,
      sortOrder,
      page,
      pageSize,
      category,
    });

    return NextResponse.json({
      comics: result.comics,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages,
    }, {
      headers: {
        "Cache-Control": "private, max-age=5, stale-while-revalidate=30",
      },
    });
  } catch (err) {
    console.error("Failed to fetch comics:", err);
    return NextResponse.json(
      { error: "Failed to fetch comics" },
      { status: 500 }
    );
  }
}
