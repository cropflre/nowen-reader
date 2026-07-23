import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const listeners = new Map();
const deletedCaches = [];

const cacheNames = [
  "nowen-reader-_reader-v3",
  "nowen-reader-_reader-v4",
  "nowen-static-_reader-v4",
  "nowen-images-_reader-v6",
  "nowen-api-_reader-v3",
  "nowen-reader-root-v4",
  "another-application-cache",
];

const sandbox = {
  URL,
  console,
  self: {
    registration: { scope: "https://example.com/reader/" },
    clients: { claim() {} },
    skipWaiting() {},
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
  },
  caches: {
    async keys() {
      return cacheNames;
    },
    async delete(name) {
      deletedCaches.push(name);
      return true;
    },
    async open() {
      return {
        async addAll() {},
        async keys() {
          return [];
        },
        async delete() {
          return true;
        },
      };
    },
    async match() {
      return undefined;
    },
  },
  fetch: async () => {
    throw new Error("network not expected in cache isolation tests");
  },
};

vm.runInNewContext(source, sandbox, { filename: "sw.js" });

let activation;
listeners.get("activate")({
  waitUntil(promise) {
    activation = promise;
  },
});
await activation;

assert.deepEqual(deletedCaches, ["nowen-reader-_reader-v3"]);

deletedCaches.length = 0;
let clearing;
listeners.get("message")({
  data: { type: "CLEAR_CACHE" },
  waitUntil(promise) {
    clearing = promise;
  },
});
await clearing;

assert.deepEqual(
  deletedCaches.sort(),
  [
    "nowen-api-_reader-v3",
    "nowen-images-_reader-v6",
    "nowen-reader-_reader-v4",
    "nowen-static-_reader-v4",
  ],
);
assert.ok(!deletedCaches.includes("nowen-reader-root-v4"));
assert.ok(!deletedCaches.includes("another-application-cache"));

console.log("Service Worker cache isolation tests passed.");
