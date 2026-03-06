import { prisma } from "./db";

/**
 * Cloud Sync Module
 * Supports WebDAV sync for reading progress, favorites, ratings, and settings.
 */

export interface SyncConfig {
  enabled: boolean;
  provider: "webdav" | "local";
  webdavUrl: string;
  webdavUsername: string;
  webdavPassword: string;
  autoSync: boolean;
  syncIntervalMinutes: number;
  lastSyncAt: string | null;
}

export interface SyncData {
  version: number;
  exportedAt: string;
  deviceId: string;
  comics: SyncComicData[];
  settings: Record<string, string>;
}

export interface SyncComicData {
  id: string;
  filename: string;
  lastReadPage: number;
  lastReadAt: string | null;
  isFavorite: boolean;
  rating: number | null;
  tags: string[];
}

const SYNC_VERSION = 1;

/**
 * Export local data for sync
 */
export async function exportSyncData(deviceId: string): Promise<SyncData> {
  const comics = await prisma.comic.findMany({
    include: {
      tags: {
        include: { tag: true },
      },
    },
  });

  return {
    version: SYNC_VERSION,
    exportedAt: new Date().toISOString(),
    deviceId,
    comics: comics.map((c) => ({
      id: c.id,
      filename: c.filename,
      lastReadPage: c.lastReadPage,
      lastReadAt: c.lastReadAt?.toISOString() || null,
      isFavorite: c.isFavorite,
      rating: c.rating,
      tags: c.tags.map((ct) => ct.tag.name),
    })),
    settings: {},
  };
}

/**
 * Import sync data: merge remote data with local (last-write-wins for conflicts)
 */
export async function importSyncData(remote: SyncData): Promise<{
  updated: number;
  skipped: number;
  conflicts: number;
}> {
  let updated = 0;
  let skipped = 0;
  let conflicts = 0;

  for (const remoteComic of remote.comics) {
    const localComic = await prisma.comic.findUnique({
      where: { id: remoteComic.id },
      include: { tags: { include: { tag: true } } },
    });

    if (!localComic) {
      skipped++;
      continue;
    }

    // Resolve conflict: remote wins if more recently read
    const remoteReadAt = remoteComic.lastReadAt ? new Date(remoteComic.lastReadAt).getTime() : 0;
    const localReadAt = localComic.lastReadAt ? localComic.lastReadAt.getTime() : 0;

    const shouldUpdate = remoteReadAt > localReadAt;

    if (shouldUpdate) {
      // Update reading progress
      await prisma.comic.update({
        where: { id: remoteComic.id },
        data: {
          lastReadPage: Math.max(remoteComic.lastReadPage, localComic.lastReadPage),
          lastReadAt: remoteReadAt > localReadAt
            ? new Date(remoteComic.lastReadAt!)
            : localComic.lastReadAt,
          isFavorite: remoteComic.isFavorite || localComic.isFavorite,
          rating: remoteComic.rating ?? localComic.rating,
        },
      });

      // Merge tags (union)
      const localTags = new Set(localComic.tags.map((ct) => ct.tag.name));
      const newTags = remoteComic.tags.filter((t) => !localTags.has(t));
      for (const tagName of newTags) {
        const tag = await prisma.tag.upsert({
          where: { name: tagName },
          create: { name: tagName },
          update: {},
        });
        await prisma.comicTag.upsert({
          where: { comicId_tagId: { comicId: remoteComic.id, tagId: tag.id } },
          create: { comicId: remoteComic.id, tagId: tag.id },
          update: {},
        });
      }

      updated++;
    } else if (remoteReadAt === localReadAt) {
      // Same timestamp, merge favorites and max progress
      await prisma.comic.update({
        where: { id: remoteComic.id },
        data: {
          lastReadPage: Math.max(remoteComic.lastReadPage, localComic.lastReadPage),
          isFavorite: remoteComic.isFavorite || localComic.isFavorite,
          rating: remoteComic.rating ?? localComic.rating,
        },
      });
      conflicts++;
    } else {
      skipped++;
    }
  }

  return { updated, skipped, conflicts };
}

/**
 * WebDAV client operations
 */
export class WebDAVSync {
  private url: string;
  private username: string;
  private password: string;

  constructor(url: string, username: string, password: string) {
    this.url = url.replace(/\/+$/, "");
    this.username = username;
    this.password = password;
  }

  private get authHeader(): string {
    return "Basic " + Buffer.from(`${this.username}:${this.password}`).toString("base64");
  }

  async testConnection(): Promise<boolean> {
    try {
      const res = await fetch(this.url, {
        method: "PROPFIND",
        headers: {
          Authorization: this.authHeader,
          Depth: "0",
        },
      });
      return res.status === 207 || res.status === 200;
    } catch {
      return false;
    }
  }

  async upload(path: string, data: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.url}/${path}`, {
        method: "PUT",
        headers: {
          Authorization: this.authHeader,
          "Content-Type": "application/json",
        },
        body: data,
      });
      return res.ok || res.status === 201 || res.status === 204;
    } catch {
      return false;
    }
  }

  async download(path: string): Promise<string | null> {
    try {
      const res = await fetch(`${this.url}/${path}`, {
        headers: {
          Authorization: this.authHeader,
        },
      });
      if (!res.ok) return null;
      return await res.text();
    } catch {
      return null;
    }
  }

  async ensureDirectory(path: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.url}/${path}/`, {
        method: "MKCOL",
        headers: {
          Authorization: this.authHeader,
        },
      });
      return res.ok || res.status === 201 || res.status === 405; // 405 = already exists
    } catch {
      return false;
    }
  }
}

/**
 * Perform full sync via WebDAV
 */
export async function performWebDAVSync(config: SyncConfig, deviceId: string): Promise<{
  success: boolean;
  message: string;
  updated: number;
}> {
  if (!config.webdavUrl || !config.webdavUsername) {
    return { success: false, message: "WebDAV not configured", updated: 0 };
  }

  const client = new WebDAVSync(config.webdavUrl, config.webdavUsername, config.webdavPassword);

  // Test connection
  const connected = await client.testConnection();
  if (!connected) {
    return { success: false, message: "Cannot connect to WebDAV server", updated: 0 };
  }

  // Ensure sync directory
  await client.ensureDirectory("nowen-reader");

  // Download remote data
  const remoteJson = await client.download("nowen-reader/sync-data.json");
  let totalUpdated = 0;

  if (remoteJson) {
    try {
      const remoteData: SyncData = JSON.parse(remoteJson);
      // Import remote data
      const result = await importSyncData(remoteData);
      totalUpdated = result.updated;
    } catch {
      // Invalid remote data, will be overwritten
    }
  }

  // Export and upload local data
  const localData = await exportSyncData(deviceId);
  const uploaded = await client.upload("nowen-reader/sync-data.json", JSON.stringify(localData, null, 2));

  if (!uploaded) {
    return { success: false, message: "Failed to upload sync data", updated: totalUpdated };
  }

  return {
    success: true,
    message: `Sync completed: ${totalUpdated} items updated`,
    updated: totalUpdated,
  };
}
