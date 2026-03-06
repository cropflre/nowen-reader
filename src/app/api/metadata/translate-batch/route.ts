import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { translateMetadataFields, loadAIConfig } from "@/lib/ai-service";

// Local genre translation map
const GENRE_EN_TO_ZH: Record<string, string> = {
  action: "动作", adventure: "冒险", comedy: "喜剧", drama: "剧情",
  fantasy: "奇幻", horror: "恐怖", mystery: "悬疑", romance: "恋爱",
  "sci-fi": "科幻", "science fiction": "科幻", "slice of life": "日常",
  sports: "运动", supernatural: "超自然", thriller: "惊悚",
  psychological: "心理", historical: "历史", mecha: "机甲",
  "martial arts": "武术", music: "音乐", school: "校园",
  "school life": "校园", ecchi: "卖萌", harem: "后宫",
  isekai: "异世界", josei: "女性向", seinen: "青年",
  shoujo: "少女", shounen: "少年", yaoi: "耽美",
  yuri: "百合", military: "军事", police: "警察",
  space: "太空", vampire: "吸血鬼", magic: "魔法",
  demons: "恶魔", game: "游戏", parody: "恶搞",
  samurai: "武士", "super power": "超能力", cars: "赛车",
  kids: "儿童", shounen_ai: "少年爱", shoujo_ai: "少女爱",
  mahou_shoujo: "魔法少女", "magical girl": "魔法少女",
  cooking: "美食", food: "美食", gourmet: "美食",
  "award winning": "获奖作品", suspense: "悬疑", manga: "漫画",
  manhwa: "韩漫", manhua: "国漫", doujinshi: "同人",
  "one shot": "单篇", anthology: "选集", "4-koma": "四格漫画",
  adaptation: "改编", "full color": "全彩", "long strip": "条漫",
  "web comic": "网络漫画", adult: "成人", mature: "成熟",
  crime: "犯罪", tragedy: "悲剧", philosophical: "哲学",
  survival: "生存", "post-apocalyptic": "末日后", cyberpunk: "赛博朋克",
  steampunk: "蒸汽朋克", noir: "黑色", western: "西部",
  wuxia: "武侠", xianxia: "仙侠", cultivation: "修仙",
  reincarnation: "转生", "time travel": "穿越", villainess: "恶役",
  "reverse harem": "逆后宫", omegaverse: "ABO",
};
const GENRE_ZH_TO_EN: Record<string, string> = {};
for (const [en, zh] of Object.entries(GENRE_EN_TO_ZH)) {
  GENRE_ZH_TO_EN[zh] = en;
}

function translateGenreLocal(genre: string, targetLang: string): string {
  const parts = genre.split(/[,，]/).map((g) => g.trim()).filter(Boolean);
  const toChinese = targetLang.startsWith("zh");
  return parts
    .map((g) => {
      const lower = g.toLowerCase();
      if (toChinese) return GENRE_EN_TO_ZH[lower] || g;
      return GENRE_ZH_TO_EN[g] || g;
    })
    .join(", ");
}

export async function POST(request: NextRequest) {
  const { targetLang } = await request.json();
  if (!targetLang) {
    return new Response(JSON.stringify({ error: "targetLang is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      try {
        // Get all comics with metadata
        const comics = await prisma.comic.findMany({
          where: {
            OR: [
              { title: { not: "" } },
              { author: { not: null } },
              { description: { not: null } },
              { genre: { not: null } },
              { seriesName: { not: null } },
              { publisher: { not: null } },
            ],
          },
          select: {
            id: true,
            title: true,
            author: true,
            description: true,
            genre: true,
            seriesName: true,
            publisher: true,
          },
        });

        const total = comics.length;
        let success = 0;
        let failed = 0;
        let skipped = 0;

        const config = loadAIConfig();
        const hasAI = config.enableCloudAI && config.cloudApiKey;

        for (let i = 0; i < comics.length; i++) {
          const comic = comics[i];
          send({
            type: "progress",
            index: i,
            total,
            title: comic.title,
            percent: Math.round(((i + 1) / total) * 100),
          });

          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const updateData: any = {};

            // Local genre translation
            if (comic.genre) {
              const localGenre = translateGenreLocal(comic.genre, targetLang);
              if (localGenre !== comic.genre) {
                updateData.genre = localGenre;
              }
            }

            // AI translation for all fields
            if (hasAI) {
              try {
                const result = await translateMetadataFields(
                  {
                    title: comic.title || undefined,
                    author: comic.author || undefined,
                    description: comic.description || undefined,
                    genre: comic.genre || undefined,
                    seriesName: comic.seriesName || undefined,
                    publisher: comic.publisher || undefined,
                  },
                  targetLang
                );

                if (result) {
                  if (result.title && result.title !== comic.title) updateData.title = result.title;
                  if (result.description && result.description !== comic.description) updateData.description = result.description;
                  if (result.genre && result.genre !== comic.genre) updateData.genre = result.genre;
                  if (result.seriesName && result.seriesName !== comic.seriesName) updateData.seriesName = result.seriesName;
                }
              } catch {
                // AI failed, continue with local translation only
              }
            }

            if (Object.keys(updateData).length > 0) {
              await prisma.comic.update({
                where: { id: comic.id },
                data: updateData,
              });
              success++;
            } else {
              skipped++;
            }
          } catch {
            failed++;
          }
        }

        send({
          type: "done",
          success,
          failed,
          skipped,
          total,
        });
      } catch (err) {
        send({ type: "error", message: String(err) });
      } finally {
        controller.close();
      }
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
