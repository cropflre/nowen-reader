import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Execute the real hook with controlled effects/network/time. Each mount has
// its own React state; the module cache survives navigation between mounts.
let active;
const sameDeps = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const react = {
  useState(initial) {
    const owner = active, i = owner.cursor++;
    if (!owner.slots[i]) owner.slots[i] = { value: typeof initial === "function" ? initial() : initial };
    return [owner.slots[i].value, (value) => { owner.slots[i].value = typeof value === "function" ? value(owner.slots[i].value) : value; }];
  },
  useRef(initial) { const owner = active, i = owner.cursor++; return owner.slots[i] ??= { current: initial }; },
  useCallback(fn, deps) {
    const owner = active, i = owner.cursor++;
    if (!sameDeps(owner.slots[i]?.deps, deps)) owner.slots[i] = { fn, deps };
    return owner.slots[i].fn;
  },
  useEffect(fn, deps) {
    const owner = active, i = owner.cursor++;
    if (!sameDeps(owner.slots[i]?.deps, deps)) {
      owner.slots[i]?.cleanup?.();
      owner.slots[i] = { deps };
      owner.effects.push(() => { owner.slots[i].cleanup = fn(); });
    }
  },
};
let now = 1000;
const requests = [];
const window = new EventTarget();
window.localStorage = { setItem() {} };
const module = { exports: {} };
const source = ts.transpileModule(fs.readFileSync(new URL("../src/hooks/useComicList.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
vm.runInNewContext(source, {
  module, exports: module.exports, URLSearchParams, AbortController, Error, Event, CustomEvent, window,
  Date: { now: () => now },
  fetch(url, options) { return new Promise((resolve, reject) => { requests.push({ url, options, resolve, reject }); }); },
  require(name) { if (name === "react") return react; if (name === "@/lib/base-path") return { apiPath: (p) => p }; throw Error(name); },
});
const api = module.exports;
function mount(options = { page: 3, pageSize: 24, seriesView: true }) {
  const owner = { slots: [], effects: [], cursor: 0 };
  return {
    snapshot() { active = owner; owner.cursor = 0; const result = api.useComics(options); owner.effects.splice(0).forEach((effect) => effect()); return result; },
    unmount() { owner.slots.forEach((slot) => slot?.cleanup?.()); },
  };
}
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const response = (id, progress = 0) => ({ ok: true, json: async () => ({ comics: [{ id, lastReadPage: progress }], total: 60, totalPages: 3 }) });
api.setUserScope("alice", "user");
const first = mount();
assert.equal(first.snapshot().loading, true);
requests.at(-1).resolve(response("book"));
await tick();
assert.equal(first.snapshot().comics[0].id, "book");
first.unmount();
now += 5 * 60_000; // A realistic reading session outlives the former 30s cache.
const returned = mount();
returned.snapshot();
let state = returned.snapshot();
assert.equal(state.loading, false, "Reading return renders cached data before the network responds");
assert.equal(state.fetching, true);
assert.equal(state.comics[0].lastReadPage, 0);
requests.at(-1).resolve(response("book", 8));
await tick();
assert.equal(returned.snapshot().comics[0].lastReadPage, 8, "Progress refreshes in the background");
returned.unmount();
const offline = mount(); offline.snapshot();
requests.at(-1).reject(new Error("offline")); await tick();
assert.equal(offline.snapshot().comics[0].id, "book", "Temporary network failure retains the usable shelf");
assert.equal(offline.snapshot().error, null);
offline.unmount();
const denied = mount(); denied.snapshot();
requests.at(-1).resolve({ ok: false, status: 403, json: async () => ({ error: "Denied" }) }); await tick();
assert.equal(denied.snapshot().comics.length, 0, "Revoked access clears stale results");
assert.equal(denied.snapshot().error, "Denied");
denied.unmount();
const pending = mount(); pending.snapshot(); const oldRequest = requests.at(-1);
api.setUserScope("bob", "user");
oldRequest.resolve(response("alice-private")); await tick();
assert.equal(pending.snapshot().comics.length, 0, "Late responses cannot cross an account change");
pending.unmount();
const bob = mount(); bob.snapshot();
assert.equal(bob.snapshot().loading, true);
requests.at(-1).resolve(response("bob-book")); await tick(); bob.unmount();
now += 16 * 60_000;
const expired = mount(); expired.snapshot();
assert.equal(expired.snapshot().loading, true, "Cache retention is bounded"); expired.unmount();

// Directory-scoped shelf queries keep separate cache entries per directoryPath and isolate across user scopes.
api.setUserScope("alice", "user");
const krDir = mount({ page: 1, pageSize: 24, seriesView: true, libraryIds: ["lib-1"], directoryPath: "韩漫" });
assert.equal(krDir.snapshot().loading, true);
assert.ok(requests.at(-1).url.includes("libraryIds=lib-1") && requests.at(-1).url.includes("directoryPath=%E9%9F%A9%E6%BC%AB"));
requests.at(-1).resolve(response("series-kr-a", 1));
await tick();
assert.equal(krDir.snapshot().comics[0].id, "series-kr-a");
krDir.unmount();

const jpDir = mount({ page: 1, pageSize: 24, seriesView: true, libraryIds: ["lib-1"], directoryPath: "日漫" });
assert.equal(jpDir.snapshot().loading, true, "Different directoryPath must not reuse another directory's cached shelf");
requests.at(-1).resolve(response("series-jp-a", 0));
await tick();
assert.equal(jpDir.snapshot().comics[0].id, "series-jp-a");
jpDir.unmount();

const krReturned = mount({ page: 1, pageSize: 24, seriesView: true, libraryIds: ["lib-1"], directoryPath: "韩漫" });
krReturned.snapshot();
const krReturnedState = krReturned.snapshot();
assert.equal(krReturnedState.loading, false, "Returning to previous directoryPath restores cached works immediately");
assert.equal(krReturnedState.comics[0].id, "series-kr-a");
requests.at(-1).resolve(response("series-kr-a", 2));
await tick();
assert.equal(krReturned.snapshot().comics[0].lastReadPage, 2);
krReturned.unmount();

// The accessible-libraries request must never load full work details for counts,
// and directory node cache must isolate across user/permission changes.
const librariesModule = { exports: {} };
const urls = [];
let nextDirStatus = 200;
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL("../src/api/libraries.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, {
  module: librariesModule, exports: librariesModule.exports, URL,
  Date: { now: () => now },
  fetch: async (url) => {
    urls.push(url);
    if (url.includes("/directories")) {
      if (nextDirStatus !== 200) {
        return { ok: false, status: nextDirStatus, json: async () => ({ error: "Forbidden" }) };
      }
      return {
        ok: true,
        json: async () => ({
          libraryId: "lib",
          seriesDepth: 2,
          maxDirectoryDepth: 1,
          parent: "",
          breadcrumbs: [],
          directories: [{ name: new URL(url, "http://localhost").searchParams.get("page") === "2" ? "分类101" : "韩漫", path: "韩漫", depth: 1, workCount: 12, hasChildren: false, coverUrl: "/api/comics/c1/thumbnail" }],
          total: 101,
          page: Number(new URL(url, "http://localhost").searchParams.get("page") || 1),
          pageSize: 100,
          totalPages: 2,
        }),
      };
    }
    return { ok: true, json: async () => ({ libraries: [{ id: "lib", comicCount: 5000, shelfCount: 1000, seriesDepth: 2 }] }) };
  },
  require: (name) => name === "@/lib/base-path" ? { apiPath: (p) => p } : api,
});
assert.equal((await librariesModule.exports.fetchAccessibleLibraries())[0].comicCount, 1000);
assert.deepEqual(urls, ["/api/libraries/accessible"]);
const dirList = await librariesModule.exports.fetchLibraryDirectories("lib", { parent: "" });
assert.equal(dirList.directories[0].workCount, 12);
assert.equal(librariesModule.exports.getCachedLibraryDirectories("lib", { parent: "" })?.directories[0].name, "韩漫");
api.setUserScope("mallory", "user");
assert.equal(librariesModule.exports.getCachedLibraryDirectories("lib", { parent: "" }), null, "Account change invalidates directory node cache");
await librariesModule.exports.fetchLibraryDirectories("lib", { parent: "" });
assert.ok(librariesModule.exports.getCachedLibraryDirectories("lib", { parent: "" }));
const secondDirPage = await librariesModule.exports.fetchLibraryDirectories("lib", { parent: "", page: 2 });
assert.equal(secondDirPage.directories[0].name, "分类101");
assert.equal(librariesModule.exports.getCachedLibraryDirectories("lib", { parent: "", page: 2 }).page, 2);
assert.equal(librariesModule.exports.getCachedLibraryDirectories("lib", { parent: "" }).page, 1, "Directory cache separates pages");
assert.equal(new URL(urls.at(-1), "http://localhost").searchParams.get("page"), "2");
nextDirStatus = 403;
await assert.rejects(() => librariesModule.exports.fetchLibraryDirectories("lib", { parent: "" }));
assert.equal(librariesModule.exports.getCachedLibraryDirectories("lib", { parent: "" }), null, "403 permission revocation clears directory cache");
console.log("Large shelf cache restoration, background refresh, permissions, and request-count tests passed.");
