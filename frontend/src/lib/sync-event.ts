/**
 * 全局元数据同步事件总线
 *
 * 用于在漫画详情页和刮削页面之间实现实时数据同步。
 * 当一端修改了元数据（标签、分类、基本信息等），通过事件总线通知另一端刷新。
 *
 * 支持的事件类型：
 * - metadata_updated: 元数据被修改（标题、作者、描述等）
 * - tags_updated: 标签被添加/删除
 * - categories_updated: 分类被添加/删除
 * - cover_updated: 封面被更新
 * - scrape_applied: 刮削结果被应用
 * - metadata_cleared: 元数据被清除
 * - sync_requested: 手动触发同步请求
 */

export type SyncEventType =
  | "metadata_updated"
  | "tags_updated"
  | "categories_updated"
  | "cover_updated"
  | "scrape_applied"
  | "metadata_cleared"
  | "sync_requested"
  | "batch_sync_complete";

export interface SyncEvent {
  type: SyncEventType;
  comicId: string;
  source: "detail" | "scraper" | "batch" | "api" | "tag-manager";
  timestamp: number;
  data?: Record<string, unknown>;
}

type SyncEventListener = (event: SyncEvent) => void;

// 使用 BroadcastChannel 实现跨标签页同步
const CHANNEL_NAME = "nowen-metadata-sync";

class MetadataSyncBus {
  private listeners = new Map<string, Set<SyncEventListener>>();
  private globalListeners = new Set<SyncEventListener>();
  private channel: BroadcastChannel | null = null;
  private recentEvents: SyncEvent[] = [];
  private maxRecentEvents = 50;

  constructor() {
    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
      try {
        this.channel = new BroadcastChannel(CHANNEL_NAME);
        this.channel.onmessage = (e: MessageEvent<SyncEvent>) => {
          // 收到来自其他标签页的同步事件
          this.dispatchLocal(e.data);
        };
      } catch {
        // BroadcastChannel 不可用，降级为单页面模式
      }
    }
  }

  /**
   * 发布同步事件（广播到所有监听者和其他标签页）
   */
  emit(event: SyncEvent): void {
    // 记录到最近事件列表
    this.recentEvents.unshift(event);
    if (this.recentEvents.length > this.maxRecentEvents) {
      this.recentEvents = this.recentEvents.slice(0, this.maxRecentEvents);
    }

    // 本地分发
    this.dispatchLocal(event);

    // 跨标签页广播
    try {
      this.channel?.postMessage(event);
    } catch {
      // ignore
    }
  }

  /**
   * 监听特定漫画的同步事件
   */
  on(comicId: string, listener: SyncEventListener): () => void {
    if (!this.listeners.has(comicId)) {
      this.listeners.set(comicId, new Set());
    }
    this.listeners.get(comicId)!.add(listener);

    return () => {
      this.listeners.get(comicId)?.delete(listener);
    };
  }

  /**
   * 监听所有同步事件（全局监听）
   */
  onAll(listener: SyncEventListener): () => void {
    this.globalListeners.add(listener);
    return () => {
      this.globalListeners.delete(listener);
    };
  }

  /**
   * 获取最近的同步事件
   */
  getRecentEvents(): SyncEvent[] {
    return [...this.recentEvents];
  }

  /**
   * 获取指定漫画的最近同步事件
   */
  getRecentEventsForComic(comicId: string): SyncEvent[] {
    return this.recentEvents.filter((e) => e.comicId === comicId);
  }

  /**
   * 清除事件历史
   */
  clearHistory(): void {
    this.recentEvents = [];
  }

  /**
   * 销毁事件总线
   */
  destroy(): void {
    this.listeners.clear();
    this.globalListeners.clear();
    this.channel?.close();
    this.channel = null;
  }

  private dispatchLocal(event: SyncEvent): void {
    // 通知特定漫画的监听者
    const comicListeners = this.listeners.get(event.comicId);
    if (comicListeners) {
      comicListeners.forEach((listener) => {
        try {
          listener(event);
        } catch {
          // ignore listener errors
        }
      });
    }

    // 通知全局监听者
    this.globalListeners.forEach((listener) => {
      try {
        listener(event);
      } catch {
        // ignore listener errors
      }
    });
  }
}

// 全局单例
export const syncBus = typeof window !== "undefined" ? new MetadataSyncBus() : (null as unknown as MetadataSyncBus);

// ── 便捷方法 ──

/** 发布元数据更新事件 */
export function emitMetadataUpdated(
  comicId: string,
  source: SyncEvent["source"],
  data?: Record<string, unknown>
): void {
  syncBus?.emit({
    type: "metadata_updated",
    comicId,
    source,
    timestamp: Date.now(),
    data,
  });
}

/** 发布标签更新事件 */
export function emitTagsUpdated(
  comicId: string,
  source: SyncEvent["source"],
  data?: Record<string, unknown>
): void {
  syncBus?.emit({
    type: "tags_updated",
    comicId,
    source,
    timestamp: Date.now(),
    data,
  });
}

/** 发布分类更新事件 */
export function emitCategoriesUpdated(
  comicId: string,
  source: SyncEvent["source"],
  data?: Record<string, unknown>
): void {
  syncBus?.emit({
    type: "categories_updated",
    comicId,
    source,
    timestamp: Date.now(),
    data,
  });
}

/** 发布刮削应用事件 */
export function emitScrapeApplied(
  comicId: string,
  source: SyncEvent["source"],
  data?: Record<string, unknown>
): void {
  syncBus?.emit({
    type: "scrape_applied",
    comicId,
    source,
    timestamp: Date.now(),
    data,
  });
}

/** 发布元数据清除事件 */
export function emitMetadataCleared(
  comicId: string,
  source: SyncEvent["source"]
): void {
  syncBus?.emit({
    type: "metadata_cleared",
    comicId,
    source,
    timestamp: Date.now(),
  });
}

/** 发布手动同步请求事件 */
export function emitSyncRequested(
  comicId: string,
  source: SyncEvent["source"]
): void {
  syncBus?.emit({
    type: "sync_requested",
    comicId,
    source,
    timestamp: Date.now(),
  });
}
