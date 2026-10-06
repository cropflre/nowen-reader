import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createElement, useState } from "react";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import * as icons from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";

function loadModule(path, dependencies = {}, extraSource = "") {
  const source = ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), "utf8") + extraSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, exports: module.exports,
    require(name) { assert.ok(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name]; },
  });
  return module.exports;
}

const progress = loadModule("../src/lib/progress.ts");
const nsfw = loadModule("../src/lib/nsfw.ts");
const { selectContinueReading, shelfPositions, comicFileFormat, readingBackdropSrc } = loadModule("../src/components/home/dashboard-shelf.ts", { "@/lib/progress": progress, "@/lib/nsfw": nsfw });
const utils = loadModule("../src/lib/comic-utils.ts");
const comic = { id: "one", pageCount: 100, lastReadPage: 0, lastReadAt: null, readingStatus: "" };
assert.equal(selectContinueReading([comic]).length, 0);
assert.equal(selectContinueReading([{ ...comic, lastReadAt: "2026-10-07T00:00:00Z" }]).length, 1);
assert.equal(selectContinueReading([{ ...comic, readingStatus: "reading" }]).length, 1);
assert.equal(selectContinueReading([{ ...comic, lastReadPage: 3 }]).length, 1);
assert.equal(selectContinueReading([{ ...comic, readingStatus: "finished" }]).length, 0);
assert.equal(selectContinueReading([{ ...comic, lastReadPage: 99 }]).length, 0);
assert.equal(selectContinueReading([{ ...comic, pageCount: 1 }]).length, 0);
assert.equal(selectContinueReading([{ ...comic, pageCount: 1, lastReadAt: "2026-10-07" }]).length, 0);
const many = Array.from({ length: 12 }, (_, index) => ({ ...comic, id: `${index}`, lastReadPage: 10 }));
assert.equal(selectContinueReading(many).length, 8);
assert.equal(selectContinueReading(many)[0].id, "0");

assert.equal(shelfPositions(0, 0).length, 0);
for (let count = 1; count <= 8; count++) {
  for (let active = -1; active <= count; active++) {
    const slots = shelfPositions(count, active);
    assert.equal(slots.length, count);
    assert.equal(new Set(slots).size, count);
    assert.equal(slots[((active % count) + count) % count], 4);
    assert.ok(slots.every((slot) => slot >= 0 && slot <= 7));
  }
}
assert.equal(comicFileFormat("Book.EPUB"), "EPUB");
assert.equal(comicFileFormat("Book.cbz"), "CBZ");
assert.equal(utils.getReaderUrl({ id: "novel", filename: "novel.epub" }), "/novel/novel");
assert.equal(utils.getReaderUrl({ id: "comic", filename: "book.mobi", type: "comic" }), "/reader/comic");
assert.equal(utils.isNovelComic({ filename: "Book.EPUB" }), true);
assert.equal(utils.isNovelComic({ filename: "Book.epub", type: "comic" }), false);
const coveredComic = { ...comic, title: "Book", coverUrl: " /api/comics/one/thumbnail " };
assert.equal(readingBackdropSrc(coveredComic, false), "/api/comics/one/thumbnail");
assert.equal(readingBackdropSrc(coveredComic, true), "/api/comics/one/thumbnail");
assert.equal(readingBackdropSrc({ ...coveredComic, coverUrl: " " }, false), null);
assert.equal(readingBackdropSrc({ ...coveredComic, coverUrl: null }, false), null);
assert.equal(readingBackdropSrc({ ...coveredComic, coverUrl: undefined }, false), null);
assert.equal(readingBackdropSrc({ ...coveredComic, title: "Adult Book" }, true), null);
assert.equal(readingBackdropSrc({ ...coveredComic, tags: [{ name: "R-18" }] }, true), null);
assert.equal(readingBackdropSrc({ ...coveredComic, filename: "book.NSFW.cbz" }, true), null);
assert.equal(readingBackdropSrc({ ...coveredComic, tags: [{ name: "NSFW" }] }, false), "/api/comics/one/thumbnail");

