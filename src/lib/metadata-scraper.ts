import { prisma } from "./db";

export interface ComicMetadata {
  title?: string;
  author?: string;
  publisher?: string;
  year?: number;
  description?: string;
  language?: string;
  genre?: string;
  seriesName?: string;
  seriesIndex?: number;
  coverUrl?: string;
  source: string;
}

// ============================================================
// Genre / Tag translation map (English → Chinese)
// ============================================================

const GENRE_EN_TO_ZH: Record<string, string> = {
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

  // Themes / additional tags
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
  "politics": "政治",
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

/**
 * Translate a genre/tag string from English to Chinese.
 * Handles comma-separated lists. Unknown tags are kept as-is.
 */
function translateGenre(genre: string, lang?: string): string {
  if (!lang?.startsWith("zh")) return genre;

  return genre
    .split(",")
    .map((g) => {
      const trimmed = g.trim();
      const key = trimmed.toLowerCase();
      return GENRE_EN_TO_ZH[key] || trimmed;
    })
    .join(", ");
}

// ============================================================
// AniList API (free, no API key required)
// ============================================================

const ANILIST_API = "https://graphql.anilist.co";

interface AniListMedia {
  id: number;
  title: {
    romaji: string;
    english: string | null;
    native: string | null;
  };
  description: string | null;
  genres: string[];
  startDate: { year: number | null };
  staff: {
    edges: {
      role: string;
      node: { name: { full: string } };
    }[];
  };
  coverImage: { large: string };
  volumes: number | null;
}

export async function searchAniList(query: string, lang?: string): Promise<ComicMetadata[]> {
  const graphqlQuery = `
    query ($search: String) {
      Page(page: 1, perPage: 10) {
        media(search: $search, type: MANGA, sort: SEARCH_MATCH) {
          id
          title {
            romaji
            english
            native
          }
          description(asHtml: false)
          genres
          startDate {
            year
          }
          staff(sort: RELEVANCE, perPage: 5) {
            edges {
              role
              node {
                name {
                  full
                }
              }
            }
          }
          coverImage {
            large
          }
          volumes
        }
      }
    }
  `;

  try {
    const response = await fetch(ANILIST_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: graphqlQuery,
        variables: { search: query },
      }),
    });

    if (!response.ok) {
      throw new Error(`AniList API error: ${response.status}`);
    }

    const data = await response.json();
    const results: AniListMedia[] = data?.data?.Page?.media || [];

    return results.map((media) => {
      const authors = media.staff?.edges
        ?.filter((e) => e.role.toLowerCase().includes("story") || e.role.toLowerCase().includes("art"))
        .map((e) => e.node.name.full) || [];

      // Clean description (remove HTML tags)
      const cleanDesc = media.description
        ?.replace(/<[^>]+>/g, "")
        .replace(/\n+/g, "\n")
        .trim() || "";

      const isZh = lang?.startsWith("zh");
      const title = isZh
        ? media.title.native || media.title.romaji || media.title.english
        : media.title.english || media.title.romaji || media.title.native;

      return {
        title: title || undefined,
        author: authors.join(", ") || undefined,
        year: media.startDate?.year || undefined,
        description: cleanDesc || undefined,
        genre: media.genres?.join(", ") ? translateGenre(media.genres.join(", "), lang) : undefined,
        seriesName: media.title.romaji || undefined,
        coverUrl: media.coverImage?.large || undefined,
        source: "anilist",
      };
    });
  } catch (err) {
    console.error("AniList search failed:", err);
    return [];
  }
}

// ============================================================
// Bangumi (番组计划 / bgm.tv) — Free, no API key required
// ============================================================

const BANGUMI_API = "https://api.bgm.tv";

interface BangumiSubject {
  id: number;
  name: string;
  name_cn: string;
  summary: string;
  date: string;
  images?: { large?: string; medium?: string };
  tags?: { name: string; count: number }[];
  infobox?: { key: string; value: string | { v: string }[] }[];
  volumes?: number;
  rating?: { score: number };
}

