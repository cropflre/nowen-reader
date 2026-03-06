/**
 * E-Hentai Service
 * Handles searching, scraping gallery pages, and fetching image URLs from E-Hentai/ExHentai.
 */
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";

// ============================================================
// Types
// ============================================================

export interface EHGallery {
  gid: string;
  token: string;
  title: string;
  titleJpn: string;
  category: string;
  cover: string;
  uploader: string;
  tags: string[];
  fileCount: number;
  rating: number;
  url: string;
}

export interface EHGalleryDetail extends EHGallery {
  pageLinks: string[];    // individual page viewer URLs
  totalPageSets: number;  // number of paginated sets (for large galleries)
}

export interface EHSearchResult {
  galleries: EHGallery[];
  hasNext: boolean;
  total: number;
}

export interface EHApiMetadata {
  gid: number;
  token: string;
  title: string;
  title_jpn: string;
  category: string;
  uploader: string;
  tags: string[];
  filecount: string;
  rating: string;
  thumb: string;
  posted: string;
  filesize: number;
}

// ============================================================
// Config: read from file first, fallback to env vars
// ============================================================

const EHENTAI_CONFIG_PATH = path.join(process.cwd(), ".cache", "ehentai-config.json");

interface EHentaiFileConfig {
  memberId: string;
  passHash: string;
  igneous: string;
}

function loadFileConfig(): EHentaiFileConfig {
  try {
    if (fs.existsSync(EHENTAI_CONFIG_PATH)) {
      const raw = fs.readFileSync(EHENTAI_CONFIG_PATH, "utf-8");
      return JSON.parse(raw);
    }
  } catch {
    // ignore
  }
  return { memberId: "", passHash: "", igneous: "" };
}

function getCredentials(): { memberId: string; passHash: string; igneous: string } {
  const file = loadFileConfig();
  return {
    memberId: file.memberId || process.env.EHENTAI_MEMBER_ID || "",
    passHash: file.passHash || process.env.EHENTAI_PASS_HASH || "",
    igneous: file.igneous || process.env.EHENTAI_IGNEOUS || "",
  };
}

// ============================================================
// Service
// ============================================================

const DELAY_MS = 1500; // minimum delay between requests to avoid bans

function getBaseUrl(): string {
  const { igneous } = getCredentials();
  return igneous ? "https://exhentai.org" : "https://e-hentai.org";
}

const EH_API_URL = "https://api.e-hentai.org/api.php";

function buildCookieString(): string {
  const { memberId, passHash, igneous } = getCredentials();

  const cookies: string[] = [];
  if (memberId) cookies.push(`ipb_member_id=${memberId}`);
  if (passHash) cookies.push(`ipb_pass_hash=${passHash}`);
  if (igneous) cookies.push(`igneous=${igneous}`);
  return cookies.join("; ");
}

function getHeaders(): Record<string, string> {
  const cookie = buildCookieString();
  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Referer: getBaseUrl() + "/",
  };
  if (cookie) headers["Cookie"] = cookie;
  return headers;
}

export const delay = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Check if E-Hentai cookies are configured (from file or env)
 */
export function isConfigured(): boolean {
  const { memberId, passHash } = getCredentials();
  return !!(memberId && passHash);
}

// ============================================================
// Search
// ============================================================

