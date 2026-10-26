import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Exercise the page's actual query state, fetch effect, and pagination controls.
const source = fs.readFileSync(new URL("../src/app/books/page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("books.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const expressions = {};
let fetchEffect, persistEffect, previousClick, nextClick;
function visit(node) {
  if (ts.isVariableDeclaration(node)) {
    const name = node.name.getText(ast);
    if (["directoryQueryKey", "directoryPage", "directoryListing"].includes(name)) {
      expressions[name] = node.initializer.getText(ast);
    }
    if (ts.isArrayBindingPattern(node.name) && node.name.elements[0]?.name?.getText(ast) === "directoryPagination") {
      expressions.initializer = node.initializer.arguments[0].getText(ast);
    }
  }
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect") {
    const callback = node.arguments[0].getText(ast);
    if (callback.includes("fetchLibraryDirectories(targetLibId")) fetchEffect = callback;
    if (callback.includes('sessionStorage.setItem("homeFilter:directoryPagination"')) persistEffect = callback;
  }
  if (ts.isJsxAttribute(node) && node.name.getText(ast) === "onClick") {
    const callback = node.initializer?.expression?.getText(ast) || "";
    if (callback.includes("page: directoryPage - 1")) previousClick = callback;
    if (callback.includes("page: directoryPage + 1")) nextClick = callback;
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(fetchEffect && persistEffect && previousClick && nextClick && expressions.initializer);
const compile = (code) => ts.transpileModule(code, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const requests = [];
const storage = new Map();
const context = vm.createContext({
  JSON, Number, Math, AbortController,
  user: { id: "alice" }, activeDirectoryLibraryId: "library-a",
  effectiveDirectoryPath: "", activeSingleLibrary: { id: "library-a" },
  accessibleLibrariesLoaded: true, supportsDirectoryNav: true,
  directoryListingResult: null, directoryLoading: false,
  sessionStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  },
  getCachedLibraryDirectories: () => null,
  fetchLibraryDirectories: (libraryId, options) => new Promise((resolve, reject) => {
    requests.push({ libraryId, options, resolve, reject });
  }),
  LibraryApiError: class extends Error {},
  setDirectoryListingKey: (value) => { context.directoryListingKey = value; },
  setDirectoryListing: (value) => { context.directoryListingResult = value; },
  setDirectoryLoading: (value) => { context.directoryLoading = value; },
  setDirectoryPagination: (value) => { context.directoryPagination = value; },
  setDirectoryPath: (value) => { context.effectiveDirectoryPath = value; },
});
const run = (code) => vm.runInContext(compile(code), context);
context.directoryPagination = run(`(${expressions.initializer})()`);
context.directoryListingKey = run(`(${expressions.directoryQueryKey})`);
function snapshot() {
  for (const name of ["directoryQueryKey", "directoryPage", "directoryListing"]) {
    context[name] = run(`(${expressions[name]})`);
  }
}
let cleanup;
function fetchPage() {
  cleanup?.();
  snapshot();
  // Each effect retains its render's bindings, as it does inside React.
  context.inputs = { ...context };
  cleanup = run(`(({ supportsDirectoryNav, activeSingleLibrary, accessibleLibrariesLoaded,
    effectiveDirectoryPath, directoryPage, directoryQueryKey }) => (${fetchEffect})())(inputs)`);
}
const tick = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); snapshot(); };
function respond(request, total = 101) {
  const { page, parent } = request.options;
  request.resolve({
    libraryId: request.libraryId, parent, breadcrumbs: [],
    page, pageSize: 100, total, totalPages: Math.ceil(total / 100),
    directories: Array.from({ length: Math.max(0, Math.min(100, total - (page - 1) * 100)) }, (_, i) => ({
      path: `category-${(page - 1) * 100 + i + 1}`,
    })),
  });
}

fetchPage();
assert.equal(requests.at(-1).options.page, 1);
respond(requests.at(-1)); await tick();
assert.equal(context.directoryListing.directories.length, 100);
run(`(${nextClick})()`); fetchPage();
assert.equal(requests.at(-1).options.page, 2, "Next control requests categories after 100");
assert.equal(context.directoryListing, null, "A different page must not display the old page's categories");
respond(requests.at(-1)); await tick();
assert.equal(context.directoryListing.directories[0].path, "category-101");
run(`(${persistEffect})()`);
context.directoryPagination = run(`(${expressions.initializer})()`); snapshot();
assert.equal(context.directoryPage, 2, "Reader return restores the directory page");
run(`(${previousClick})()`); fetchPage();
assert.equal(requests.at(-1).options.page, 1);
respond(requests.at(-1)); await tick();

run(`(${nextClick})()`); fetchPage();
const stale = requests.at(-1);
context.effectiveDirectoryPath = "child"; fetchPage();
assert.equal(context.directoryPage, 1, "Entering another directory starts its pagination at one");
assert.equal(context.directoryListing, null);
respond(requests.at(-1), 1); await tick();
respond(stale); await tick();
assert.equal(context.directoryListing.parent, "child", "Aborted old directory requests cannot overwrite a new directory");
context.activeDirectoryLibraryId = "library-b";
context.activeSingleLibrary = { id: "library-b" };
context.effectiveDirectoryPath = ""; fetchPage();
assert.equal(context.directoryPage, 1, "Changing library starts at one");
respond(requests.at(-1)); await tick();
run(`(${nextClick})()`); fetchPage();
respond(requests.at(-1), 50); await tick();
assert.equal(context.directoryPage, 1, "A shortened directory list clamps an obsolete page");
fetchPage(); respond(requests.at(-1), 50); await tick();
assert.equal(context.directoryListing.directories.length, 50);
context.user = { id: "bob" }; snapshot();
assert.equal(context.directoryPage, 1, "Page selection is scoped to the account");
assert.equal(context.directoryListing, null, "Another account cannot briefly display the previous account's directory response");
cleanup?.();

for (const invalid of ["broken", '{"key":1,"page":2}', '{"key":"x","page":0}', '{"key":"x","page":1.5}']) {
  storage.set("homeFilter:directoryPagination", invalid);
  assert.equal(run(`(${expressions.initializer})()`), null);
}
console.log("Directory pagination, reader return, stale requests, and page clamping tests passed.");
