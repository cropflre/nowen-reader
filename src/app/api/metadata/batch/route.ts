import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import { extractComicInfoFromArchive, searchMetadata, applyMetadata, translateMetadataForDisplay } from "@/lib/metadata-scraper";
import { findComicById } from "@/lib/comic-parser";
import path from "path";

const prisma = new PrismaClient();

function extractSearchQuery(filename: string): string {
  let name = path.parse(filename).name;
  name = name.replace(/[\[【\(（{][^\]】\)）}]*[\]】\)）}]/g, " ");
  name = name.replace(/\b(v|vol|ch|c|#)\.?\s*\d+/gi, " ");
  name = name.replace(/\b\d{3,4}[px]\b/gi, " ");
  name = name.replace(/[-_\.]+/g, " ");
  name = name.replace(/\s+/g, " ").trim();
  return name;
}

export async function POST(request: NextRequest) {
  const { lang, mode } = await request.json();
  // mode: "all" | "missing" (only comics without metadata)

  const where = mode === "missing"
    ? { OR: [{ author: "" }, { author: null as unknown as string }, { description: "" }, { description: null as unknown as string }] }
    : {};

  const comics = await prisma.comic.findMany({
    where,
    select: { id: true, filename: true, title: true, author: true, description: true },
    orderBy: { title: "asc" },
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      send({ type: "start", total: comics.length });

      let success = 0;
      let failed = 0;
      let skipped = 0;

      for (let i = 0; i < comics.length; i++) {
        const comic = comics[i];
        send({
          type: "progress",
          index: i,
          total: comics.length,
          comicId: comic.id,
          title: comic.title,
          percent: Math.round(((i) / comics.length) * 100),
        });

        try {
          const found = await findComicById(comic.id);
          if (!found) {
            skipped++;
            send({ type: "item", index: i, comicId: comic.id, status: "skipped", reason: "not found" });
            continue;
          }

          // Try ComicInfo.xml first
          let metadata = await extractComicInfoFromArchive(found.filepath);
          let source = "comicinfo";

          if (metadata) {
            if (lang) {
              metadata = await translateMetadataForDisplay(metadata, lang);
            }
          } else {
            // Fallback to online search
            const query = extractSearchQuery(comic.filename);
            if (!query) {
              skipped++;
              send({ type: "item", index: i, comicId: comic.id, status: "skipped", reason: "no query" });
              continue;
            }

            const results = await searchMetadata(query, undefined, lang);
            if (results.length === 0) {
              failed++;
              send({ type: "item", index: i, comicId: comic.id, status: "not_found", query });
              continue;
            }

            metadata = results[0];
            source = metadata.source;
          }

          await applyMetadata(comic.id, metadata, lang);
          success++;
          send({
            type: "item",
            index: i,
            comicId: comic.id,
            status: "success",
            source,
            title: metadata.title || comic.title,
          });
        } catch (err) {
          failed++;
          send({
            type: "item",
            index: i,
            comicId: comic.id,
            status: "error",
            error: String(err).slice(0, 200),
          });
        }

        // Small delay to avoid rate limiting
        await new Promise((r) => setTimeout(r, 300));
      }

      send({ type: "done", success, failed, skipped, total: comics.length });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
