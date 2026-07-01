/**
 * Barrel re-export file — 保持向后兼容
 *
 * 所有具体实现已拆分到以下模块：
 * - useComicTypes.ts    — 共享类型定义
 * - useComicList.ts     — useComics hook + 缓存
 * - useComicReader.ts   — useComicPages + useComicDetail hooks
 * - useCategories.ts    — useCategories hook
 * - @/api/comics.ts     — 独立 API 调用函数
 *
 * 已有的 import { xxx } from "@/hooks/useComics" 无需修改。
 */

// 类型导出
export type { ApiComicTag, ApiComic, ComicsResponse, ApiCategory, ComicGroup, ComicGroupDetail, GroupComicItem, AutoDetectGroup } from "./useComicTypes";
export type { ComicMetadataUpdate } from "@/api/comics";

// Hook 导出
export { useComics, invalidateComicsCache, notifyLibraryAccessChanged, LIBRARY_ACCESS_CHANGED_EVENT } from "./useComicList";
export { useComicPages, useComicDetail } from "./useComicReader";
export { useCategories } from "./useCategories";

// API 函数导出
export {
  uploadComics,
  saveReadingProgress,
  toggleComicFavorite,
  updateComicRating,
  addComicTags,
  removeComicTag,
  clearAllComicTags,
  batchOperation,
  deleteComicById,
  startSession,
  endSession,
  endSessionBeacon,
  updateSortOrders,
  addComicCategories,
  setComicCategories,
  removeComicCategory,
  clearAllComicCategories,
  updateComicMetadata,
  setReadingStatus,
} from "@/api/comics";
