import { NextRequest, NextResponse } from "next/server";
import {
  loadAIConfig,
  analyzeCoverWithLLM,
  completeMissingMetadata,
} from "@/lib/ai-service";
import { getComicThumbnail } from "@/lib/comic-parser";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, comicId, title, author, genre, description, tags, lang } = body;
    const config = loadAIConfig();

    if (action === "analyzeCover") {
      if (!comicId) {
        return NextResponse.json({ error: "comicId required" }, { status: 400 });
      }

      // Get thumbnail buffer
      const thumbnail = await getComicThumbnail(comicId);
      if (!thumbnail) {
        return NextResponse.json({ error: "Thumbnail not found" }, { status: 404 });
      }

      const analysis = await analyzeCoverWithLLM(thumbnail, config, title, lang);
      if (!analysis) {
        return NextResponse.json(
          { error: "Cloud AI not configured or analysis failed" },
          { status: 400 }
        );
      }

      return NextResponse.json(analysis);
    }

    if (action === "completeMetadata") {
      if (!title) {
        return NextResponse.json({ error: "title required" }, { status: 400 });
      }

      const result = await completeMissingMetadata(config, {
        title,
        author,
        genre,
        description,
        tags,
      }, lang);

      if (!result) {
        return NextResponse.json(
          { error: "Cloud AI not configured or completion failed" },
          { status: 400 }
        );
      }

      return NextResponse.json(result);
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    console.error("AI analyze error:", err);
    return NextResponse.json({ error: "Analysis failed" }, { status: 500 });
  }
}
