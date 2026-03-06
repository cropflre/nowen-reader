import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { translateTags } from "@/lib/tag-translate";

/**
 * POST /api/tags/translate
 * Translate all tags to the target language, replacing old tag names in-place.
 * Body: { targetLang: "zh-CN" | "en" }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const targetLang: string = body.targetLang || "zh-CN";

    // Get all tags from database
    const allTags = await prisma.tag.findMany({
      include: {
        comics: true,
      },
    });

    if (allTags.length === 0) {
      return NextResponse.json({ translated: 0, tags: [] });
    }

    const tagNames = allTags.map((t) => t.name);
    const translations = await translateTags(tagNames, targetLang);

    let translatedCount = 0;
    const results: { from: string; to: string }[] = [];

    for (const tag of allTags) {
      const newName = translations[tag.name];
      if (!newName || newName === tag.name) continue;

      // Check if the target name already exists
      const existing = await prisma.tag.findUnique({ where: { name: newName } });

      if (existing && existing.id !== tag.id) {
        // Merge: reassign all comic-tag links from old tag to existing tag
        const links = await prisma.comicTag.findMany({ where: { tagId: tag.id } });
        for (const link of links) {
          // Upsert to avoid unique constraint violation
          await prisma.comicTag.upsert({
            where: { comicId_tagId: { comicId: link.comicId, tagId: existing.id } },
            create: { comicId: link.comicId, tagId: existing.id },
            update: {},
          });
        }
        // Delete old links and old tag
        await prisma.comicTag.deleteMany({ where: { tagId: tag.id } });
        await prisma.tag.delete({ where: { id: tag.id } });
      } else {
        // Simply rename the tag
        await prisma.tag.update({
          where: { id: tag.id },
          data: { name: newName },
        });
      }

      results.push({ from: tag.name, to: newName });
      translatedCount++;
    }

    return NextResponse.json({
      translated: translatedCount,
      tags: results,
    });
  } catch (err) {
    console.error("Failed to translate tags:", err);
    return NextResponse.json(
      { error: "Failed to translate tags" },
      { status: 500 }
    );
  }
}
