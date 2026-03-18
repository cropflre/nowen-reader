// Comic reading modes (no "text" — novels use a dedicated reader)
export type ComicReadingMode = "single" | "double" | "webtoon";

// Legacy alias — kept for backward compatibility
export type ReadingMode = ComicReadingMode | "text";

export type ReadingDirection = "ltr" | "rtl"; // left-to-right or right-to-left (manga style)

// 适应显示模式
export type FitMode = "container" | "width" | "height";

// 阅读器完整选项（持久化到 localStorage）
export interface ReaderOptions {
  // 适应显示
  fitMode: FitMode;
  // 容器宽度（像素或百分比，如 "1200px" 或 "90%"）
  containerWidth: string;
  // 页面渲染模式
  mode: ComicReadingMode;
  // 阅读方向
  direction: ReadingDirection;
  // 预加载图片数量
  preloadCount: number;
  // 头部可见性
  headerVisible: boolean;
  // 默认显示档案覆盖层
  defaultOverlay: boolean;
  // 进度跟踪
  progressTracking: boolean;
  // 无限滚动（webtoon 模式）
  infiniteScroll: boolean;
  // 自动翻页间隔（秒），0 表示禁用
  autoPageInterval: number;
}

export const defaultReaderOptions: ReaderOptions = {
  fitMode: "container",
  containerWidth: "",
  mode: "single",
  direction: "ltr",
  preloadCount: 2,
  headerVisible: true,
  defaultOverlay: false,
  progressTracking: true,
  infiniteScroll: false,
  autoPageInterval: 10,
};

export interface ReaderSettings {
  mode: ComicReadingMode;
  direction: ReadingDirection;
  fitMode: "width" | "height" | "contain";
  showPageNumber: boolean;
}

export const defaultReaderSettings: ReaderSettings = {
  mode: "single",
  direction: "ltr",
  fitMode: "contain",
  showPageNumber: true,
};
