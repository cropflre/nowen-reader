/**
 * Barrel re-export file — 保持向后兼容
 *
 * 所有具体实现已拆分到以下模块：
 * - useComicTypes.ts    — 共享类型定义
 * - useComicList.ts     — useComics hook + 缓存
 * - useComicReader.ts   — useComicPages + useComicDetail hooks
 * - useComicStats.ts    — useReadingStats hook
 * - useCategories.ts    — useCategories hook
 * - @/api/comics.ts     — 独立 API 调用函数
 *
 * 已有的 import { xxx } from "@/hooks/useComics" 无需修改。
 */

// 类型导出
export type { ApiComicTag, ApiComic, ComicsResponse, ApiCategory } from "./useComicTypes";

// Hook 导出
export { useComics, invalidateComicsCache } from "./useComicList";
export { useComicPages, useComicDetail } from "./useComicReader";
export { useReadingStats } from "./useComicStats";
export { useCategories } from "./useCategories";

// API 函数导出
export {
  uploadComics,
  saveReadingProgress,
  toggleComicFavorite,
  updateComicRating,
  addComicTags,
  removeComicTag,
  batchOperation,
  deleteComicById,
  startSession,
  endSession,
  updateSortOrders,
  addComicCategories,
  setComicCategories,
  removeComicCategory,
} from "@/api/comics";
