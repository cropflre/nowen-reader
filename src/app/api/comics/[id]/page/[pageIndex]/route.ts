import { NextResponse } from "next/server";
import { getPageImage, getPageImageAsync } from "@/lib/comic-parser";
import { findComicById } from "@/lib/comic-parser";
import { getArchiveType } from "@/lib/archive-parser";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; pageIndex: string }> }
) {
  const { id, pageIndex: pageIndexStr } = await params;
  const pageIndex = parseInt(pageIndexStr, 10);

  if (isNaN(pageIndex) || pageIndex < 0) {
    return NextResponse.json(
      { error: "Invalid page index" },
      { status: 400 }
    );
  }

  const comic = await findComicById(id);
  if (!comic) {
    return NextResponse.json(
      { error: "Comic not found" },
      { status: 404 }
    );
  }

  const archiveType = getArchiveType(comic.filepath);

  // Use async for PDF, sync for others
  let result: { buffer: Buffer; mimeType: string } | null = null;

  if (archiveType === "pdf") {
    result = await getPageImageAsync(id, pageIndex);
  } else {
    result = await getPageImage(id, pageIndex);
  }

  if (!result) {
    return NextResponse.json(
      { error: "Page not found" },
      { status: 404 }
    );
  }

  return new NextResponse(new Uint8Array(result.buffer), {
    status: 200,
    headers: {
      "Content-Type": result.mimeType,
      "Cache-Control": "public, max-age=86400, immutable",
      "Content-Length": result.buffer.length.toString(),
    },
  });
}
