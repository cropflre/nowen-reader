import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createMemoryRouter } from "react-router-dom";

function compile(source) {
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
}

// Exercise the navigation shim against React Router's real history stack.
const navigationSource = fs.readFileSync(new URL("../src/shims/next/navigation.ts", import.meta.url), "utf8");
for (const origin of ["/books?page=2", "/favorites?page=3", "/group/7", "/comic/book-a", "/"]) {
  const history = createMemoryRouter([{ path: "*", element: null }], {
    initialEntries: [origin, "/reader/book-a"], initialIndex: 1,
  });
  let pending;
  const module = { exports: {} };
  const window = { history: { state: { idx: 1 } } };
  vm.runInNewContext(compile(navigationSource), {
    module, exports: module.exports, window,
    require: () => ({ useNavigate: () => (path, options) => { pending = history.navigate(path, options); } }),
  });
  const router = module.exports.useRouter();
  // Automatic next-volume and comic-to-novel redirects replace the reader entry.
  router.replace("/reader/book-b");
  await pending;
  router.replace("/novel/book-b");
  await pending;
  router.back("/books");
  await pending;
  assert.equal(history.state.location.pathname + history.state.location.search, origin);
  history.dispose();
}

for (const state of [{ idx: 0 }, null]) {
  const history = createMemoryRouter([{ path: "*", element: null }], { initialEntries: ["/reader/book-a"] });
  let pending;
  const module = { exports: {} };
  vm.runInNewContext(compile(navigationSource), {
    module, exports: module.exports, window: { history: { state } },
    require: () => ({ useNavigate: () => (path, options) => { pending = history.navigate(path, options); } }),
  });
  module.exports.useRouter().back("/books");
  await pending;
  assert.equal(history.state.location.pathname, "/books");
  await history.navigate(-1);
  assert.equal(history.state.location.pathname, "/books", "Fallback replaces the directly opened reader");
  history.dispose();
}

// Run the actual page initializer and URL-sync effects without loading the whole UI.
const booksSource = fs.readFileSync(new URL("../src/app/books/page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("books.tsx", booksSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let pageInitializer;
let searchEffect;
let pageEffect;
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name)
      && node.name.elements[0]?.name?.getText(ast) === "currentPage") {
    pageInitializer = node.initializer.arguments[0].getText(ast);
  }
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect") {
    const callback = node.arguments[0].getText(ast);
    if (callback.includes("history.replaceState")) {
      if (callback.includes('params.set("page"')) pageEffect = callback;
      else searchEffect = callback;
    }
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(pageInitializer && pageEffect && searchEffect);

function makePage(url, savedPage = "18", favoritesView = false) {
  const location = new URL(url, "http://localhost");
  const key = favoritesView ? "favoritesPage" : "homePage";
  const storage = new Map([[key, savedPage]]);
  const state = { idx: 4, key: "list-entry", usr: { previous: "kept" } };
  const history = {
    state,
    replaceState(next, _title, href) {
      this.state = next;
      location.href = new URL(href, location).href;
    },
  };
  const context = vm.createContext({
    URLSearchParams, window: { location, history }, favoritesView,
    sessionStorage: {
      getItem: (name) => storage.get(name) ?? null,
      setItem: (name, value) => storage.set(name, value),
      removeItem: (name) => storage.delete(name),
    },
  });
  context.currentPage = vm.runInContext(compile(`(${pageInitializer})()`), context);
  context.searchQuery = location.searchParams.get("search") || "";
  return { context, location, history, state, storage, key };
}

for (const favorites of [false, true]) {
  const page = makePage(`/nas/${favorites ? "favorites" : "books"}?page=2&search=test#list`, "18", favorites);
  assert.equal(page.context.currentPage, 2, "Return URL takes precedence over stale stored page");
  vm.runInContext(compile(`(${searchEffect})()`), page.context);
  vm.runInContext(compile(`(${pageEffect})()`), page.context);
  assert.equal(page.history.state, page.state, "URL sync preserves the router history index and state");
  assert.equal(page.location.pathname, favorites ? "/nas/favorites" : "/nas/books");
  assert.equal(page.location.searchParams.get("page"), "2");
  assert.equal(page.location.hash, "#list");
  assert.equal(page.storage.get(page.key), "2");
  page.context.currentPage = 1;
  vm.runInContext(compile(`(${pageEffect})()`), page.context);
  assert.equal(page.location.searchParams.has("page"), false);
  assert.equal(page.storage.has(page.key), false, "Page one clears the previous stored page immediately");
}
assert.equal(makePage("/books").context.currentPage, 18);
assert.equal(makePage("/books?search=new").context.currentPage, 1);
for (const invalid of ["0", "-1", "NaN", "1.5"]) {
  assert.equal(makePage(`/books?page=${invalid}`).context.currentPage, 1);
}
console.log("Reader return history, direct-entry fallback, and list pagination restoration tests passed.");
