import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function loadModule(path, dependencies = {}) {
  const source = ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, exports: module.exports,
    require(name) { assert.ok(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name]; },
  });
  return module.exports;
}

const { libraryCardState } = loadModule("../src/lib/library-card.ts", {
  "@/lib/progress": loadModule("../src/lib/progress.ts"),
  "@/lib/comic-utils": loadModule("../src/lib/comic-utils.ts"),
  "@/lib/series-id": loadModule("../src/lib/series-id.ts"),
});
const book = { id: "book", title: "Book", coverUrl: "cover.jpg", tags: [], filename: "Book.CBZ", pageCount: 4, lastReadPage: 0 };
let state = libraryCardState(book);
assert.equal(state.started, false);
assert.equal(state.finished, false);
assert.equal(state.progress, 0);
assert.equal(state.unit, "page");
assert.equal(state.format, "CBZ");
assert.equal(state.readerUrl, "/reader/book");
assert.equal(state.detailUrl, "/comic/book");
assert.equal(libraryCardState({ ...book, lastReadAt: "2026-10-07" }).progress, 25);
assert.equal(libraryCardState({ ...book, lastReadPage: 3 }).finished, true);
assert.equal(libraryCardState({ ...book, readingStatus: "finished", pageCount: 0 }).progress, 100);
assert.equal(libraryCardState({ ...book, pageCount: 1 }).finished, false);
assert.equal(libraryCardState({ ...book, pageCount: 1, lastReadAt: "2026-10-07" }).finished, true);
assert.equal(libraryCardState({ ...book, pageCount: 0, lastReadAt: "2026-10-07" }).showProgress, false);
assert.equal(libraryCardState({ ...book, pageCount: -1 }).total, 0);
assert.equal(libraryCardState({ ...book, filename: "Book.EPUB" }).unit, "chapter");
assert.equal(libraryCardState({ ...book, filename: "Book.epub" }).readerUrl, "/novel/book");
assert.equal(libraryCardState({ ...book, filename: "Book.mobi", type: "comic" }).unit, "page");
assert.equal(libraryCardState({ ...book, filename: "Book.cbz", type: "novel" }).readerUrl, "/novel/book");
assert.equal(libraryCardState({ ...book, filename: undefined }).format, "BOOK");

const series = { ...book, id: "series-work", filename: "__series__.cbz" };
state = libraryCardState(series);
assert.equal(state.seriesId, "work");
assert.equal(state.readerUrl, "/series/work");
assert.equal(state.detailUrl, "/series/work");
assert.equal(state.unit, "item");
assert.equal(state.format, "");
assert.equal(state.progress, 0);
assert.equal(state.finished, false);
assert.equal(libraryCardState({ ...series, lastReadPage: 1 }).progress, 25);
assert.equal(libraryCardState({ ...series, lastReadPage: 3 }).progress, 75);
assert.equal(libraryCardState({ ...series, lastReadPage: 3 }).finished, false);
assert.equal(libraryCardState({ ...series, lastReadPage: 4 }).finished, true);
assert.equal(libraryCardState({ ...series, lastReadPage: 99 }).progress, 100);
assert.equal(libraryCardState({ ...series, lastReadPage: -2 }).progress, 0);
assert.equal(libraryCardState({ ...series, pageCount: 1 }).finished, false);
assert.equal(libraryCardState({ ...series, readingStatus: "finished" }).progress, 100);
const cardStyles = fs.readFileSync(new URL("../src/components/library-book-card.css", import.meta.url), "utf8");
assert.ok(cardStyles.includes("var(--book-card-width)"), "Library columns share the continuing-reading card width");
assert.ok(cardStyles.includes("height: var(--book-card-height)"), "Library cards share the continuing-reading card height");
console.log("Library card tests passed.");
