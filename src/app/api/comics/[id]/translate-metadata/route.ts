import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { translateMetadataFields, loadAIConfig } from "@/lib/ai-service";

// Local genre translation map for quick translation without AI
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

// Build reverse map (zh -> en)
const GENRE_ZH_TO_EN: Record<string, string> = {};
for (const [en, zh] of Object.entries(GENRE_EN_TO_ZH)) {
  GENRE_ZH_TO_EN[zh] = en;
}

function isLikelyChinese(text: string): boolean {
  const cjk = text.match(/[\u4e00-\u9fff]/g);
  return !!cjk && cjk.length > text.length * 0.15;
}

function translateGenreLocal(genre: string, targetLang: string): string {
  const parts = genre.split(/[,，]/).map((g) => g.trim()).filter(Boolean);
  const toChinese = targetLang.startsWith("zh");

  return parts
    .map((g) => {
      const lower = g.toLowerCase();
      if (toChinese) {
        return GENRE_EN_TO_ZH[lower] || g;
      } else {
        return GENRE_ZH_TO_EN[g] || g;
      }
    })
    .join(", ");
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { targetLang } = await request.json();

    if (!targetLang) {
      return NextResponse.json({ error: "targetLang is required" }, { status: 400 });
    }

    // Get current comic metadata
    const comic = await prisma.comic.findUnique({
      where: { id },
      select: {
        title: true,
        author: true,
        description: true,
        genre: true,
        seriesName: true,
        publisher: true,
      },
    });

    if (!comic) {
      return NextResponse.json({ error: "Comic not found" }, { status: 404 });
    }

    // Check if there's anything to translate
    const hasContent = comic.title || comic.author || comic.description || comic.genre || comic.seriesName || comic.publisher;
    if (!hasContent) {
      return NextResponse.json({ translated: 0, message: "No metadata to translate" });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = {};
    let translated = 0;

    // Try local genre translation first
    if (comic.genre) {
      const localGenre = translateGenreLocal(comic.genre, targetLang);
      if (localGenre !== comic.genre) {
        updateData.genre = localGenre;
        translated++;
      }
    }

    // Try AI translation for all fields
    const config = loadAIConfig();
    if (config.enableCloudAI && config.cloudApiKey) {
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
          if (result.title && result.title !== comic.title) {
            updateData.title = result.title;
            translated++;
          }
          if (result.description && result.description !== comic.description) {
            updateData.description = result.description;
            translated++;
          }
          if (result.genre && result.genre !== comic.genre) {
            updateData.genre = result.genre;
            translated++;
          }
          if (result.seriesName && result.seriesName !== comic.seriesName) {
            updateData.seriesName = result.seriesName;
            translated++;
          }
        }
      } catch (err) {
        console.warn("AI metadata translation failed:", err);
        // Fall through — local genre translation may still apply
      }
    } else {
      // No AI available, only local genre translation is possible
      // Also try simple detection: if targeting Chinese but fields are English (or vice versa)
      // We can't translate without AI, so just the genre local map is used
    }

    // Apply updates if any
    if (Object.keys(updateData).length > 0) {
      await prisma.comic.update({
        where: { id },
        data: updateData,
      });
    }

    return NextResponse.json({
      translated: Object.keys(updateData).length,
      fields: Object.keys(updateData),
    });
  } catch (err) {
    console.error("Metadata translation failed:", err);
    return NextResponse.json(
      { error: "Translation failed" },
      { status: 500 }
    );
  }
}
