/** Estimated fallback page height (px) before container width is measured. */
export const ESTIMATED_PAGE_HEIGHT = 1200;
/** Default portrait aspect ratio (height / width) before any page dimensions are known. */
export const DEFAULT_ASPECT_RATIO = 1.5;
/** Number of pages to render outside viewport (buffer). */
export const RENDER_BUFFER = 5;
/** Pages outside renderRange ± DOM_BUFFER are collapsed into top/bottom spacer divs. */
export const DOM_BUFFER = 15;
/** Throttle interval (ms) for reporting current page during scroll. */
export const SCROLL_REPORT_THROTTLE = 100;
/** Time window (ms) to ignore delayed React state echoes of scroll-reported pages. */
export const SCROLL_ECHO_WINDOW_MS = 300;

export interface WebtoonDimension {
  width: number;
  height: number;
}

export interface WebtoonLayoutConfig {
  pageCount: number;
  dimensions: ReadonlyMap<number, WebtoonDimension>;
  contentWidth: number;
  defaultRatio: number;
}

export interface RenderRange {
  start: number;
  end: number;
}

/**
 * Computes the virtualized image render range centered around `centerPage`.
 */
export function computeRenderRange(
  centerPage: number,
  pageCount: number,
  buffer: number = RENDER_BUFFER
): RenderRange {
  if (pageCount <= 0) {
    return { start: 0, end: -1 };
  }
  const clamped = Math.max(0, Math.min(pageCount - 1, centerPage));
  return {
    start: Math.max(0, clamped - buffer),
    end: Math.min(pageCount - 1, clamped + buffer),
  };
}

/**
 * Returns the deterministic layout height for page `index`.
 * Uses recorded natural aspect ratio × container width when known,
 * falling back to `contentWidth * defaultRatio` (or `ESTIMATED_PAGE_HEIGHT` before measurement).
 */
export function getWebtoonPageHeight(
  index: number,
  config: WebtoonLayoutConfig
): number {
  const dim = config.dimensions.get(index);
  if (dim && dim.width > 0 && dim.height > 0) {
    if (config.contentWidth > 0) {
      return config.contentWidth * (dim.height / dim.width);
    }
    return ESTIMATED_PAGE_HEIGHT;
  }
  if (config.contentWidth > 0) {
    return config.contentWidth * config.defaultRatio;
  }
  return ESTIMATED_PAGE_HEIGHT;
}

/**
 * Computes cumulative top offset (px) for `targetPage`.
 */
export function getWebtoonPageTop(
  targetPage: number,
  config: WebtoonLayoutConfig
): number {
  const limit = Math.max(0, Math.min(config.pageCount, targetPage));
  let top = 0;
  for (let i = 0; i < limit; i++) {
    top += getWebtoonPageHeight(i, config);
  }
  return top;
}

/**
 * Finds the page index intersecting `scrollTop + viewportHeight / 3`.
 */
export function findWebtoonCenterPage(
  scrollTop: number,
  viewportHeight: number,
  config: WebtoonLayoutConfig
): number {
  if (config.pageCount <= 0) return 0;
  const viewCenter = Math.max(0, scrollTop + viewportHeight / 3);
  let accumulated = 0;
  for (let i = 0; i < config.pageCount; i++) {
    const h = getWebtoonPageHeight(i, config);
    if (accumulated + h > viewCenter) {
      return i;
    }
    accumulated += h;
  }
  return config.pageCount - 1;
}

/**
 * Calibrates a volume's typical aspect ratio once enough sample pages have loaded.
 * Using the median of up to 3 samples avoids letting a single wide landscape cover
 * skew the estimated height of all remaining portrait pages.
 */
export function calibrateDefaultAspectRatio(
  dimensions: ReadonlyMap<number, WebtoonDimension>,
  pageCount: number
): number | null {
  if (pageCount <= 0 || dimensions.size === 0) return null;
  const requiredSamples = Math.min(3, pageCount);
  if (dimensions.size < requiredSamples) return null;

  const ratios: number[] = [];
  for (const dim of dimensions.values()) {
    if (dim.width > 0 && dim.height > 0) {
      const clamped = Math.max(0.4, Math.min(8, dim.height / dim.width));
      ratios.push(clamped);
    }
  }
  if (ratios.length < requiredSamples) return null;

  ratios.sort((a, b) => a - b);
  return ratios[Math.floor(ratios.length / 2)];
}

/**
 * Computes scrollTop compensation when page heights above the viewport or container width change.
 * Keeps the user's current top anchor page pinned in place even on browsers without CSS scroll anchoring (Safari).
 */
export function computeAnchoredScrollTop(
  prevConfig: WebtoonLayoutConfig,
  nextConfig: WebtoonLayoutConfig,
  prevScrollTop: number
): { nextScrollTop: number; delta: number } {
  if (prevScrollTop <= 0 || prevConfig.pageCount <= 0 || nextConfig.pageCount <= 0) {
    return { nextScrollTop: prevScrollTop, delta: 0 };
  }

  let anchorPage = prevConfig.pageCount - 1;
  let prevAnchorTop = 0;
  let prevAnchorHeight = 0;
  let accumulated = 0;

  for (let i = 0; i < prevConfig.pageCount; i++) {
    const h = getWebtoonPageHeight(i, prevConfig);
    if (accumulated + h > prevScrollTop || i === prevConfig.pageCount - 1) {
      anchorPage = i;
      prevAnchorTop = accumulated;
      prevAnchorHeight = h;
      break;
    }
    accumulated += h;
  }

  const offsetInPage = Math.max(0, prevScrollTop - prevAnchorTop);
  const nextAnchorTop = getWebtoonPageTop(anchorPage, nextConfig);
  const nextAnchorHeight = getWebtoonPageHeight(anchorPage, nextConfig);

  let nextOffsetInPage: number;
  if (offsetInPage > prevAnchorHeight) {
    // Preserve offset if scrolled past the last page into the footer area.
    nextOffsetInPage = nextAnchorHeight + (offsetInPage - prevAnchorHeight);
  } else if (prevConfig.contentWidth !== nextConfig.contentWidth && prevAnchorHeight > 0) {
    nextOffsetInPage = (offsetInPage / prevAnchorHeight) * nextAnchorHeight;
  } else {
    nextOffsetInPage = Math.min(offsetInPage, nextAnchorHeight);
  }

  const nextScrollTop = Math.max(0, nextAnchorTop + nextOffsetInPage);
  return {
    nextScrollTop,
    delta: nextScrollTop - prevScrollTop,
  };
}

/**
 * Distinguishes delayed React renders of scroll-reported pages from true external jumps.
 */
export function shouldIgnoreScrollEcho(
  currentPage: number,
  lastScrollReportedPage: number,
  recentScrollReports: ReadonlyMap<number, number>,
  now: number,
  echoWindowMs: number = SCROLL_ECHO_WINDOW_MS
): boolean {
  if (currentPage === lastScrollReportedPage) return true;
  const reportedAt = recentScrollReports.get(currentPage);
  return reportedAt !== undefined && now - reportedAt < echoWindowMs;
}
