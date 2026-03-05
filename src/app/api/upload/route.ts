import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getComicsDir, SUPPORTED_EXTENSIONS } from "@/lib/config";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll("files") as File[];

    if (files.length === 0) {
      return NextResponse.json(
        { error: "No files provided" },
        { status: 400 }
      );
    }

    // Ensure comics dir exists
    const COMICS_DIR = getComicsDir();
    if (!fs.existsSync(COMICS_DIR)) {
      fs.mkdirSync(COMICS_DIR, { recursive: true });
    }

    const results: { filename: string; success: boolean; error?: string }[] =
      [];

    for (const file of files) {
      const ext = path.extname(file.name).toLowerCase();

      if (!SUPPORTED_EXTENSIONS.includes(ext)) {
        results.push({
          filename: file.name,
          success: false,
          error: `Unsupported format: ${ext}`,
        });
        continue;
      }

      try {
        const buffer = Buffer.from(await file.arrayBuffer());
        const destPath = path.join(COMICS_DIR, file.name);

        // Don't overwrite existing files
        if (fs.existsSync(destPath)) {
          results.push({
            filename: file.name,
            success: false,
            error: "File already exists",
          });
          continue;
        }

        fs.writeFileSync(destPath, buffer);
        results.push({ filename: file.name, success: true });
      } catch (err) {
        results.push({
          filename: file.name,
          success: false,
          error: "Failed to save file",
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;

    return NextResponse.json({
      message: `${successCount} of ${files.length} files uploaded`,
      results,
    });
  } catch (err) {
    console.error("Upload error:", err);
    return NextResponse.json(
      { error: "Upload failed" },
      { status: 500 }
    );
  }
}
