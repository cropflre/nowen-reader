import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import * as icons from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";

const source = ts.transpileModule(fs.readFileSync(new URL("../src/components/home/LibraryTabsBar.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
function loadComponent(react = React) {
  const dependencies = { react, "react/jsx-runtime": jsxRuntime, "lucide-react": icons };
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, exports: module.exports,
    require(name) { assert.ok(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name]; },
  });
  return module.exports.LibraryTabsBar;
}
const LibraryTabsBar = loadComponent();
const library = (id, name, count = 0) => ({ id, name, type: "mixed", comicCount: count });
const render = (libraries, selectedIds = []) => renderToStaticMarkup(React.createElement(LibraryTabsBar, { libraries, selectedIds, onChange() {} }));
const labels = (html) => [...html.matchAll(/<span class="truncate max-w-\[120px\]">(.*?)<\/span>/g)].map((match) => match[1]);
assert.equal(render([]), "");
assert.deepEqual(labels(render([library("default", "Default Library", 12)])), ["全部", "Default Library"]);
const libraries = [library("a", "18x", 8), library("b", "小说", 6), library("c", "漫画", 5), library("empty", "空书库")];
assert.deepEqual(labels(render(libraries)), ["全部", ...libraries.map((item) => item.name)]);
assert.equal((render(libraries, ["b"]).match(/aria-selected="true"/g) || []).length, 1);
assert.equal((render(libraries, ["b", "c"]).match(/aria-selected="true"/g) || []).length, 2);
assert.deepEqual(labels(render([{ ...libraries[1], name: "我的小说库" }], ["b"])), ["全部", "我的小说库"]);
const many = Array.from({ length: 20 }, (_, index) => library(String(index), `书库${index + 1}`));
assert.equal(labels(render(many)).length, many.length + 1);
assert.ok(render(many).includes("overflow-x-auto"));

let selected = [];
const InteractiveBar = loadComponent({
  ...React, useState: (initial) => [initial, () => {}], useRef: (initial) => ({ current: initial }),
  useEffect() {}, useCallback: (callback) => callback,
});
const nodes = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const chips = () => nodes(InteractiveBar({ libraries, selectedIds: selected, onChange(ids) { selected = Array.from(ids); } }))
  .filter((node) => node.type?.name === "LibraryChip");
chips()[2].props.onClick();
assert.deepEqual(selected, ["b"]);
chips()[0].props.onClick();
assert.deepEqual(selected, []);

const bar = nodes(InteractiveBar({ libraries, selectedIds: [], onChange() {} })).find((node) => node.props?.role === "tablist");
let focused = -1;
const tabElements = Array.from({ length: libraries.length + 1 }, (_, index) => ({ focus() { focused = index; }, scrollIntoView() {} }));
const press = (key, index = focused < 0 ? 0 : focused) => bar.props.onKeyDown({ key, target: tabElements[index], currentTarget: { querySelectorAll: () => tabElements }, preventDefault() {} });
press("ArrowRight"); assert.equal(focused, 1);
press("End"); assert.equal(focused, libraries.length);
press("ArrowRight"); assert.equal(focused, 0);
press("ArrowLeft"); assert.equal(focused, libraries.length);
press("Home"); assert.equal(focused, 0);

const booksSource = fs.readFileSync(new URL("../src/app/books/page.tsx", import.meta.url), "utf8");
assert.ok(booksSource.includes("libraries={accessibleLibraries}"));
assert.ok(!booksSource.includes("LibraryContentTabs"));
assert.ok(!booksSource.includes("homeFilter:contentType"), "Saved fixed-type filters must not hide books after the tabs are removed");
assert.ok(booksSource.includes("secondaryNavigation={accessibleLibraries.length > 0 ? ("));
assert.equal((booksSource.match(/<LibraryTabsBar/g) || []).length, 1, "One dynamic library tab bar belongs in the header");
assert.ok(booksSource.includes('window.addEventListener("storage", handleStorage)'));
assert.ok(booksSource.includes('const favoritesOnly = favoritesView;'));
assert.ok(booksSource.includes('favoritesView ? "favoritesPage" : "homePage"'));
assert.ok(booksSource.includes('const libraryIsEmpty = apiTotal === 0 && !favoritesOnly && !hasActiveFilters;'));
assert.ok(booksSource.includes(') : libraryIsEmpty ? ('));
const routes = fs.readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
assert.ok(routes.includes('<Route path="favorites" element={<BooksPage favoritesView />} />'));
let notifications = 0;
let failRequest = false;
const apiModule = { exports: {} };
const apiSource = ts.transpileModule(fs.readFileSync(new URL("../src/api/libraries.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
vm.runInNewContext(apiSource, {
  module: apiModule, exports: apiModule.exports,
  fetch: async () => ({ ok: !failRequest, status: failRequest ? 400 : 200, json: async () => failRequest ? { error: "Failed" } : { library: libraries[0], success: true } }),
  require(name) {
    if (name === "@/lib/base-path") return { apiPath: (path) => path };
    if (name === "@/hooks/useComicList") return { notifyLibraryAccessChanged() { notifications++; } };
    assert.fail(`Unexpected dependency: ${name}`);
  },
});
await apiModule.exports.createLibrary({ name: "新书库", type: "mixed" });
await apiModule.exports.updateLibrary("a", { name: "重命名书库" });
await apiModule.exports.deleteLibrary("a");
assert.equal(notifications, 3, "Successful create, rename, and delete operations must refresh library tabs");
failRequest = true;
await assert.rejects(() => apiModule.exports.updateLibrary("a", { name: "失败更新" }));
assert.equal(notifications, 3);
console.log("Dynamic header tabs, keyboard navigation, library selection, shared favorites, and library-change notifications passed.");
