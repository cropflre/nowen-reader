import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/lib/base-path.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;

let metaContent = "";
const module = { exports: {} };
const sandbox = {
  module,
  exports: module.exports,
  document: {
    querySelector(selector) {
      if (selector !== 'meta[name="nowen-base-path"]') return null;
      return {
        getAttribute(name) {
          return name === "content" ? metaContent : null;
        },
      };
    },
  },
  window: {},
};

vm.runInNewContext(compiled, sandbox, { filename: "base-path.ts" });

const {
  normalizeBasePath,
  getBasePath,
  appPath,
  apiPath,
  stripBasePath,
} = module.exports;

assert.equal(normalizeBasePath(""), "");
assert.equal(normalizeBasePath("/"), "");
assert.equal(normalizeBasePath("reader"), "/reader");
assert.equal(normalizeBasePath("/reader/"), "/reader");

metaContent = "";
assert.equal(getBasePath(), "");
assert.equal(appPath("/books"), "/books");
assert.equal(apiPath("/api/comics?page=1"), "/api/comics?page=1");

metaContent = "/reader/";
assert.equal(getBasePath(), "/reader");
assert.equal(appPath("/books"), "/reader/books");
assert.equal(appPath("/reader/books"), "/reader/books");
assert.equal(apiPath("/comics"), "/reader/api/comics");
assert.equal(apiPath("/api/comics?page=1"), "/reader/api/comics?page=1");
assert.equal(apiPath("/reader/api/comics"), "/reader/api/comics");
assert.equal(apiPath("https://cdn.example/image.jpg"), "https://cdn.example/image.jpg");
assert.equal(apiPath("blob:example"), "blob:example");
assert.equal(stripBasePath("/reader/books"), "/books");
assert.equal(stripBasePath("/outside"), "/outside");

console.log("Base Path helper tests passed.");