export async function searchBangumi(query: string, lang?: string): Promise<ComicMetadata[]> {
  try {
    const url = new URL(`${BANGUMI_API}/search/subject/${encodeURIComponent(query)}`);
    url.searchParams.set("type", "1"); // 1 = Book (manga/novel)
    url.searchParams.set("responseGroup", "large");
    url.searchParams.set("max_results", "10");

    const response = await fetch(url.toString(), {
      headers: {
        "User-Agent": "NowenReader/1.0",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`Bangumi API error: ${response.status}`);
    }

    const data = await response.json();
    const results: BangumiSubject[] = data?.list || [];

    return results.map((subject) => {
      // Extract author from infobox
      let author: string | undefined;
      if (subject.infobox) {
        const authorEntry = subject.infobox.find(
          (item) => item.key === "作者" || item.key === "著者" || item.key === "作画"
        );
        if (authorEntry) {
          author =
            typeof authorEntry.value === "string"
              ? authorEntry.value
              : Array.isArray(authorEntry.value)
              ? authorEntry.value.map((v) => v.v).join(", ")
              : undefined;
        }
      }

      // Extract publisher from infobox
      let publisher: string | undefined;
      if (subject.infobox) {
        const pubEntry = subject.infobox.find(
          (item) => item.key === "出版社" || item.key === "连载杂志"
        );
        if (pubEntry && typeof pubEntry.value === "string") {
          publisher = pubEntry.value;
        }
      }

      // Extract year from date
      const year = subject.date ? parseInt(subject.date.split("-")[0]) : undefined;

      // Genre from tags
      const genre = subject.tags
        ?.sort((a, b) => b.count - a.count)
        .slice(0, 8)
        .map((t) => t.name)
        .join(", ") || undefined;

      const isZh = lang?.startsWith("zh");
      const title = isZh
        ? subject.name_cn || subject.name
        : subject.name || subject.name_cn;

      return {
        title: title || undefined,
        author,
        publisher,
        year: year && !isNaN(year) ? year : undefined,
        description: subject.summary || undefined,
        genre,
        seriesName: subject.name || undefined,
        coverUrl: subject.images?.large || subject.images?.medium || undefined,
        source: "bangumi",
      };
    });
  } catch (err) {
    console.error("Bangumi search failed:", err);
    return [];
  }
}

// ============================================================
// MyAnimeList (MAL) — Requires API key (Client ID)
// ============================================================

const MAL_API = "https://api.myanimelist.net/v2";

interface MALMangaNode {
  id: number;
  title: string;
  main_picture?: { medium?: string; large?: string };
  alternative_titles?: { synonyms?: string[]; en?: string; ja?: string };
  start_date?: string;
  synopsis?: string;
  genres?: { id: number; name: string }[];
  authors?: { node: { first_name: string; last_name: string }; role: string }[];
  serialization?: { node: { name: string } }[];
  num_volumes?: number;
  status?: string;
}

export async function searchMAL(
  query: string,
  clientId?: string,
  lang?: string
): Promise<ComicMetadata[]> {
  const key = clientId || process.env.MAL_CLIENT_ID;
  if (!key) {
    console.warn("MAL Client ID not configured");
    return [];
  }

  try {
    const url = new URL(`${MAL_API}/manga`);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", "10");
    url.searchParams.set(
      "fields",
      "id,title,main_picture,alternative_titles,start_date,synopsis,genres,authors,serialization,num_volumes,status"
    );

    const response = await fetch(url.toString(), {
      headers: {
        "X-MAL-CLIENT-ID": key,
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`MAL API error: ${response.status}`);
    }

    const data = await response.json();
    const results: { node: MALMangaNode }[] = data?.data || [];

    return results.map(({ node: manga }) => {
      const authors = manga.authors
        ?.map((a) => `${a.node.first_name} ${a.node.last_name}`.trim())
        .filter(Boolean) || [];

      const year = manga.start_date
        ? parseInt(manga.start_date.split("-")[0])
        : undefined;

      const isZh = lang?.startsWith("zh");
      const title = isZh
        ? manga.alternative_titles?.ja || manga.title
        : manga.alternative_titles?.en || manga.title;

      return {
        title: title || undefined,
        author: authors.length > 0 ? authors.join(", ") : undefined,
        publisher: manga.serialization?.[0]?.node?.name || undefined,
        year: year && !isNaN(year) ? year : undefined,
        description: manga.synopsis || undefined,
        genre: manga.genres?.map((g) => g.name).join(", ") ? translateGenre(manga.genres!.map((g) => g.name).join(", "), lang) : undefined,
        seriesName: manga.title || undefined,
        coverUrl: manga.main_picture?.large || manga.main_picture?.medium || undefined,
        source: "mal",
      };
    });
  } catch (err) {
    console.error("MAL search failed:", err);
    return [];
  }
}

// ============================================================
// MangaUpdates (Baka-Updates) — Free API v1
// ============================================================

const MANGAUPDATES_API = "https://api.mangaupdates.com/v1";

interface MangaUpdatesRecord {
  series_id: number;
  title: string;
  description?: string;
  image?: { url?: { original?: string } };
  year?: string;
  genres?: { genre: string }[];
  authors?: { name: string; type: string }[];
  publishers?: { publisher_name: string; type: string }[];
  type?: string;
  bayesian_rating?: number;
  associated?: { title: string }[];
}

export async function searchMangaUpdates(
  query: string,
  lang?: string
): Promise<ComicMetadata[]> {
  try {
    // MangaUpdates v1 uses POST for search
    const response = await fetch(`${MANGAUPDATES_API}/series/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        search: query,
        per_page: 10,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`MangaUpdates API error: ${response.status}`);
    }

    const data = await response.json();
    const results: { record: MangaUpdatesRecord }[] = data?.results || [];

    return results.map(({ record }) => {
      const authors = record.authors
        ?.map((a) => a.name)
        .filter(Boolean) || [];

      const publisher = record.publishers
        ?.find((p) => p.type === "Original")?.publisher_name
        || record.publishers?.[0]?.publisher_name;

      const year = record.year ? parseInt(record.year) : undefined;

      // Clean HTML from description
      const cleanDesc = record.description
        ?.replace(/<[^>]+>/g, "")
        .replace(/\n+/g, "\n")
        .trim() || undefined;

      return {
        title: record.title || undefined,
        author: authors.length > 0 ? authors.join(", ") : undefined,
        publisher: publisher || undefined,
        year: year && !isNaN(year) ? year : undefined,
        description: cleanDesc,
        genre: record.genres?.map((g) => g.genre).join(", ") ? translateGenre(record.genres!.map((g) => g.genre).join(", "), lang) : undefined,
        seriesName: record.title || undefined,
        coverUrl: record.image?.url?.original || undefined,
        source: "mangaupdates",
      };
    });
  } catch (err) {
    console.error("MangaUpdates search failed:", err);
    return [];
  }
}

// ============================================================
// Kitsu — Free, no API key required
// ============================================================

const KITSU_API = "https://kitsu.io/api/edge";

interface KitsuManga {
  id: string;
  attributes: {
    canonicalTitle: string;
    titles: Record<string, string>;
    synopsis?: string;
    startDate?: string;
    posterImage?: { original?: string; large?: string; medium?: string };
    serialization?: string;
    volumeCount?: number;
    chapterCount?: number;
    subtype?: string;
    status?: string;
    averageRating?: string;
  };
}

export async function searchKitsu(query: string, lang?: string): Promise<ComicMetadata[]> {
  try {
    const url = new URL(`${KITSU_API}/manga`);
    url.searchParams.set("filter[text]", query);
    url.searchParams.set("page[limit]", "10");
    url.searchParams.set("include", "categories");

    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/vnd.api+json",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`Kitsu API error: ${response.status}`);
    }

    const data = await response.json();
    const results: KitsuManga[] = data?.data || [];

    // Extract category names from included data
    const categories: Record<string, string> = {};
    if (Array.isArray(data?.included)) {
      for (const inc of data.included) {
        if (inc.type === "categories" && inc.attributes?.title) {
          categories[inc.id] = inc.attributes.title;
        }
      }
    }

    return results.map((manga) => {
      const attrs = manga.attributes;
      const year = attrs.startDate
        ? parseInt(attrs.startDate.split("-")[0])
        : undefined;

      const isZh = lang?.startsWith("zh");
      const title = isZh
        ? attrs.titles?.ja_jp || attrs.titles?.en_jp || attrs.canonicalTitle
        : attrs.titles?.en || attrs.titles?.en_jp || attrs.canonicalTitle;

      return {
        title: title || undefined,
        year: year && !isNaN(year) ? year : undefined,
        description: attrs.synopsis || undefined,
        publisher: attrs.serialization || undefined,
        seriesName: attrs.canonicalTitle || undefined,
        coverUrl: attrs.posterImage?.large || attrs.posterImage?.original || attrs.posterImage?.medium || undefined,
        source: "kitsu",
      };
    });
  } catch (err) {
    console.error("Kitsu search failed:", err);
    return [];
  }
}

// ============================================================
// MangaDex — Free, no API key required
// ============================================================

const MANGADEX_API = "https://api.mangadex.org";

interface MangaDexManga {
  id: string;
  attributes: {
    title: Record<string, string>;
    altTitles: Record<string, string>[];
    description: Record<string, string>;
    year?: number;
    tags: { id: string; attributes: { name: Record<string, string>; group: string } }[];
    status?: string;
    originalLanguage?: string;
  };
  relationships: { type: string; id: string; attributes?: { name?: string; fileName?: string } }[];
}

export async function searchMangaDex(query: string, lang?: string): Promise<ComicMetadata[]> {
  try {
    const url = new URL(`${MANGADEX_API}/manga`);
    url.searchParams.set("title", query);
    url.searchParams.set("limit", "10");
    url.searchParams.set("includes[]", "author");
    url.searchParams.append("includes[]", "artist");
    url.searchParams.append("includes[]", "cover_art");
    url.searchParams.set("order[relevance]", "desc");

    const response = await fetch(url.toString(), {
      headers: {
        "User-Agent": "NowenReader/1.0",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`MangaDex API error: ${response.status}`);
    }

    const data = await response.json();
    const results: MangaDexManga[] = data?.data || [];

    return results.map((manga) => {
      const attrs = manga.attributes;

      const isZh = lang?.startsWith("zh");

      // Title: prefer user's language
      const title = isZh
        ? attrs.title?.["zh"] || attrs.title?.["zh-hk"] || attrs.title?.ja || attrs.title?.en || Object.values(attrs.title)?.[0]
        : attrs.title?.en || attrs.title?.ja || attrs.title?.["ja-ro"] || Object.values(attrs.title)?.[0];

      // Chinese/Japanese title from alt titles
      const zhTitle = isZh
        ? attrs.altTitles?.find((t) => t["zh"] || t["zh-hk"])?.["zh"]
          || attrs.altTitles?.find((t) => t["zh-hk"])?.["zh-hk"]
        : undefined;

      // Description: prefer user's language
      const description = isZh
        ? attrs.description?.["zh"] || attrs.description?.["zh-hk"] || attrs.description?.en || Object.values(attrs.description)?.[0]
        : attrs.description?.en || Object.values(attrs.description)?.[0];

      // Author and artist from relationships
      const authors = manga.relationships
        ?.filter((r) => r.type === "author" || r.type === "artist")
        .map((r) => r.attributes?.name)
        .filter((name): name is string => !!name);
      const uniqueAuthors = [...new Set(authors)];

      // Cover URL from cover_art relationship
      const coverRel = manga.relationships?.find((r) => r.type === "cover_art");
      const coverUrl = coverRel?.attributes?.fileName
        ? `https://uploads.mangadex.org/covers/${manga.id}/${coverRel.attributes.fileName}.256.jpg`
        : undefined;

      // Tags → genre
      const genreTags = attrs.tags
        ?.filter((t) => t.attributes.group === "genre" || t.attributes.group === "theme")
        .map((t) => {
          if (isZh) {
            return t.attributes.name?.["zh"] || t.attributes.name?.en || Object.values(t.attributes.name)?.[0];
          }
          return t.attributes.name?.en || Object.values(t.attributes.name)?.[0];
        })
        .filter(Boolean);

      return {
        title: zhTitle || title || undefined,
        author: uniqueAuthors.length > 0 ? uniqueAuthors.join(", ") : undefined,
        year: attrs.year || undefined,
        description: description || undefined,
        genre: genreTags?.join(", ") ? translateGenre(genreTags!.join(", "), lang) : undefined,
        language: attrs.originalLanguage || undefined,
        seriesName: title || undefined,
        coverUrl,
        source: "mangadex",
      };
    });
  } catch (err) {
    console.error("MangaDex search failed:", err);
    return [];
  }
}

// ============================================================
// ComicVine API (requires API key)
// ============================================================

const COMICVINE_API = "https://comicvine.gamespot.com/api";

interface ComicVineResult {
  id: number;
  name: string;
  description: string | null;
  start_year: string | null;
  publisher: { name: string } | null;
  image: { medium_url: string } | null;
  count_of_issues: number | null;
  people: { name: string; role: string }[] | null;
}

export async function searchComicVine(
  query: string,
  apiKey?: string,
  lang?: string
): Promise<ComicMetadata[]> {
  const key = apiKey || process.env.COMICVINE_API_KEY;
  if (!key) {
    console.warn("ComicVine API key not configured");
    return [];
  }

  try {
    const url = new URL(`${COMICVINE_API}/search/`);
    url.searchParams.set("api_key", key);
    url.searchParams.set("format", "json");
    url.searchParams.set("resources", "volume");
    url.searchParams.set("query", query);
    url.searchParams.set("limit", "10");
    url.searchParams.set(
      "field_list",
      "id,name,description,start_year,publisher,image,count_of_issues,people"
    );

    const response = await fetch(url.toString(), {
      headers: {
        "User-Agent": "NowenReader/1.0",
      },
    });

    if (!response.ok) {
      throw new Error(`ComicVine API error: ${response.status}`);
    }

    const data = await response.json();
    const results: ComicVineResult[] = data?.results || [];

    return results.map((volume) => {
      const cleanDesc = volume.description
        ?.replace(/<[^>]+>/g, "")
        .replace(/\n+/g, "\n")
        .trim() || "";

      const authors =
        volume.people
          ?.filter((p) => p.role?.toLowerCase().includes("writer") || p.role?.toLowerCase().includes("artist"))
          .map((p) => p.name) || [];

      return {
        title: volume.name || undefined,
        author: authors.join(", ") || undefined,
        publisher: volume.publisher?.name || undefined,
        year: volume.start_year ? parseInt(volume.start_year) : undefined,
        description: cleanDesc || undefined,
        coverUrl: volume.image?.medium_url || undefined,
        seriesName: volume.name || undefined,
        source: "comicvine",
      };
    });
  } catch (err) {
    console.error("ComicVine search failed:", err);
    return [];
  }
}

// ============================================================
// Unified search
// ============================================================

export async function searchMetadata(
  query: string,
  sources?: string[],
  lang?: string
): Promise<ComicMetadata[]> {
  const enabledSources = sources || [
    "anilist", "bangumi", "mangadex", "mangaupdates", "kitsu", "mal", "comicvine",
  ];
  const results: ComicMetadata[] = [];

  const promises: Promise<ComicMetadata[]>[] = [];

  if (enabledSources.includes("anilist")) {
    promises.push(searchAniList(query, lang));
  }
  if (enabledSources.includes("bangumi")) {
    promises.push(searchBangumi(query, lang));
  }
  if (enabledSources.includes("mangadex")) {
    promises.push(searchMangaDex(query, lang));
  }
  if (enabledSources.includes("mangaupdates")) {
    promises.push(searchMangaUpdates(query, lang));
  }
  if (enabledSources.includes("kitsu")) {
    promises.push(searchKitsu(query, lang));
  }
  if (enabledSources.includes("mal")) {
    promises.push(searchMAL(query, undefined, lang));
  }
  if (enabledSources.includes("comicvine")) {
    promises.push(searchComicVine(query, undefined, lang));
  }

  const allResults = await Promise.allSettled(promises);

  for (const result of allResults) {
    if (result.status === "fulfilled") {
      results.push(...result.value);
    }
  }

  // AI translation: translate non-target-language results
  if (lang && results.length > 0) {
    try {
      const translated = await translateMetadataResults(results, lang);
      return translated;
    } catch (err) {
      console.warn("AI metadata translation skipped:", err);
    }
  }

  return results;
}

/**
 * Detect if a text string is primarily in the target language.
 */
function isTargetLanguage(text: string | undefined, lang: string): boolean {
  if (!text || text.trim().length === 0) return true;

  if (lang.startsWith("zh")) {
    // Check if text contains significant Chinese characters
    const cjkChars = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g);
    const ratio = (cjkChars?.length || 0) / text.replace(/\s+/g, "").length;
    return ratio > 0.3;
  }

  if (lang.startsWith("en")) {
    // Check if text is primarily ASCII/Latin
    const latinChars = text.match(/[a-zA-Z]/g);
    const ratio = (latinChars?.length || 0) / text.replace(/\s+/g, "").length;
    return ratio > 0.5;
  }

  if (lang.startsWith("ja")) {
    const jpChars = text.match(/[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff]/g);
    const ratio = (jpChars?.length || 0) / text.replace(/\s+/g, "").length;
    return ratio > 0.3;
  }

  if (lang.startsWith("ko")) {
    const koChars = text.match(/[\uac00-\ud7af\u1100-\u11ff]/g);
    const ratio = (koChars?.length || 0) / text.replace(/\s+/g, "").length;
    return ratio > 0.3;
  }

  return true;
}

