import { NextResponse } from "next/server";
import { getComicThumbnail, findComicById } from "@/lib/comic-parser";
import { THUMBNAILS_DIR } from "@/lib/config";
import path from "path";
import fs from "fs";

export async function GET(
  request: Request,
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

  // 基于缩略图文件修改时间生成 ETag
  const cachePath = path.join(THUMBNAILS_DIR, `${id}.webp`);
  let etag = `"${thumbnail.length}"`;
  try {
    const stat = fs.statSync(cachePath);
    etag = `"${stat.mtimeMs.toString(36)}-${stat.size.toString(36)}"`;
  } catch {
    // 缓存文件不存在时用长度作为 ETag
  }

  // 支持条件请求 - 客户端已有最新缓存则返回 304
  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: { ETag: etag },
    });
  }

  return new NextResponse(new Uint8Array(thumbnail), {
    status: 200,
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=60, must-revalidate",
      "Content-Length": thumbnail.length.toString(),
      ETag: etag,
    },
  });
}
