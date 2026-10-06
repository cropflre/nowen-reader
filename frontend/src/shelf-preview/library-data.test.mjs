import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function loadModule(url, dependencies = {}) {
  const source = fs.readFileSync(url, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    require(name) {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  }, { filename: url.pathname });
  return module.exports;
}

const progress = loadModule(new URL("../lib/progress.ts", import.meta.url));
const model = loadModule(new URL("./library-data.ts", import.meta.url), { "@/lib/progress": progress });
const { initialBooks, selectDashboardBooks, withReadingPage, bookStarted, bookFinished, bookProgress, bookPage, bookFormat, bookUnit } = model;
const all = selectDashboardBooks(initialBooks, "all");
assert.equal(all.visible.length, 12);
assert.equal(all.readingCount, 7);
assert.equal(all.unread, 2);
assert.equal(all.finished, 3);
assert.equal(all.recent.length, 6);
assert.ok(all.reading.every((book) => bookStarted(book) && !bookFinished(book)));
assert.ok(all.reading.every((book, index) => !index || Date.parse(all.reading[index - 1].lastReadAt) >= Date.parse(book.lastReadAt)));
assert.ok(all.recent.every((book, index) => !index || Date.parse(all.recent[index - 1].addedAt) >= Date.parse(book.addedAt)));

const comics = selectDashboardBooks(initialBooks, "comic");
const novels = selectDashboardBooks(initialBooks, "novel");
assert.equal(comics.visible.length, 7);
assert.equal(novels.visible.length, 5);
assert.equal(comics.readingCount, 4);
assert.equal(novels.readingCount, 3);
assert.ok(comics.recent.every((book) => book.type === "comic"));
assert.ok(novels.reading.every((book) => book.type === "novel"));
assert.equal(bookUnit(comics.visible[0]), "页");
assert.equal(bookFormat(comics.visible[0]), "CBZ");
assert.equal(bookUnit(novels.visible[0]), "章");
assert.equal(bookFormat(novels.visible[0]), "EPUB");

const unread = initialBooks.find((book) => !bookStarted(book));
assert.equal(bookProgress(unread), 0);
const firstPage = withReadingPage(unread, 1);
assert.equal(firstPage.lastReadPage, 0);
assert.equal(bookPage(firstPage), 1);
assert.equal(bookStarted(firstPage), true);
assert.equal(bookFinished(firstPage), false);
assert.equal(bookProgress(firstPage), Math.round(100 / firstPage.pageCount));
assert.equal(bookFinished(withReadingPage(unread, unread.pageCount)), true);
assert.equal(bookProgress(withReadingPage(unread, unread.pageCount + 500)), 100);
assert.equal(withReadingPage(unread, unread.pageCount + 500).lastReadPage, unread.pageCount - 1);
const reset = withReadingPage(firstPage, 0);
assert.equal(reset.lastReadPage, 0);
assert.equal(reset.lastReadAt, null);
assert.equal(bookStarted(reset), false);
assert.equal(bookProgress(reset), 0);
assert.equal(bookPage(withReadingPage(firstPage, -20)), 0);

const everyBookReading = initialBooks.map((book) => withReadingPage(book, 1));
const fullReadingList = selectDashboardBooks(everyBookReading, "all");
assert.equal(fullReadingList.readingCount, 12);
assert.equal(fullReadingList.reading.length, 8);
assert.equal(selectDashboardBooks(initialBooks.map((book) => withReadingPage(book, 0)), "all").reading.length, 0);
assert.equal(selectDashboardBooks(initialBooks.map((book) => withReadingPage(book, book.pageCount)), "all").readingCount, 0);
console.log("Project dashboard model tests passed.");
