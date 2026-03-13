import path from "path";
import fs from "fs";

// 站点配置文件路径
const SITE_CONFIG_PATH = path.join(process.cwd(), ".cache", "site-config.json");

interface SiteConfigFile {
  siteName?: string;
  comicsDir?: string;
  extraComicsDirs?: string[];
  thumbnailWidth?: number;
  thumbnailHeight?: number;
  pageSize?: number;
  language?: string;
  theme?: string;
}

/** 从 site-config.json 读取用户自定义配置（带 5 秒内存缓存） */
let _siteConfigCache: SiteConfigFile | null = null;
let _siteConfigCacheTs = 0;
const SITE_CONFIG_CACHE_TTL = 5_000; // 5 seconds

function loadSiteConfig(): SiteConfigFile {
  const now = Date.now();
  if (_siteConfigCache && now - _siteConfigCacheTs < SITE_CONFIG_CACHE_TTL) {
    return _siteConfigCache;
  }
  try {
    if (fs.existsSync(SITE_CONFIG_PATH)) {
      _siteConfigCache = JSON.parse(fs.readFileSync(SITE_CONFIG_PATH, "utf-8"));
      _siteConfigCacheTs = now;
      return _siteConfigCache!;
    }
  } catch {
    // ignore
  }
  _siteConfigCache = {};
  _siteConfigCacheTs = now;
  return _siteConfigCache;
}

// 漫画库目录 - 优先级: 环境变量 > site-config.json > 默认值
export function getComicsDir(): string {
  if (process.env.COMICS_DIR) return process.env.COMICS_DIR;
  const cfg = loadSiteConfig();
  return cfg.comicsDir || path.join(process.cwd(), "comics");
}

// 获取所有漫画目录（主目录 + 额外挂载目录，用于 Docker/NAS）
export function getAllComicsDirs(): string[] {
  const dirs = [getComicsDir()];
  const cfg = loadSiteConfig();
  if (cfg.extraComicsDirs && Array.isArray(cfg.extraComicsDirs)) {
    for (const d of cfg.extraComicsDirs) {
      if (d && !dirs.includes(d)) dirs.push(d);
    }
  }
  return dirs;
}

/** @deprecated 使用 getComicsDir() 代替，保留兼容旧引用 */
export const COMICS_DIR =
  process.env.COMICS_DIR || path.join(process.cwd(), "comics");

// 缩略图缓存目录
export const THUMBNAILS_DIR = path.join(process.cwd(), ".cache", "thumbnails");

// 支持的压缩包格式
export const SUPPORTED_EXTENSIONS = [".zip", ".cbz", ".cbr", ".rar", ".7z", ".cb7", ".pdf"];

// 支持的图片格式（压缩包内的文件）
export const IMAGE_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".bmp",
  ".avif",
];

// 缩略图尺寸 - 动态读取
export function getThumbnailWidth(): number {
  return loadSiteConfig().thumbnailWidth || 400;
}
export function getThumbnailHeight(): number {
  return loadSiteConfig().thumbnailHeight || 560;
}
/** @deprecated 使用 getThumbnailWidth() / getThumbnailHeight() */
export const THUMBNAIL_WIDTH = 400;
export const THUMBNAIL_HEIGHT = 560;

// 每页数量 - 动态读取
export function getPageSize(): number {
  return loadSiteConfig().pageSize || 24;
}

// 站点名称 - 动态读取
export function getSiteName(): string {
  return loadSiteConfig().siteName || "NowenReader";
}