/**
 * Check if a metadata result needs translation to the target language.
 */
function needsTranslation(metadata: ComicMetadata, lang: string): boolean {
  // Check title and description — if either is not in the target language, translate
  if (metadata.title && !isTargetLanguage(metadata.title, lang)) return true;
  if (metadata.description && !isTargetLanguage(metadata.description, lang)) return true;
  if (metadata.genre && !isTargetLanguage(metadata.genre, lang)) return true;
  return false;
}

/**
 * Translate metadata search results to the target language using AI.
 * Batches results to minimize API calls.
 */
async function translateMetadataResults(
  results: ComicMetadata[],
  lang: string
): Promise<ComicMetadata[]> {
  let translateFn: typeof import("./ai-service").translateMetadataFields;
  let loadConfigFn: typeof import("./ai-service").loadAIConfig;

  try {
    const aiService = await import("./ai-service");
    translateFn = aiService.translateMetadataFields;
    loadConfigFn = aiService.loadAIConfig;
  } catch {
    return results;
  }

  const config = loadConfigFn();
  if (!config.enableCloudAI || !config.cloudApiKey) {
    return results;
  }

  // Find which results need translation
  const toTranslateIndices: number[] = [];
  for (let i = 0; i < results.length; i++) {
    if (needsTranslation(results[i], lang)) {
      toTranslateIndices.push(i);
    }
  }

  if (toTranslateIndices.length === 0) return results;

  // Batch translate: up to 5 concurrent AI calls to avoid overloading
  const BATCH_SIZE = 5;
  const translated = [...results];

  for (let batch = 0; batch < toTranslateIndices.length; batch += BATCH_SIZE) {
    const batchIndices = toTranslateIndices.slice(batch, batch + BATCH_SIZE);

    const batchPromises = batchIndices.map(async (idx) => {
      const meta = results[idx];
      try {
        const result = await translateFn(
          {
            title: meta.title,
            author: meta.author,
            description: meta.description,
            genre: meta.genre,
            seriesName: meta.seriesName,
            publisher: meta.publisher,
          },
          lang
        );
        if (result) {
          translated[idx] = {
            ...meta,
            title: result.title || meta.title,
            description: result.description || meta.description,
            genre: result.genre || meta.genre,
            seriesName: result.seriesName || meta.seriesName,
          };
        }
      } catch (err) {
        console.warn(`Translation failed for result ${idx}:`, err);
      }
    });

    await Promise.allSettled(batchPromises);
  }

  return translated;
}

