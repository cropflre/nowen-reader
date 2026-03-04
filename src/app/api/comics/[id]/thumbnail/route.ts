import { NextResponse } from "next/server";
import { getComicThumbnail, findComicById } from "@/lib/comic-parser";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const comic = await findComicById(id);
  if (!comic) {
    return NextResponse.json({ error: "Comic not found" }, { status: 404 });
  }

  const thumbnail = await getComicThumbnail(id);
  if (!thumbnail) {
    return NextResponse.json(
      { error: "Failed to generate thumbnail" },
      { status: 500 }
    );
  }

  return new NextResponse(new Uint8Array(thumbnail), {
    status: 200,
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=604800, immutable",
      "Content-Length": thumbnail.length.toString(),
    },
  });
}
