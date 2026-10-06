import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";

const source = ts.transpileModule(fs.readFileSync(new URL("../src/components/LibraryContentTabs.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
let focused = -1;
let selected = "all";
const dependencies = {
  react: { ...React, useRef: () => ({ current: [0, 1, 2].map((index) => ({ focus() { focused = index; } })) }) },
  "react/jsx-runtime": jsxRuntime,
  "@/lib/i18n": { useTranslation: () => ({ contentTab: { all: "全部", novel: "小说", comic: "漫画" } }) },
  "./library-content-tabs.css": {},
};
const module = { exports: {} };
vm.runInNewContext(source, {
  module, exports: module.exports,
  require(name) { assert.ok(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name]; },
});
const tree = (value = selected) => module.exports.default({ value, onChange(next) { selected = next; } });
for (const type of ["all", "novel", "comic"]) {
  const html = renderToStaticMarkup(tree(type));
  assert.ok(html.includes('role="tablist" aria-label="内容分类"'));
  assert.equal((html.match(/role="tab"/g) || []).length, 3);
  assert.equal((html.match(/aria-selected="true"/g) || []).length, 1);
  assert.match(html, new RegExp(`id="library-content-tab-${type}"[^>]*aria-selected="true"[^>]*tabindex="0"`));
  assert.equal((html.match(/aria-controls="library-content-panel"/g) || []).length, 3);
}
let prevented = false;
const press = (key) => tree().props.onKeyDown({ key, preventDefault() { prevented = true; } });
press("ArrowRight");
assert.equal(selected, "novel"); assert.equal(focused, 1); assert.ok(prevented);
press("ArrowLeft"); assert.equal(selected, "all");
press("ArrowLeft"); assert.equal(selected, "comic"); assert.equal(focused, 2);
press("Home"); assert.equal(selected, "all");
press("End"); assert.equal(selected, "comic");
prevented = false; press("Tab"); assert.ok(!prevented); assert.equal(selected, "comic");
tree().props.children[1].props.onClick(); assert.equal(selected, "novel");

const booksSource = fs.readFileSync(new URL("../src/app/books/page.tsx", import.meta.url), "utf8");
assert.ok(booksSource.includes('contentType: contentType === "all" ? undefined : contentType'));
assert.ok(booksSource.includes('const favoritesOnly = favoritesView;'));
assert.ok(!booksSource.includes('setFavoritesOnly'));
assert.ok(booksSource.includes('secondaryNavigation={<LibraryContentTabs'));
assert.ok(booksSource.includes('favoritesView ? "favoritesPage" : "homePage"'));
assert.ok(booksSource.includes('const libraryIsEmpty = apiTotal === 0 && !favoritesOnly && !hasActiveFilters;'));
assert.ok(booksSource.includes(') : libraryIsEmpty ? ('));
const routes = fs.readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
assert.ok(routes.includes('<Route path="favorites" element={<BooksPage favoritesView />} />'));
console.log("Library classification, keyboard navigation, favorite-module, and filter wiring tests passed.");
