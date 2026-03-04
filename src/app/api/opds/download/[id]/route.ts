import { NextResponse } from "next/server";
import { findComicById } from "@/lib/comic-parser";
import fs from "fs";
import path from "path";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const comic = await findComicById(id);

  if (!comic) {
    return NextResponse.json({ error: "Comic not found" }, { status: 404 });
  }

  if (!fs.existsSync(comic.filepath)) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const data = fs.readFileSync(comic.filepath);
  const ext = path.extname(comic.filename).toLowerCase();

  const mimeTypes: Record<string, string> = {
    ".zip": "application/zip",
    ".cbz": "application/x-cbz",
    ".rar": "application/x-rar-compressed",
    ".cbr": "application/x-cbr",
    ".7z": "application/x-7z-compressed",
    ".cb7": "application/x-cb7",
    ".pdf": "application/pdf",
  };

  return new NextResponse(data, {
    status: 200,
    headers: {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(comic.filename)}"`,
      "Content-Length": data.length.toString(),
    },
  });
}
