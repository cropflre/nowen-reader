import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function loadModule(path) {
  const source = ts.transpileModule(
    fs.readFileSync(new URL(path, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    }
  ).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports });
  return module.exports;
}

const {
  ESTIMATED_PAGE_HEIGHT,
  DEFAULT_ASPECT_RATIO,
  computeRenderRange,
  getWebtoonPageHeight,
  getWebtoonPageTop,
  findWebtoonCenterPage,
  calibrateDefaultAspectRatio,
  computeAnchoredScrollTop,
  shouldIgnoreScrollEcho,
} = loadModule("../src/components/reader/webtoon-layout.ts");

// 1. Height & range basics
assert.deepEqual({ ...computeRenderRange(0, 0) }, { start: 0, end: -1 });
assert.deepEqual({ ...computeRenderRange(25, 40) }, { start: 20, end: 30 });
assert.deepEqual({ ...computeRenderRange(1, 40) }, { start: 0, end: 6 });

const unmeasuredDims = new Map();
const preWidthConfig = {
  pageCount: 40,
  dimensions: unmeasuredDims,
  contentWidth: 0,
  defaultRatio: DEFAULT_ASPECT_RATIO,
};
assert.equal(getWebtoonPageHeight(0, preWidthConfig), ESTIMATED_PAGE_HEIGHT);

const dims = new Map([
  [0, { width: 1200, height: 1728 }],
  [1, { width: 2400, height: 1200 }], // wide spread
]);
const measuredConfig = {
  pageCount: 40,
  dimensions: dims,
  contentWidth: 768,
  defaultRatio: DEFAULT_ASPECT_RATIO,
};
assert.ok(Math.abs(getWebtoonPageHeight(0, measuredConfig) - 1105.92) < 0.01);
assert.equal(getWebtoonPageHeight(1, measuredConfig), 384);
assert.equal(getWebtoonPageHeight(2, measuredConfig), 768 * DEFAULT_ASPECT_RATIO);
assert.ok(Math.abs(getWebtoonPageTop(2, measuredConfig) - (1105.92 + 384)) < 0.01);

// 2. Median aspect-ratio calibration ignores a single wide cover
const sampleDims = new Map([
  [0, { width: 2400, height: 1200 }], // 0.5 cover
  [1, { width: 1000, height: 1440 }], // 1.44
]);
assert.equal(calibrateDefaultAspectRatio(sampleDims, 30), null);
sampleDims.set(2, { width: 1000, height: 1440 }); // 1.44
assert.ok(Math.abs(calibrateDefaultAspectRatio(sampleDims, 30) - 1.44) < 0.001);

// 3. Upward scroll anchor compensation when page above viewport finishes loading
const prevDims = new Map();
const prevConfig = {
  pageCount: 40,
  dimensions: prevDims,
  contentWidth: 768,
  defaultRatio: 1.5, // 1152px per unmeasured page
};
const page25TopBefore = getWebtoonPageTop(25, prevConfig); // 25 * 1152 = 28800
const prevScrollTop = page25TopBefore + 120; // User is 120px inside page 25

// Page 18 (above viewport!) finishes loading as a taller image (ratio 2.5 -> 1920px, +768px)
const nextDimsAbove = new Map([[18, { width: 800, height: 2000 }]]);
const nextConfigAbove = { ...prevConfig, dimensions: nextDimsAbove };
const anchoredAbove = computeAnchoredScrollTop(prevConfig, nextConfigAbove, prevScrollTop);
assert.equal(anchoredAbove.delta, 768);
assert.equal(anchoredAbove.nextScrollTop, prevScrollTop + 768);
assert.equal(findWebtoonCenterPage(anchoredAbove.nextScrollTop, 900, nextConfigAbove), 25);

// 4. Page below viewport finishing load must NOT shift scrollTop
const nextDimsBelow = new Map([[28, { width: 800, height: 2000 }]]);
const nextConfigBelow = { ...prevConfig, dimensions: nextDimsBelow };
const anchoredBelow = computeAnchoredScrollTop(prevConfig, nextConfigBelow, prevScrollTop);
assert.equal(anchoredBelow.delta, 0);
assert.equal(anchoredBelow.nextScrollTop, prevScrollTop);

// 5. Container resize / phone rotation scales offset proportionally inside anchor page
const resizedConfig = { ...prevConfig, contentWidth: 384 };
const anchoredResize = computeAnchoredScrollTop(prevConfig, resizedConfig, prevScrollTop);
assert.equal(anchoredResize.nextScrollTop, 25 * (384 * 1.5) + 60);

// 6. Scroll echo filtering vs external jumps
const recentReports = new Map([[12, 1000]]);
assert.equal(shouldIgnoreScrollEcho(15, 15, recentReports, 1050), true);
assert.equal(shouldIgnoreScrollEcho(12, 15, recentReports, 1100), true);
assert.equal(shouldIgnoreScrollEcho(12, 15, recentReports, 1400), false);
assert.equal(shouldIgnoreScrollEcho(30, 15, recentReports, 1050), false);

// 7. Structural regression checks on WebtoonView.tsx & ReaderPage
const webtoonSource = fs.readFileSync(
  new URL("../src/components/reader/WebtoonView.tsx", import.meta.url),
  "utf8"
);
assert.equal(webtoonSource.includes("img.clientHeight"), false, "Must not use img.clientHeight");
assert.equal(
  webtoonSource.includes('loading="lazy"'),
  false,
  "Virtualized buffer images must not defer load with loading=lazy"
);
assert.equal(
  webtoonSource.includes("if (isScrollingRef.current) return;"),
  false,
  "External jumps must not be dropped during scroll settle window"
);
assert.ok(webtoonSource.includes("aspectRatio"), "Known pages should hold box height via aspectRatio");
assert.ok(webtoonSource.includes("ResizeObserver"), "Must react to container width changes");

const readerPageSource = fs.readFileSync(
  new URL("../src/app/reader/[id]/page.tsx", import.meta.url),
  "utf8"
);
assert.ok(
  readerPageSource.includes("<WebtoonView\n          key={comicId}"),
  "WebtoonView should be keyed by comicId across volume switches"
);

console.log("✅ Webtoon layout regression tests passed");