/**
 * Translate a single metadata object to the target language using AI.
 * Exported for use by scan route for ComicInfo.xml metadata.
 */
export async function translateMetadataForDisplay(
  metadata: ComicMetadata,
  lang: string
): Promise<ComicMetadata> {
  if (!needsTranslation(metadata, lang)) return metadata;

  try {
    const { translateMetadataFields, loadAIConfig } = await import("./ai-service");
    const config = loadAIConfig();
    if (!config.enableCloudAI || !config.cloudApiKey) return metadata;

    const result = await translateMetadataFields(
      {
        title: metadata.title,
        author: metadata.author,
        description: metadata.description,
        genre: metadata.genre,
        seriesName: metadata.seriesName,
        publisher: metadata.publisher,
      },
      lang
    );

    if (result) {
      return {
        ...metadata,
        title: result.title || metadata.title,
        description: result.description || metadata.description,
        genre: result.genre || metadata.genre,
        seriesName: result.seriesName || metadata.seriesName,
      };
    }
  } catch (err) {
    console.warn("Single metadata translation failed:", err);
  }

  return metadata;
}

// ============================================================
// Apply metadata to comic
// ============================================================

export async function applyMetadata(
  comicId: string,
  metadata: ComicMetadata,
  lang?: string,
  overwrite: boolean = false
) {
  // Try to translate metadata fields if cloud AI is available and lang is specified
  if (lang && needsTranslation(metadata, lang)) {
    try {
      const { translateMetadataFields } = await import("./ai-service");
      const translated = await translateMetadataFields(
        {
          title: metadata.title,
          author: metadata.author,
          description: metadata.description,
          genre: metadata.genre,
          seriesName: metadata.seriesName,
          publisher: metadata.publisher,
        },
        lang
      );
      if (translated) {
        if (translated.title) metadata.title = translated.title;
        if (translated.description) metadata.description = translated.description;
        if (translated.genre) metadata.genre = translated.genre;
        if (translated.seriesName) metadata.seriesName = translated.seriesName;
      }
    } catch (err) {
      console.warn("Metadata translation skipped:", err);
    }
  }

  // Fetch existing comic data to avoid overwriting non-empty fields
  const existing = await prisma.comic.findUnique({ where: { id: comicId } });

  const updateData: Record<string, unknown> = {};

  // Helper: only update field if overwrite is true or existing field is empty
  const shouldUpdate = (existingValue: unknown) =>
    overwrite || !existingValue;

  if (metadata.title && shouldUpdate(existing?.title)) updateData.title = metadata.title;
  if (metadata.author && shouldUpdate(existing?.author)) updateData.author = metadata.author;
  if (metadata.publisher && shouldUpdate(existing?.publisher)) updateData.publisher = metadata.publisher;
  if (metadata.year && shouldUpdate(existing?.year)) updateData.year = metadata.year;
  if (metadata.description && shouldUpdate(existing?.description)) updateData.description = metadata.description;
  if (metadata.language && shouldUpdate(existing?.language)) updateData.language = metadata.language;
  if (metadata.genre && shouldUpdate(existing?.genre)) updateData.genre = metadata.genre;
  if (metadata.seriesName && shouldUpdate(existing?.seriesName)) {
    updateData.seriesName = metadata.seriesName;
    if (shouldUpdate(existing?.groupName)) {
      updateData.groupName = metadata.seriesName;
    }
  }
  if (metadata.seriesIndex !== undefined && shouldUpdate(existing?.seriesIndex)) updateData.seriesIndex = metadata.seriesIndex;
  if (metadata.source) updateData.metadataSource = metadata.source;
  if (metadata.coverUrl && shouldUpdate(existing?.coverImageUrl)) updateData.coverImageUrl = metadata.coverUrl;

  const comic = await prisma.comic.update({
    where: { id: comicId },
    data: updateData,
  });

  // Download cover image and cache as thumbnail
  if (metadata.coverUrl) {
    try {
      const { THUMBNAILS_DIR, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT } = await import("./config");
      const fs = await import("fs");
      const path = await import("path");
      const sharp = (await import("sharp")).default;

      if (!fs.existsSync(THUMBNAILS_DIR)) {
        fs.mkdirSync(THUMBNAILS_DIR, { recursive: true });
      }

      const cachePath = path.join(THUMBNAILS_DIR, `${comicId}.webp`);
      const coverRes = await fetch(metadata.coverUrl, {
        signal: AbortSignal.timeout(30000),
        headers: { "User-Agent": "NowenReader/1.0" },
      });

      if (coverRes.ok) {
        const arrayBuf = await coverRes.arrayBuffer();
        const imgBuffer = Buffer.from(arrayBuf);
        const thumbnail = await sharp(imgBuffer)
          .resize(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, {
            fit: "cover",
            position: "top",
          })
          .webp({ quality: 80 })
          .toBuffer();
        fs.writeFileSync(cachePath, thumbnail);
        console.log(`Cover image cached for comic ${comicId}`);
      }
    } catch (coverErr) {
      console.warn("Failed to download cover image:", coverErr);
    }
  }

  // If genres provided, also add as tags
  if (metadata.genre) {
    const genres = metadata.genre.split(",").map((g) => g.trim()).filter(Boolean);
    for (const genre of genres) {
      const tag = await prisma.tag.upsert({
        where: { name: genre },
        create: { name: genre },
        update: {},
      });
      await prisma.comicTag.upsert({
        where: { comicId_tagId: { comicId, tagId: tag.id } },
        create: { comicId, tagId: tag.id },
        update: {},
      });
    }
  }

  // AI auto-classification and tagging
  try {
    const { loadAIConfig, analyzeCoverWithLLM, completeMissingMetadata } = await import("./ai-service");
    const aiConfig = loadAIConfig();

    if (aiConfig.enableAutoTag && aiConfig.enableCloudAI && aiConfig.cloudApiKey) {
      const aiUpdateData: Record<string, unknown> = {};
      let aiTags: string[] = [];

      // 1. AI cover analysis — get tags and genre from cover image (uses cached thumbnail)
      {
        try {
          const { THUMBNAILS_DIR } = await import("./config");
          const fs = await import("fs");
          const pathMod = await import("path");
          const thumbPath = pathMod.join(THUMBNAILS_DIR, `${comicId}.webp`);

          if (fs.existsSync(thumbPath)) {
            const imgBuffer = fs.readFileSync(thumbPath);
            const coverAnalysis = await analyzeCoverWithLLM(
              imgBuffer,
              aiConfig,
              comic.title,
              lang
            );

            if (coverAnalysis) {
              // Merge AI genre with existing genre
              if (coverAnalysis.genre && !metadata.genre) {
                aiUpdateData.genre = coverAnalysis.genre;
              }
              // Collect AI-suggested tags
              if (coverAnalysis.tags?.length) {
                aiTags.push(...coverAnalysis.tags);
              }
              console.log(`AI cover analysis for ${comicId}: genre="${coverAnalysis.genre}", tags=[${coverAnalysis.tags?.join(", ")}]`);
            }
          }
        } catch (coverAiErr) {
          console.warn("AI cover analysis skipped:", coverAiErr);
        }
      }

      // 2. AI metadata completion — infer missing genre/tags from title/description
      try {
        const existingTags = await prisma.comicTag.findMany({
          where: { comicId },
          include: { tag: true },
        });
        const tagNames = existingTags.map((ct) => ct.tag.name);

        const completion = await completeMissingMetadata(aiConfig, {
          title: comic.title,
          author: metadata.author || comic.author || undefined,
          genre: metadata.genre || (aiUpdateData.genre as string) || comic.genre || undefined,
          description: metadata.description || comic.description || undefined,
          tags: [...tagNames, ...aiTags],
        }, lang);

        if (completion) {
          // Fill missing genre
          if (completion.genre && !metadata.genre && !aiUpdateData.genre) {
            aiUpdateData.genre = completion.genre;
          }
          // Collect suggested tags
          if (completion.suggestedTags?.length) {
            aiTags.push(...completion.suggestedTags);
          }
          console.log(`AI metadata completion for ${comicId}: genre="${completion.genre}", suggestedTags=[${completion.suggestedTags?.join(", ")}]`);
        }
      } catch (completionErr) {
        console.warn("AI metadata completion skipped:", completionErr);
      }

      // 3. Apply AI-derived genre to database
      if (aiUpdateData.genre) {
        await prisma.comic.update({
          where: { id: comicId },
          data: { genre: aiUpdateData.genre as string },
        });

        // Also add AI genre as tags
        const aiGenres = (aiUpdateData.genre as string).split(",").map((g) => g.trim()).filter(Boolean);
        for (const g of aiGenres) {
          const tag = await prisma.tag.upsert({
            where: { name: g },
            create: { name: g },
            update: {},
          });
          await prisma.comicTag.upsert({
            where: { comicId_tagId: { comicId, tagId: tag.id } },
            create: { comicId, tagId: tag.id },
            update: {},
          });
        }
      }

      // 4. Apply AI-suggested tags (deduplicated)
      const uniqueTags = [...new Set(aiTags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
      for (const tagName of uniqueTags) {
        const tag = await prisma.tag.upsert({
          where: { name: tagName },
          create: { name: tagName },
          update: {},
        });
        await prisma.comicTag.upsert({
          where: { comicId_tagId: { comicId, tagId: tag.id } },
          create: { comicId, tagId: tag.id },
          update: {},
        });
      }

      if (uniqueTags.length > 0 || aiUpdateData.genre) {
        console.log(`AI auto-classification applied for ${comicId}: ${uniqueTags.length} tags, genre="${aiUpdateData.genre || "(unchanged)"}`);
      }

      // 5. Auto-assign categories based on genre and tags
      try {
        const { addCategoriesToComic, PREDEFINED_CATEGORIES, initCategories } = await import("./comic-service");
        // Ensure categories are initialized
        await initCategories(lang || "zh");

        // Build a genre/tag → category slug mapping
        const genreToSlug: Record<string, string> = {};
        for (const cat of PREDEFINED_CATEGORIES) {
          // Map both zh and en names to slug
          genreToSlug[cat.names.zh.toLowerCase()] = cat.slug;
          genreToSlug[cat.names.en.toLowerCase()] = cat.slug;
          genreToSlug[cat.slug] = cat.slug;
        }

        // Collect all genres and tags for matching
        const allGenresAndTags = new Set<string>();
        const genreStr = metadata.genre || (aiUpdateData.genre as string) || comic.genre || "";
        genreStr.split(",").forEach((g) => allGenresAndTags.add(g.trim().toLowerCase()));
        uniqueTags.forEach((t) => allGenresAndTags.add(t.toLowerCase()));

        // Find matching category slugs
        const matchedSlugs = new Set<string>();
        for (const term of allGenresAndTags) {
          if (genreToSlug[term]) {
            matchedSlugs.add(genreToSlug[term]);
          }
        }

        if (matchedSlugs.size > 0) {
          await addCategoriesToComic(comicId, Array.from(matchedSlugs));
          console.log(`AI auto-categorized ${comicId}: [${Array.from(matchedSlugs).join(", ")}]`);
        }
      } catch (catErr) {
        console.warn("Auto-categorization skipped:", catErr);
      }
    }
  } catch (aiErr) {
    console.warn("AI auto-classification skipped:", aiErr);
  }

  return comic;
}

/**
 * Read ComicInfo.xml from archive (common metadata format)
 */
export function parseComicInfoXml(xmlContent: string): ComicMetadata {
  const metadata: ComicMetadata = { source: "comicinfo" };

  const getValue = (tag: string): string | undefined => {
    const match = xmlContent.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, "i"));
    return match?.[1]?.trim() || undefined;
  };

  metadata.title = getValue("Title");
  metadata.author = getValue("Writer") || getValue("Author");
  metadata.publisher = getValue("Publisher");
  metadata.description = getValue("Summary");
  metadata.language = getValue("LanguageISO");
  metadata.genre = getValue("Genre");
  metadata.seriesName = getValue("Series");

  const year = getValue("Year");
  if (year) metadata.year = parseInt(year);

  const number = getValue("Number");
  if (number) metadata.seriesIndex = parseInt(number);

  return metadata;
}

/**
 * Try to extract ComicInfo.xml from an archive
 */
export async function extractComicInfoFromArchive(
  filepath: string
): Promise<ComicMetadata | null> {
  try {
    const { createArchiveReader } = await import("./archive-parser");
    const reader = await createArchiveReader(filepath);
    if (!reader) return null;

    try {
      const entries = reader.listEntries();
      const infoEntry = entries.find(
        (e) => e.name.toLowerCase() === "comicinfo.xml" || e.name.toLowerCase().endsWith("/comicinfo.xml")
      );

      if (!infoEntry) return null;

      const buffer = reader.extractEntry(infoEntry.name);
      if (!buffer) return null;

      const xmlContent = buffer.toString("utf-8");
      return parseComicInfoXml(xmlContent);
    } finally {
      reader.close();
    }
  } catch (err) {
    console.error("Failed to extract ComicInfo.xml:", err);
    return null;
  }
}
