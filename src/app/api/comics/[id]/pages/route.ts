import { NextResponse } from "next/server";
import { getComicPages, findComicById } from "@/lib/comic-parser";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const comic = await findComicById(id);
  if (!comic) {
    return NextResponse.json({ error: "Comic not found" }, { status: 404 });
  }

  const pages = await getComicPages(id);

  return NextResponse.json({
    comicId: id,
    title: comic.title,
    totalPages: pages.length,
    pages: pages.map((name, index) => ({
      index,
      name,
      url: `/api/comics/${id}/page/${index}`,
    })),
  });
}
