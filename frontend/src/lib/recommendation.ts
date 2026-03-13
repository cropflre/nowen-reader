import { prisma } from "./db";
import { THUMBNAILS_DIR } from "./config";
import path from "path";
import { promises as fsPromises } from "fs";

/** 获取带缓存破坏参数的封面 URL（异步） */
async function getCoverUrl(comicId: string): Promise<string> {
  const base = `/api/comics/${comicId}/thumbnail`;
  try {
    const cachePath = path.join(THUMBNAILS_DIR, `${comicId}.webp`);
    const stat = await fsPromises.stat(cachePath);
    return `${base}?v=${stat.mtimeMs.toString(36)}`;
  } catch {
    return base;
  }
}

/**
 * Smart Recommendation Engine
 * Uses collaborative filtering based on reading history, tags, ratings, and genres.
 */

interface ScoredComic {
  id: string;
  title: string;
  score: number;
  reasons: string[];
  coverUrl: string;
  author: string;
  genre: string;
  tags: { name: string; color: string }[];
}

/**
 * Get personalized recommendations for a user
 */
export async function getRecommendations(options?: {
  limit?: number;
  excludeRead?: boolean;
}): Promise<ScoredComic[]> {
  const { limit = 10, excludeRead = false } = options || {};

  // Get all comics with their data
  const allComics = await prisma.comic.findMany({
    include: {
      tags: { include: { tag: true } },
      readingSessions: {
        select: { duration: true },
      },
    },
  });

  if (allComics.length === 0) return [];

  // Build user preference profile from reading behavior
  const profile = buildUserProfile(allComics);

  // Score each comic
  const scored: ScoredComic[] = [];

  for (const comic of allComics) {
    // Optionally exclude fully-read comics
    if (excludeRead && comic.lastReadPage > 0 && comic.pageCount > 0) {
      const progress = comic.lastReadPage / comic.pageCount;
      if (progress >= 0.9) continue;
    }

    const { score, reasons } = calculateScore(comic, profile);

    scored.push({
      id: comic.id,
      title: comic.title,
      score,
      reasons,
      coverUrl: await getCoverUrl(comic.id),
      author: comic.author,
      genre: comic.genre,
      tags: comic.tags.map((ct) => ({ name: ct.tag.name, color: ct.tag.color })),
    });
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, limit);
}

interface UserProfile {
  // Tag preferences (tag -> weight)
  tagWeights: Map<string, number>;
  // Genre preferences (genre -> weight)
  genreWeights: Map<string, number>;
  // Author preferences (author -> weight)
  authorWeights: Map<string, number>;
  // Average rating given
  avgRating: number;
  // Series user is reading
  activeSeries: Set<string>;
  // Total reading time for normalization
  totalReadTime: number;
  // AI: Aggregated text vector from top-engaged comics
  topComicVector?: Map<string, number>;
}

