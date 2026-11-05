import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(compile(fs.readFileSync(new URL("../src/lib/tag-navigation.ts", import.meta.url), "utf8")), {
  module, exports: module.exports, URLSearchParams,
});
const { tagFilterHref, readTagFilters } = module.exports;
for (const name of ["中文:奇幻", "female:example", "A & B + C", "日本語/#?%"] ) {
  assert.deepEqual(Array.from(readTagFilters(new URL(tagFilterHref(name), "https://reader.invalid").search)), [name]);
}
assert.equal(readTagFilters("?page=2"), null);
assert.deepEqual(Array.from(readTagFilters("?tags=")), []);
assert.deepEqual(Array.from(readTagFilters("?tags=Action,Fantasy&tags=Action")), ["Action", "Fantasy"]);

// Execute the production initializers/effect with realistic stale browsing state.
const source = fs.readFileSync(new URL("../src/app/books/page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("books.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const initializers = new Map();
let tagEffect;
let scrollEffect;
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name)
    && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(ast) === "useState") {
    initializers.set(node.name.elements[0].name.getText(ast), node.initializer.arguments[0].getText(ast));
  }
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect"
    && node.arguments[1]?.getText(ast) === "[selectedTags]") tagEffect = node.arguments[0].getText(ast);
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect"
    && node.arguments[0]?.getText(ast).includes("scrollRestoredRef.current")) scrollEffect = node.arguments[0].getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
function mount(url) {
  const location = new URL(url, "http://localhost");
  const storage = new Map(Object.entries({
    homeScrollY: "999", homePage: "18", "homeFilter:tags": '["Old"]', "homeFilter:search": "old title",
    "homeFilter:category": "old-category", "homeFilter:readingStatus": "finished",
    "homeFilter:untagged": "true", "homeFilter:uncategorized": "true",
    "homeFilter:dir": "old-dir", "homeFilter:dirLibId": "old-library",
  }));
  const historyState = { idx: 4, key: "entry" };
  const history = { state: historyState, replaceState(state, _, href) {
    this.state = state; location.href = new URL(href, location).href;
  } };
  const scrolls = [];
  const context = vm.createContext({
    readTagFilters, URLSearchParams, favoritesView: false,
    window: { location, history, scrollTo: (x, y) => scrolls.push([x, y]) },
    loading: false, scrollRestoredRef: { current: false }, requestAnimationFrame: (fn) => fn(),
    readStringArrayFromLocalStorage: () => ["old-library"],
    sessionStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
  });
  for (const name of ["initialTags", "searchQuery", "selectedTags", "selectedLibraryIds", "directoryPath",
    "directoryLibraryHint", "selectedCategory", "readingStatusFilter", "uncategorized", "untagged", "currentPage"]) {
    context[name] = vm.runInContext(compile(`(${initializers.get(name)})()`), context);
  }
  return { context, storage, location, history, historyState, scrolls };
}
const direct = mount("/books?tags=中文%3A奇幻");
assert.deepEqual(Array.from(direct.context.selectedTags), ["中文:奇幻"]);
assert.equal(direct.context.currentPage, 1, "A tag link must not restore page 18");
for (const key of ["searchQuery", "directoryPath", "directoryLibraryHint", "readingStatusFilter"]) assert.equal(direct.context[key], "");
assert.equal(direct.context.selectedCategory, null);
assert.equal(direct.context.untagged, false);
assert.equal(direct.context.uncategorized, false);
assert.deepEqual(Array.from(direct.context.selectedLibraryIds), []);
const explicit = mount("/books?tags=Action&tags=Fantasy&page=3&lib=chosen&dir=sub&search=title#shelf");
assert.equal(explicit.context.currentPage, 3);
assert.equal(explicit.context.searchQuery, "title");
assert.equal(explicit.context.directoryPath, "sub");
assert.deepEqual(Array.from(explicit.context.selectedLibraryIds), ["chosen"]);
explicit.context.selectedTags = ["中文:奇幻", "A & B + C"];
vm.runInContext(compile(`(${tagEffect})()`), explicit.context);
assert.deepEqual(explicit.location.searchParams.getAll("tags"), explicit.context.selectedTags);
assert.equal(explicit.location.searchParams.get("page"), "3");
assert.equal(explicit.location.searchParams.get("lib"), "chosen");
assert.equal(explicit.location.hash, "#shelf");
assert.equal(explicit.history.state, explicit.historyState);
assert.deepEqual(JSON.parse(explicit.storage.get("homeFilter:tags")), explicit.context.selectedTags);
explicit.context.selectedTags = [];
vm.runInContext(compile(`(${tagEffect})()`), explicit.context);
assert.equal(explicit.location.searchParams.has("tags"), false);
vm.runInContext(compile(`(${scrollEffect})()`), direct.context);
assert.deepEqual(direct.scrolls, [[0, 0]], "Tag navigation scrolls to the start instead of restoring the old shelf position");
vm.runInContext(compile(`(${scrollEffect})()`), explicit.context);
assert.deepEqual(explicit.scrolls, [[0, 999]], "Explicit page return URLs retain scroll restoration");
const restored = mount("/books");
assert.equal(restored.context.currentPage, 18);
assert.equal(restored.context.searchQuery, "old title");
assert.equal(restored.context.untagged, true);
assert.deepEqual(Array.from(restored.context.selectedTags), ["Old"]);
console.log("Tag links, URL sharing, stale filter resets, and history preservation tests passed.");
