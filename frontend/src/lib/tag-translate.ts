/**
 * Tag Translation Service
 * 
 * Translates tags between English and Chinese using:
 * 1. A local bidirectional mapping table (instant, no API needed)
 * 2. Cloud AI as fallback for unmapped tags (if configured)
 */

// ============================================================
// Bidirectional tag mapping (English ↔ Chinese)
// ============================================================

const EN_TO_ZH: Record<string, string> = {
  // Common genres
  "action": "动作",
  "adventure": "冒险",
  "comedy": "喜剧",
  "drama": "剧情",
  "fantasy": "奇幻",
  "horror": "恐怖",
  "mystery": "悬疑",
  "romance": "恋爱",
  "sci-fi": "科幻",
  "science fiction": "科幻",
  "slice of life": "日常",
  "sports": "运动",
  "supernatural": "超自然",
  "thriller": "惊悚",
  "psychological": "心理",
  "historical": "历史",
  "mecha": "机甲",
  "music": "音乐",
  "martial arts": "武术",
  "military": "军事",
  "police": "警察",
  "school": "校园",
  "school life": "校园",
  "space": "太空",
  "magic": "魔法",
  "mahou shoujo": "魔法少女",
  "magical girls": "魔法少女",
  "vampire": "吸血鬼",
  "demons": "恶魔",
  "game": "游戏",
  "harem": "后宫",
  "reverse harem": "逆后宫",
  "parody": "恶搞",
  "samurai": "武士",
  "super power": "超能力",
  "superpower": "超能力",
  "kids": "儿童",
  "seinen": "青年",
  "shounen": "少年",
  "shoujo": "少女",
  "josei": "女性",
  "ecchi": "卖肉",
  "gender bender": "性别转换",
  "isekai": "异世界",
  "gourmet": "美食",
  "cooking": "料理",
  "survival": "生存",
  "crime": "犯罪",
  "detective": "侦探",
  "post-apocalyptic": "末日",
  "apocalypse": "末日",
  "tragedy": "悲剧",
  "war": "战争",
  "cyberpunk": "赛博朋克",
  "steampunk": "蒸汽朋克",
  "dystopia": "反乌托邦",
  "utopia": "乌托邦",
  "wuxia": "武侠",
  "xianxia": "仙侠",
  "xuanhuan": "玄幻",
  "reincarnation": "转生",
  "time travel": "穿越",
  "zombie": "丧尸",
  "zombies": "丧尸",
  "monster": "怪物",
  "monsters": "怪物",
  "animals": "动物",
  "pets": "宠物",
  "award winning": "获奖作品",
  "coming of age": "成长",
  "delinquents": "不良少年",
  "family": "家庭",
  "friendship": "友情",
  "love triangle": "三角关系",
  "revenge": "复仇",
  "time manipulation": "时间操控",
  "work": "职场",
  "workplace": "职场",
  "medical": "医疗",
  "mythology": "神话",
  "philosophical": "哲学",
  "crossdressing": "女装",
  "ninja": "忍者",
  "idol": "偶像",
  "idols": "偶像",
  "performing arts": "表演艺术",
  "otaku culture": "宅文化",
  "satire": "讽刺",
  "suspense": "悬疑",
  "urban": "都市",
  "villainess": "恶役",
  "virtual world": "虚拟世界",
  "based on a novel": "小说改编",
  "based on a manga": "漫画改编",
  "based on a video game": "游戏改编",
  "anthology": "短篇集",
  "4-koma": "四格漫画",
  "adaptation": "改编",
  "full color": "全彩",
  "web comic": "网络漫画",
  "webtoon": "条漫",
  "long strip": "条漫",
  "doujinshi": "同人志",
  "one shot": "单篇",
  "oneshot": "单篇",
  "gore": "血腥",
  "violence": "暴力",
  "mature": "成人",
  "adult": "成人",
};

// Build reverse map (Chinese → English)
const ZH_TO_EN: Record<string, string> = {};
const seen = new Set<string>();
for (const [en, zh] of Object.entries(EN_TO_ZH)) {
  // For duplicate Chinese values, keep the first (most common) English term
  if (!seen.has(zh)) {
    ZH_TO_EN[zh] = en.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    seen.add(zh);
  }
}

/**
 * Check if a string appears to be Chinese
 */
function isChinese(str: string): boolean {
  return /[\u4e00-\u9fff]/.test(str);
}

/**
 * Translate a single tag using local mapping
 */
function translateTagLocal(tag: string, targetLang: string): string | null {
  const isTargetZh = targetLang.startsWith("zh");

  if (isTargetZh) {
    // English → Chinese
    const key = tag.toLowerCase().trim();
    return EN_TO_ZH[key] || null;
  } else {
    // Chinese → English
    const trimmed = tag.trim();
    return ZH_TO_EN[trimmed] || null;
  }
}

/**
 * Check if a tag needs translation (is it already in the target language?)
 */
function needsTranslation(tag: string, targetLang: string): boolean {
  const isTargetZh = targetLang.startsWith("zh");
  const tagIsChinese = isChinese(tag);

  if (isTargetZh && tagIsChinese) return false; // Already Chinese
  if (!isTargetZh && !tagIsChinese) return false; // Already English
  return true;
}

/**
 * Translate tags using AI (for tags not in the local mapping)
 */
async function translateTagsWithAI(
  tags: string[],
  targetLang: string
): Promise<Record<string, string>> {
  try {
    const { loadAIConfig } = await import("./ai-service");
    const config = loadAIConfig();
    if (!config.enableCloudAI || !config.cloudApiKey) return {};

    const { translateMetadataFields } = await import("./ai-service");

    // Use the genre field to translate tags in batch
    const genreString = tags.join(", ");
    const result = await translateMetadataFields(
      { genre: genreString },
      targetLang
    );

    if (!result?.genre) return {};

    // Parse the translated tags back
    const translatedTags = result.genre.split(",").map((t: string) => t.trim());
    const mapping: Record<string, string> = {};

    for (let i = 0; i < tags.length && i < translatedTags.length; i++) {
      if (translatedTags[i] && translatedTags[i] !== tags[i]) {
        mapping[tags[i]] = translatedTags[i];
      }
    }

    return mapping;
  } catch (err) {
    console.error("AI tag translation failed:", err);
    return {};
  }
}

/**
 * Main function: Translate all given tags to the target language.
 * Returns a mapping of { originalName: translatedName }.
 * Tags already in the target language are excluded from results.
 */
export async function translateTags(
  tagNames: string[],
  targetLang: string
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const unmapped: string[] = [];

  for (const tag of tagNames) {
    if (!needsTranslation(tag, targetLang)) continue;

    const local = translateTagLocal(tag, targetLang);
    if (local) {
      result[tag] = local;
    } else {
      unmapped.push(tag);
    }
  }

  // Use AI for unmapped tags (if any and AI is configured)
  if (unmapped.length > 0) {
    const aiResults = await translateTagsWithAI(unmapped, targetLang);
    Object.assign(result, aiResults);
  }

  return result;
}
