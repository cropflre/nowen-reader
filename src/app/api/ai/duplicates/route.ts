import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { loadAIConfig, findVisuallySimilarCovers } from "@/lib/ai-service";
import { THUMBNAILS_DIR } from "@/lib/config";

export async function GET() {
  try {
    const config = loadAIConfig();
    if (!config.enablePerceptualHash) {
      return NextResponse.json({ error: "Perceptual hash is disabled" }, { status: 400 });
    }

    const comics = await prisma.comic.findMany({
      select: {
        id: true,
        filename: true,
        title: true,
        fileSize: true,
        pageCount: true,
        addedAt: true,
      },
      orderBy: { title: "asc" },
    });

    const similarGroups = await findVisuallySimilarCovers(
      comics.map((c) => ({ id: c.id, filename: c.filename, title: c.title })),
      THUMBNAILS_DIR,
      10 // hamming distance threshold
    );

    // Enrich with comic data
    const comicMap = new Map(comics.map((c) => [c.id, c]));
    const enrichedGroups = similarGroups.map((group) => ({
      reason: group.reason,
      comics: group.comics
        .map((id) => {
          const c = comicMap.get(id);
          if (!c) return null;
          return {
            id: c.id,
            filename: c.filename,
            title: c.title,
            fileSize: c.fileSize,
            pageCount: c.pageCount,
            addedAt: c.addedAt.toISOString(),
            coverUrl: `/api/comics/${c.id}/thumbnail`,
          };
        })
        .filter(Boolean),
    }));

    return NextResponse.json({
      groups: enrichedGroups.filter((g) => g.comics.length > 1),
    });
  } catch (err) {
    console.error("AI duplicate detection error:", err);
    return NextResponse.json({ error: "Detection failed" }, { status: 500 });
  }
}
