import { NextRequest, NextResponse } from "next/server";
import {
  batchDeleteComics,
  batchSetFavorite,
  batchAddTags,
  batchSetGroup,
  batchSetCategory,
} from "@/lib/comic-service";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, comicIds, ...params } = body;

    if (!Array.isArray(comicIds) || comicIds.length === 0) {
      return NextResponse.json(
        { error: "comicIds array required" },
        { status: 400 }
      );
    }

    switch (action) {
      case "delete":
        await batchDeleteComics(comicIds);
        return NextResponse.json({ success: true, message: `已删除 ${comicIds.length} 本漫画` });

      case "favorite":
        await batchSetFavorite(comicIds, params.isFavorite ?? true);
        return NextResponse.json({ success: true });

      case "unfavorite":
        await batchSetFavorite(comicIds, false);
        return NextResponse.json({ success: true });

      case "addTags":
        if (!Array.isArray(params.tags) || params.tags.length === 0) {
          return NextResponse.json({ error: "tags array required" }, { status: 400 });
        }
        await batchAddTags(comicIds, params.tags);
        return NextResponse.json({ success: true });

      case "setGroup":
        await batchSetGroup(comicIds, params.groupName || "");
        return NextResponse.json({ success: true });

      case "setCategory":
        if (!Array.isArray(params.categorySlugs) || params.categorySlugs.length === 0) {
          return NextResponse.json({ error: "categorySlugs array required" }, { status: 400 });
        }
        await batchSetCategory(comicIds, params.categorySlugs);
        return NextResponse.json({ success: true });

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    console.error("Batch operation failed:", err);
    return NextResponse.json(
      { error: "Batch operation failed" },
      { status: 500 }
    );
  }
}
