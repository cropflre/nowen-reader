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

export async function searchAniList(query: string): Promise<ComicMetadata[]> {
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

      return {
        title: media.title.english || media.title.romaji || media.title.native || undefined,
        author: authors.join(", ") || undefined,
        year: media.startDate?.year || undefined,
        description: cleanDesc || undefined,
        genre: media.genres?.join(", ") || undefined,
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
  apiKey?: string
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
  sources?: string[]
): Promise<ComicMetadata[]> {
  const enabledSources = sources || ["anilist", "comicvine"];
  const results: ComicMetadata[] = [];

  const promises: Promise<ComicMetadata[]>[] = [];

  if (enabledSources.includes("anilist")) {
    promises.push(searchAniList(query));
  }
  if (enabledSources.includes("comicvine")) {
    promises.push(searchComicVine(query));
  }

  const allResults = await Promise.allSettled(promises);

  for (const result of allResults) {
    if (result.status === "fulfilled") {
      results.push(...result.value);
    }
  }

  return results;
}

// ============================================================
// Apply metadata to comic
// ============================================================

export async function applyMetadata(
  comicId: string,
  metadata: ComicMetadata
) {
  const updateData: Record<string, unknown> = {};

  if (metadata.title) updateData.title = metadata.title;
  if (metadata.author) updateData.author = metadata.author;
  if (metadata.publisher) updateData.publisher = metadata.publisher;
  if (metadata.year) updateData.year = metadata.year;
  if (metadata.description) updateData.description = metadata.description;
  if (metadata.language) updateData.language = metadata.language;
  if (metadata.genre) updateData.genre = metadata.genre;
  if (metadata.seriesName) updateData.seriesName = metadata.seriesName;
  if (metadata.seriesIndex !== undefined) updateData.seriesIndex = metadata.seriesIndex;
  if (metadata.source) updateData.metadataSource = metadata.source;

  const comic = await prisma.comic.update({
    where: { id: comicId },
    data: updateData,
  });

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