function buildUserProfile(
  comics: (typeof prisma.comic extends { findMany: (...args: unknown[]) => Promise<infer T> } ? (T extends (infer U)[] ? U : never) : never) extends infer C
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      any[]
    : never
): UserProfile {
  const tagWeights = new Map<string, number>();
  const genreWeights = new Map<string, number>();
  const authorWeights = new Map<string, number>();
  const activeSeries = new Set<string>();
  let totalRating = 0;
  let ratedCount = 0;
  let totalReadTime = 0;

  for (const comic of comics) {
    // Weight based on engagement (read time, rating, favorite)
    const engagement = calculateEngagement(comic);
    if (engagement <= 0) continue;

    // Tag weights
    if (comic.tags) {
      for (const ct of comic.tags) {
        const tagName = ct.tag?.name || ct.tag;
        const current = tagWeights.get(tagName) || 0;
        tagWeights.set(tagName, current + engagement);
      }
    }

    // Genre weights
    if (comic.genre) {
      const genres = comic.genre.split(",").map((g: string) => g.trim()).filter(Boolean);
      for (const genre of genres) {
        const current = genreWeights.get(genre) || 0;
        genreWeights.set(genre, current + engagement);
      }
    }

    // Author weights
    if (comic.author) {
      const current = authorWeights.get(comic.author) || 0;
      authorWeights.set(comic.author, current + engagement);
    }

    // Rating stats
    if (comic.rating) {
      totalRating += comic.rating;
      ratedCount++;
    }

    // Active series
    if (comic.seriesName && comic.lastReadPage > 0) {
      activeSeries.add(comic.seriesName);
    }

    totalReadTime += comic.totalReadTime || 0;
  }

  // Build aggregated semantic vector from top-engaged comics
  let topComicVector: Map<string, number> | undefined;
  try {
    const { buildTextVector } = require("./ai-service");
    const engagedComics = comics
      .map((c: { totalReadTime: number; isFavorite: boolean; rating: number | null; tags?: { tag?: { name: string } }[]; genre?: string; author?: string; description?: string; title?: string }) => ({
        comic: c,
        engagement: calculateEngagement(c),
      }))
      .filter((x: { engagement: number }) => x.engagement > 2)
      .sort((a: { engagement: number }, b: { engagement: number }) => b.engagement - a.engagement)
      .slice(0, 10);

    if (engagedComics.length > 0) {
      topComicVector = new Map<string, number>();
      for (const { comic: c, engagement } of engagedComics) {
        const tags = c.tags
          ? c.tags.map((ct: { tag?: { name: string } }) => ct.tag?.name || "")
          : [];
        const v = buildTextVector(
          c.title || "",
          tags,
          c.genre || "",
          c.author || "",
          c.description || ""
        );
        for (const [key, val] of v) {
          topComicVector.set(key, (topComicVector.get(key) || 0) + val * engagement);
        }
      }
    }
  } catch {
    // AI service not available
  }

  return {
    tagWeights,
    genreWeights,
    authorWeights,
    avgRating: ratedCount > 0 ? totalRating / ratedCount : 3,
    activeSeries,
    totalReadTime,
    topComicVector,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function calculateEngagement(comic: any): number {
  let score = 0;

  // Reading time contributes to engagement
  const readTime = comic.totalReadTime || 0;
  if (readTime > 0) score += Math.min(readTime / 600, 5); // Cap at 5 for 10 min

  // Reading progress
  if (comic.pageCount > 0 && comic.lastReadPage > 0) {
    const progress = comic.lastReadPage / comic.pageCount;
    score += progress * 3; // 0-3 points for progress
  }

  // Rating boost
  if (comic.rating) {
    score += (comic.rating - 2.5) * 2; // -5 to +5 based on rating
  }

  // Favorite boost
  if (comic.isFavorite) {
    score += 3;
  }

  // Recency boost
  if (comic.lastReadAt) {
    const daysSince = (Date.now() - new Date(comic.lastReadAt).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince < 7) score += 2;
    else if (daysSince < 30) score += 1;
  }

  return score;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function calculateScore(comic: any, profile: UserProfile): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  // 1. Tag match (max 30 points)
  let tagScore = 0;
  if (comic.tags) {
    for (const ct of comic.tags) {
      const tagName = ct.tag?.name || ct.tag;
      const weight = profile.tagWeights.get(tagName) || 0;
      tagScore += weight;
    }
  }
  if (tagScore > 0) {
    const normalizedTag = Math.min(tagScore / 10, 30);
    score += normalizedTag;
    if (normalizedTag > 5) reasons.push("tag_match");
  }

  // 2. Genre match (max 25 points)
  if (comic.genre) {
    let genreScore = 0;
    const genres = comic.genre.split(",").map((g: string) => g.trim());
    for (const genre of genres) {
      genreScore += profile.genreWeights.get(genre) || 0;
    }
    if (genreScore > 0) {
      const normalizedGenre = Math.min(genreScore / 10, 25);
      score += normalizedGenre;
      if (normalizedGenre > 5) reasons.push("genre_match");
    }
  }

  // 3. Author match (max 20 points)
  if (comic.author) {
    const authorWeight = profile.authorWeights.get(comic.author) || 0;
    if (authorWeight > 0) {
      const normalizedAuthor = Math.min(authorWeight / 5, 20);
      score += normalizedAuthor;
      reasons.push("same_author");
    }
  }

  // 4. Series continuation bonus (max 15 points)
  if (comic.seriesName && profile.activeSeries.has(comic.seriesName)) {
    // Unread entries in a series you're reading
    if (comic.pageCount > 0 && comic.lastReadPage === 0) {
      score += 15;
      reasons.push("series_continuation");
    } else if (comic.lastReadPage > 0 && comic.lastReadPage < comic.pageCount * 0.9) {
      score += 10;
      reasons.push("series_in_progress");
    }
  }

  // 5. Rating prediction bonus (max 10 points)
  if (comic.rating && comic.rating >= profile.avgRating) {
    score += (comic.rating - profile.avgRating) * 3;
    reasons.push("highly_rated");
  }

  // 6. Unread bonus (encourage discovery)
  if (comic.lastReadPage === 0 && comic.pageCount > 0) {
    score += 5;
    reasons.push("unread");
  }

  // 7. Recency penalty (recently read = lower priority for "next read")
  if (comic.lastReadAt) {
    const daysSince = (Date.now() - new Date(comic.lastReadAt).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince < 1) score -= 10;
    else if (daysSince < 3) score -= 5;
  }

  // 8. Semantic similarity bonus (max 15 points) — AI-powered
  // Uses text vector cosine similarity with profile's preferred content
  if (profile.topComicVector) {
    try {
      const { buildTextVector, cosineSimilarity } = require("./ai-service");
      const comicTags = comic.tags
        ? comic.tags.map((ct: { tag?: { name: string }; name?: string }) => ct.tag?.name || ct.name || ct)
        : [];
      const comicVector = buildTextVector(
        comic.title || "",
        comicTags,
        comic.genre || "",
        comic.author || "",
        comic.description || ""
      );
      const similarity = cosineSimilarity(profile.topComicVector, comicVector);
      if (similarity > 0.1) {
        score += similarity * 15;
        if (similarity > 0.3) reasons.push("semantic_match");
      }
    } catch {
      // AI service not available, skip
    }
  }

  return { score: Math.max(0, score), reasons };
}

/**
 * Get "similar comics" for a given comic
 */
export async function getSimilarComics(comicId: string, limit = 5): Promise<ScoredComic[]> {
  const target = await prisma.comic.findUnique({
    where: { id: comicId },
    include: { tags: { include: { tag: true } }, categories: { include: { category: true } } },
  });

  if (!target) return [];

  const allComics = await prisma.comic.findMany({
    where: { id: { not: comicId } },
    include: {
      tags: { include: { tag: true } },
      categories: { include: { category: true } },
    },
  });

  const targetTags = new Set(target.tags.map((ct) => ct.tag.name));
  const targetGenres = new Set(
    (target.genre || "").split(",").map((g) => g.trim()).filter(Boolean)
  );

  const scored: ScoredComic[] = [];

  for (const comic of allComics) {
    let score = 0;
    const reasons: string[] = [];

    // Tag overlap (Jaccard similarity)
    const comicTags = new Set(comic.tags.map((ct) => ct.tag.name));
    const intersection = [...targetTags].filter((t) => comicTags.has(t)).length;
    const union = new Set([...targetTags, ...comicTags]).size;
    if (union > 0) {
      const tagSimilarity = intersection / union;
      score += tagSimilarity * 40;
      if (tagSimilarity > 0.3) reasons.push("similar_tags");
    }

    // Genre overlap
    const comicGenres = new Set(
      (comic.genre || "").split(",").map((g) => g.trim()).filter(Boolean)
    );
    const genreIntersection = [...targetGenres].filter((g) => comicGenres.has(g)).length;
    const genreUnion = new Set([...targetGenres, ...comicGenres]).size;
    if (genreUnion > 0) {
      const genreSimilarity = genreIntersection / genreUnion;
      score += genreSimilarity * 30;
      if (genreSimilarity > 0.3) reasons.push("similar_genre");
    }

    // Same author
    if (comic.author && comic.author === target.author) {
      score += 20;
      reasons.push("same_author");
    }

    // Same series
    if (comic.seriesName && comic.seriesName === target.seriesName) {
      score += 25;
      reasons.push("same_series");
    }


    // Same category
    if (comic.categories?.length && target.categories?.length) {
      const targetCats = new Set(target.categories.map((c) => c.category.slug));
      const commonCats = comic.categories.filter((c) => targetCats.has(c.category.slug));
      if (commonCats.length > 0) {
        score += 8 * commonCats.length;
        reasons.push("same_category");
      }
    }

    if (score > 0) {
      scored.push({
        id: comic.id,
        title: comic.title,
        score,
        reasons,
        coverUrl: `/api/comics/${comic.id}/thumbnail`,
        author: comic.author,
        genre: comic.genre,
        tags: comic.tags.map((ct) => ({ name: ct.tag.name, color: ct.tag.color })),
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