const backdrop = loadModule("../src/components/home/DashboardAmbientBackdrop.tsx", {
  "react": { useState },
  "react/jsx-runtime": jsxRuntime,
  "next/image": { default: ({ src, alt, className, sizes, draggable }) => createElement("img", { src, alt, className, sizes, draggable }) },
  "./dashboard-shelf": { readingBackdropSrc },
}).default;
const renderBackdrop = (comics, activeId, hideNSFW = false) => renderToStaticMarkup(createElement(backdrop, { comics, activeId, hideNSFW }));
const safeBackdrop = { ...coveredComic, id: "safe", coverUrl: "/covers/safe.jpg" };
const privateBackdrop = { ...coveredComic, id: "private", title: "Adult Book", coverUrl: "/covers/private.jpg" };
const anotherBackdrop = { ...coveredComic, id: "another", coverUrl: "/covers/another.jpg" };
let backgroundHtml = renderBackdrop([safeBackdrop, anotherBackdrop], "another");
assert.ok(backgroundHtml.includes('class="dashboard-ambient-backdrop" aria-hidden="true"'));
assert.equal((backgroundHtml.match(/class="ds-backdrop-layer ds-visible"/g) || []).length, 1);
assert.ok(backgroundHtml.includes('class="ds-backdrop-layer ds-visible"><img src="/covers/another.jpg"'));
assert.ok(backgroundHtml.includes('alt=""'));
assert.ok(backgroundHtml.includes('sizes="100vw"'));
assert.ok(backgroundHtml.includes('draggable="false"'));
assert.ok(!renderBackdrop([], "").includes("<img"));
assert.ok(!renderBackdrop([{ ...safeBackdrop, coverUrl: " " }], "safe").includes("<img"));
backgroundHtml = renderBackdrop([safeBackdrop, privateBackdrop], "private", true);
assert.ok(!backgroundHtml.includes("/covers/private.jpg"));
assert.ok(backgroundHtml.includes("/covers/safe.jpg"));
assert.ok(!backgroundHtml.includes("ds-visible"));
assert.ok(!renderBackdrop([safeBackdrop, privateBackdrop], "safe", true).includes("/covers/private.jpg"));
assert.ok(renderBackdrop([safeBackdrop, privateBackdrop], "private", false).includes("/covers/private.jpg"));
const queries = [];
const dashboardDependencies = {
  react: React,
  "react/jsx-runtime": jsxRuntime,
  "next/link": { default: ({ href, children, ...props }) => createElement("a", { href, ...props }, children) },
  "lucide-react": icons,
  "@/components/NSFWCoverGuard": { default: ({ src, alt }) => createElement("img", { src, alt }) },
  "@/components/Toast": { useToast: () => ({ error() {} }) },
  "@/hooks/useComics": { useComics: (query) => {
    queries.push(query);
    return { comics: [{ ...safeBackdrop, filename: "book.cbz", lastReadPage: 2 }], loading: false, error: null, refetch() {}, setComics() {} };
  } },
  "@/hooks/usePrivacyMode": { usePrivacyMode: () => ({ enabled: false, blurNSFW: false }) },
  "@/lib/i18n": { useTranslation: () => ({
    dashboard: { continueReading: "Continue Reading", allLibrary: "Library", continueAction: "Continue", recentlyAdded: "Recently Added" },
    home: {}, common: {}, contextMenu: {}, batch: {}, continueReading: { pageUnit: "pages" }, reader: {},
  }) },
  "@/lib/comic-utils": utils, "@/lib/nsfw": nsfw, "@/lib/progress": progress,
  "./dashboard-shelf": { selectContinueReading, shelfPositions, comicFileFormat },
  "../book-card-size.css": {},
  "./dashboard-main.css": {},
};
const dashboard = loadModule("../src/components/home/DashboardMain.tsx", dashboardDependencies).default;
const dashboardHtml = renderToStaticMarkup(createElement(dashboard, { refreshKey: 0, onUpload() {}, isAdmin: true, onFocusChange() {} }));
assert.ok(dashboardHtml.includes("Continue Reading"));
assert.ok(!dashboardHtml.includes('role="tablist"'), "Home should not expose the removed content-type filters");
assert.ok(!dashboardHtml.includes("ds-toolbar"));
assert.ok(dashboardHtml.includes('href="/books"'), "The shelf should retain its library shortcut");
assert.equal(queries.length, 2, "Only recent and continuing books should be requested, without filter-count queries");
assert.ok(queries.every((query) => !("contentType" in query)), "The home shelf must include every content type");
assert.ok(dashboardHtml.includes('class="ds-continue"'), "The continuing-reading button should remain available");
assert.ok(dashboardHtml.includes('class="ds-cover-select"'), "Cover clicks should select a book in the shelf");
assert.ok(!dashboardHtml.includes('class="ds-feature-link"'), "Selection and reading must remain separate actions");

const changes = [];
const { Shelf } = loadModule("../src/components/home/DashboardMain.tsx", {
  ...dashboardDependencies,
  react: { ...React, useState: (initial) => [initial, (value) => changes.push(value)], useRef: (initial) => ({ current: initial }), useEffect() {} },
}, "\nexport { Shelf };\n");
const shelfTree = Shelf({ comics: [safeBackdrop, { ...safeBackdrop, id: "next", filename: "Book.epub" }], onFocusChange() {} });
const region = shelfTree.props.children[1];
const cardLinks = region.props.children.map((article) => article.props.children[1].props.children[2]);
const coverSelections = region.props.children.map((article) => article.props.children[0].props.children[1]);
assert.equal(cardLinks[0].props.href, "/reader/safe");
assert.equal(cardLinks[1].props.href, "/novel/next");
assert.equal(coverSelections[0].props["aria-pressed"], true);
assert.equal(coverSelections[1].props["aria-pressed"], false);
coverSelections[1].props.onClick();
assert.ok(changes.includes("next"), "Clicking another cover should select that book");
const titleSelection = region.props.children[0].props.children[1].props.children[0].props.children[0];
titleSelection.props.onClick();
assert.ok(changes.includes("safe"), "The title should also select the book");
assert.equal(cardLinks[0].props.onClick, undefined, "Continue should retain its ordinary reader navigation");
changes.length = 0;
region.props.onPointerDown({ button: 0, pointerId: 1, clientX: 100, target: { closest: () => null } });
let captured = false;
region.props.onPointerMove({ pointerId: 1, clientX: 20, currentTarget: { setPointerCapture() { captured = true; } } });
region.props.onPointerUp({ pointerId: 1, clientX: 20 });
assert.equal(captured, true);
assert.ok(changes.includes("next"), "Swiping should retain carousel navigation");
const changeCount = changes.length;
coverSelections[0].props.onClick();
assert.equal(changes.length, changeCount, "A swipe's trailing click must not select a different book");
const cardSizes = fs.readFileSync(new URL("../src/components/book-card-size.css", import.meta.url), "utf8");
const shelfStyles = fs.readFileSync(new URL("../src/components/home/dashboard-main.css", import.meta.url), "utf8");
assert.ok(cardSizes.includes("--book-card-height: 310px"));
assert.ok(shelfStyles.includes("--ds-width: var(--book-card-width); --ds-height: var(--book-card-height)"));
console.log("Dashboard shelf tests passed.");