export async function search(
  query: string,
  page: number = 0,
  category: number = 0
): Promise<EHSearchResult> {
  const base = getBaseUrl();
  const params = new URLSearchParams();
  params.set("f_search", query);
  if (page > 0) params.set("page", String(page));
  if (category > 0) params.set("f_cats", String(category));

  const url = `${base}/?${params.toString()}`;
  const res = await fetch(url, { headers: getHeaders() });
  const html = await res.text();
  const $ = cheerio.load(html);

  const galleries: EHGallery[] = [];

  // Thumbnail mode (.gl1t) — default E-Hentai layout
  $(".gl1t").each((_, el) => {
    const link = $(el).find("a").first().attr("href") || "";
    const title = $(el).find(".glink").text().trim();
    let cover = $(el).find("img").attr("src") || "";
    if (cover.startsWith("data:image")) {
      cover = $(el).find("img").attr("data-src") || cover;
    }

    const match = link.match(/\/g\/(\d+)\/([a-z0-9]+)\//);
    if (match) {
      galleries.push({
        gid: match[1],
        token: match[2],
        title,
        titleJpn: "",
        category: $(el).find(".cn").text().trim() || $(el).find(".cs").text().trim(),
        cover,
        uploader: "",
        tags: [],
        fileCount: 0,
        rating: 0,
        url: link,
      });
    }
  });

  // Extended/compact mode — table rows (.gtr0, .gtr1 or itg > tbody > tr)
  if (galleries.length === 0) {
    $("table.itg tbody tr").each((_, el) => {
      const linkEl = $(el).find(".glname a, .glink").closest("a");
      const link = linkEl.attr("href") || $(el).find("a").first().attr("href") || "";
      const title =
        $(el).find(".glink").text().trim() ||
        linkEl.text().trim();
      let cover = $(el).find("img").first().attr("src") || "";
      if (cover.startsWith("data:image")) {
        cover = $(el).find("img").first().attr("data-src") || cover;
      }
      const category = $(el).find(".cn, .cs").first().text().trim();

      const match = link.match(/\/g\/(\d+)\/([a-z0-9]+)\//);
      if (match && title) {
        galleries.push({
          gid: match[1],
          token: match[2],
          title,
          titleJpn: "",
          category,
          cover,
          uploader: "",
          tags: [],
          fileCount: 0,
          rating: 0,
          url: link,
        });
      }
    });
  }

  // Check for next page
  const hasNext = $(".ptt td:last-child a").length > 0;
  // Try to extract total from the search info bar
  const totalText = $(".ip").text(); // e.g., "Showing 1 - 25 of 12345"
  const totalMatch = totalText.match(/of\s+([\d,]+)/);
  const total = totalMatch ? parseInt(totalMatch[1].replace(/,/g, "")) : galleries.length;

  return { galleries, hasNext, total };
}

// ============================================================
// Gallery Detail (all page viewer links)
// ============================================================

export async function getGalleryDetail(
  gid: string,
  token: string
): Promise<EHGalleryDetail> {
  const base = getBaseUrl();
  const galleryUrl = `${base}/g/${gid}/${token}/`;

  // Fetch first page
  const res = await fetch(galleryUrl, { headers: getHeaders() });
  const html = await res.text();
  const $ = cheerio.load(html);

  // Title
  const title = $("#gn").text().trim() || $("h1#gn").text().trim();
  const titleJpn = $("#gj").text().trim() || $("h1#gj").text().trim();

  // Category
  const category = $("#gdc .cs, #gdc .cn").text().trim();

  // Cover
  const cover = $("#gd1 div").css("background")?.match(/url\((.*?)\)/)?.[1]?.replace(/['"]/g, "") || "";

  // Uploader
  const uploader = $("#gdn a").text().trim();

  // Tags
  const tags: string[] = [];
  $("#taglist tr").each((_, row) => {
    const ns = $(row).find("td.tc").first().text().replace(":", "").trim();
    $(row)
      .find("td:not(.tc) a, td:not(.tc) div a")
      .each((_, tag) => {
        const tagText = $(tag).text().trim();
        if (tagText) tags.push(ns ? `${ns}:${tagText}` : tagText);
      });
  });

  // File count
  const fileCountText = $(".gpc").text(); // "Showing 1 - 40 of 123 images"
  const fcMatch = fileCountText.match(/of\s+(\d+)/);
  const fileCount = fcMatch ? parseInt(fcMatch[1]) : 0;

  // Rating
  const ratingStyle = $("#rating_image").attr("style") || "";
  const ratingPxMatch = ratingStyle.match(
    /background-position:\s*(-?\d+)px\s+(-?\d+)px/
  );
  let rating = 0;
  if (ratingPxMatch) {
    const x = Math.abs(parseInt(ratingPxMatch[1]));
    const y = parseInt(ratingPxMatch[2]);
    rating = 5 - x / 16;
    if (y === -21) rating -= 0.5;
    rating = Math.max(0, Math.min(5, Math.round(rating * 10) / 10));
  }

  // Page links from all paginated sets
  const pageLinks: string[] = [];
  $("#gdt a").each((_, el) => {
    const href = $(el).attr("href");
    if (href) pageLinks.push(href);
  });

  // Detect pagination (for large galleries with multiple page sets)
  const paginationLinks: string[] = [];
  $(".ptt td a").each((_, el) => {
    const href = $(el).attr("href");
    if (href && !paginationLinks.includes(href)) {
      paginationLinks.push(href);
    }
  });
  const totalPageSets = Math.max(1, paginationLinks.length);

  // Fetch remaining page sets if gallery has multiple
  if (totalPageSets > 1) {
    for (let p = 1; p < totalPageSets; p++) {
      await delay(DELAY_MS);
      const pageUrl = `${galleryUrl}?p=${p}`;
      try {
        const pageRes = await fetch(pageUrl, { headers: getHeaders() });
        const pageHtml = await pageRes.text();
        const page$ = cheerio.load(pageHtml);
        page$("#gdt a").each((_, el) => {
          const href = page$(el).attr("href");
          if (href && !pageLinks.includes(href)) pageLinks.push(href);
        });
      } catch (err) {
        console.error(`[ehentai] Failed to fetch page set ${p}:`, err);
      }
    }
  }

  return {
    gid,
    token,
    title: title || `Gallery ${gid}`,
    titleJpn,
    category,
    cover,
    uploader,
    tags,
    fileCount,
    rating,
    url: galleryUrl,
    pageLinks,
    totalPageSets,
  };
}

// ============================================================
// Get Real Image URL from a Page Viewer URL
// ============================================================

export async function getRealImageUrl(
  pageUrl: string
): Promise<{ imageUrl: string; filename: string }> {
  const res = await fetch(pageUrl, { headers: getHeaders() });
  const html = await res.text();
  const $ = cheerio.load(html);

  // Primary: #img tag holds the actual image
  let imageUrl = $("#img").attr("src") || "";

  // Fallback: look for "original" source link (full-res)
  const nlLink = $("#i7 a").attr("href");
  if (nlLink) {
    imageUrl = nlLink; // "Click here if the image fails loading" often has a working direct URL
  }

  // Extract filename from URL or page
  const filenameMatch = imageUrl.match(/\/([^/?]+)$/);
  const filename = filenameMatch
    ? filenameMatch[1]
    : `page_${Date.now()}.jpg`;

  return { imageUrl, filename };
}

// ============================================================
// E-Hentai JSON API for Metadata
// ============================================================

export async function getGalleryMetadata(
  gidTokenPairs: [number, string][]
): Promise<EHApiMetadata[]> {
  const res = await fetch(EH_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getHeaders(),
    },
    body: JSON.stringify({
      method: "gdata",
      gidlist: gidTokenPairs,
      namespace: 1,
    }),
  });
  const data = await res.json();
  return data.gmetadata || [];
}

// ============================================================
// Proxy fetch (for image streaming through backend)
// ============================================================

export async function fetchImageStream(
  imageUrl: string
): Promise<{ body: ReadableStream | null; contentType: string; contentLength: string }> {
  const res = await fetch(imageUrl, { headers: getHeaders() });

  if (!res.ok) {
    throw new Error(`Failed to fetch image: ${res.status} ${res.statusText}`);
  }

  return {
    body: res.body,
    contentType: res.headers.get("Content-Type") || "image/jpeg",
    contentLength: res.headers.get("Content-Length") || "",
  };
}
