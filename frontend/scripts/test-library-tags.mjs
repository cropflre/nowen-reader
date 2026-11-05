import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Run the production hook against controllable network responses and browser events.
// Aborted requests deliberately remain resolvable, as a proxy may already have
// delivered a response when navigation or another refresh invalidates it.
const source = ts.transpileModule(fs.readFileSync(new URL("../src/hooks/useLibraryTags.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const sameDeps = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const response = (names) => ({ ok: true, json: async () => ({ tags: names.map((name) => ({ name })) }) });

class BrowserTarget extends EventTarget {
  listeners = new Map();
  addEventListener(type, callback, options) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
    super.addEventListener(type, callback, options);
  }
  removeEventListener(type, callback, options) {
    this.listeners.get(type)?.delete(callback);
    super.removeEventListener(type, callback, options);
  }
  get listenerCount() { return [...this.listeners.values()].reduce((sum, listeners) => sum + listeners.size, 0); }
}

function harness(initialScope = "alice") {
  let scope = initialScope;
  let now = 0;
  let nextTimer = 0;
  let stateUpdates = 0;
  const slots = [];
  const effects = [];
  const timers = new Map();
  const subscribers = new Set();
  const requests = [];
  const window = new BrowserTarget();
  const document = new BrowserTarget();
  document.visibilityState = "visible";
  let cursor = 0;
  const react = {
    useState(initial) {
      const i = cursor++;
      slots[i] ??= { value: typeof initial === "function" ? initial() : initial };
      return [slots[i].value, (value) => {
        stateUpdates++;
        slots[i].value = typeof value === "function" ? value(slots[i].value) : value;
      }];
    },
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useCallback(callback, deps) {
      const i = cursor++;
      if (!sameDeps(slots[i]?.deps, deps)) slots[i] = { callback, deps };
      return slots[i].callback;
    },
    useEffect(callback, deps) {
      const i = cursor++;
      if (!sameDeps(slots[i]?.deps, deps)) {
        const previous = slots[i];
        slots[i] = { deps };
        effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = callback(); });
      }
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, exports: module.exports, AbortController, window, document,
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    fetch(url, options) { return new Promise((resolve, reject) => { requests.push({ url, options, resolve, reject }); }); },
    require(name) {
      if (name === "react") return react;
      if (name === "@/lib/base-path") return { apiPath: (path) => `/reader${path}` };
      if (name === "@/lib/sync-event") return { syncBus: { onAll(listener) { subscribers.add(listener); return () => subscribers.delete(listener); } } };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return {
    window, document, requests, timers, subscribers,
    get stateUpdates() { return stateUpdates; },
    snapshot(nextScope = scope) {
      scope = nextScope;
      cursor = 0;
      const state = module.exports.useLibraryTags(scope);
      effects.splice(0).forEach((effect) => effect());
      return state;
    },
    emit(type) { for (const listener of subscribers) listener({ type, comicId: "book", source: "tag-manager" }); },
    advance(ms) {
      const until = now + ms;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
      }
      now = until;
    },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()); },
  };
}
const tags = (h) => Array.from(h.snapshot().tags);

const h = harness();
let state = h.snapshot();
assert.equal(state.loaded, false);
assert.equal(h.requests.length, 1, "Mount fetches tags without waiting for a browser event");
assert.equal(h.requests[0].url, "/reader/api/tags", "Subpath deployments use apiPath");
assert.equal(h.requests[0].options.cache, "no-store");
h.requests[0].resolve({ ok: true, json: async () => ({ tags: [{ name: "Zulu" }, null, { name: "Alpha" }, { name: "Zulu" }, { name: "" }, { name: 42 }] }) });
await tick();
assert.deepEqual(tags(h), ["Alpha", "Zulu"], "API values are sorted and duplicate or unusable names are removed");
assert.equal(h.snapshot().loaded, true);
assert.equal(h.requests.length, 1, "Rendering the shelf does not repeatedly fetch tag options");

h.document.visibilityState = "hidden";
h.window.dispatchEvent(new Event("focus"));
h.document.dispatchEvent(new Event("visibilitychange"));
h.advance(250);
assert.equal(h.requests.length, 1, "Hidden documents do not refresh on focus or visibility notifications");
h.document.visibilityState = "visible";
h.document.dispatchEvent(new Event("visibilitychange"));
h.window.dispatchEvent(new Event("focus"));
h.advance(99);
assert.equal(h.requests.length, 1);
h.advance(1);
assert.equal(h.requests.length, 2, "Returning to a tab coalesces visibility and focus into one request");
h.requests.at(-1).resolve(response(["Renamed"]));
await tick();
assert.deepEqual(tags(h), ["Renamed"], "External changes replace obsolete tag names");

const relevantEvents = ["tags_updated", "scrape_applied", "metadata_cleared", "batch_sync_complete"];
for (const type of relevantEvents) {
  const before = h.requests.length;
  h.emit(type);
  h.advance(100);
  assert.equal(h.requests.length, before + 1, `${type} invalidates tag options`);
  h.requests.at(-1).resolve(response([type]));
  await tick();
  assert.deepEqual(tags(h), [type]);
}
let before = h.requests.length;
for (const type of ["cover_updated", "categories_updated", "metadata_updated"]) h.emit(type);
h.advance(500);
assert.equal(h.requests.length, before, "Unrelated metadata changes do not reload tag options");
for (const type of relevantEvents) h.emit(type);
h.advance(100);
assert.equal(h.requests.length, before + 1, "Batch event bursts produce one refresh");
h.requests.at(-1).resolve({ ok: true, json: async () => [{ name: "Array response" }] });
await tick();
assert.deepEqual(tags(h), ["Array response"], "Legacy array responses remain supported");

before = h.requests.length;
h.window.dispatchEvent(new Event("nowen:tags-updated"));
h.advance(100);
assert.equal(h.requests.length, before + 1, "Explicit invalidation events also refresh options");
const stale = h.requests.at(-1);
h.emit("tags_updated");
assert.equal(stale.options.signal.aborted, true);
stale.resolve(response(["Obsolete"]));
await tick();
assert.deepEqual(tags(h), ["Array response"], "An invalidated response cannot temporarily restore stale options");
h.advance(100);
h.requests.at(-1).resolve(response(["Current"]));
await tick();
assert.deepEqual(tags(h), ["Current"]);

// A response body can arrive after both an invalidation and a newer response.
state = h.snapshot();
const stableRefresh = state.refresh;
state.refresh();
h.advance(100);
let finishBody;
h.requests.at(-1).resolve({ ok: true, json: () => new Promise((resolve) => { finishBody = resolve; }) });
await tick();
h.emit("tags_updated");
h.advance(100);
h.requests.at(-1).resolve(response(["Newest"]));
await tick();
finishBody({ tags: [{ name: "Late old body" }] });
await tick();
assert.deepEqual(tags(h), ["Newest"], "Late JSON parsing cannot overwrite the newest response");
assert.equal(h.snapshot().refresh, stableRefresh, "The refresh callback remains stable across renders");

for (const failure of [
  (request) => request.reject(new Error("offline")),
  (request) => request.resolve({ ok: false, status: 503, json: async () => ({ tags: [] }) }),
  (request) => request.resolve({ ok: true, json: async () => ({ error: "invalid payload" }) }),
  (request) => request.resolve({ ok: true, json: async () => { throw new Error("invalid JSON"); } }),
]) {
  h.snapshot().refresh();
  h.advance(100);
  failure(h.requests.at(-1));
  await tick();
  assert.deepEqual(tags(h), ["Newest"], "Failed refreshes preserve usable options and active filters");
  assert.equal(h.snapshot().loaded, true);
}
h.snapshot().refresh();
h.advance(100);
h.requests.at(-1).resolve(response([]));
await tick();
assert.deepEqual(tags(h), [], "A genuine empty list clears deleted tags");
assert.equal(h.snapshot().loaded, true, "An empty list is a successful load");

h.snapshot().refresh();
h.advance(100);
h.requests.at(-1).resolve(response(["Alice"]));
await tick();
assert.deepEqual(tags(h), ["Alice"]);
h.snapshot().refresh();
h.advance(100);
const aliceRequest = h.requests.at(-1);
state = h.snapshot("bob");
assert.deepEqual(Array.from(state.tags), [], "An account change hides previous tag options immediately");
assert.equal(state.loaded, false);
assert.equal(aliceRequest.options.signal.aborted, true, "Changing scope cancels the previous account's request");
const bobRequest = h.requests.at(-1);
aliceRequest.resolve(response(["Alice private"]));
await tick();
assert.deepEqual(tags(h), [], "Late account responses cannot publish tags into a different scope");
bobRequest.resolve(response(["Bob"]));
await tick();
assert.deepEqual(tags(h), ["Bob"]);
assert.equal(h.subscribers.size, 1, "Scope changes replace rather than accumulate sync subscriptions");
assert.equal(h.window.listenerCount, 2);
assert.equal(h.document.listenerCount, 1);
before = h.requests.length;
stableRefresh();
h.advance(100);
assert.equal(h.requests.length, before + 1, "A retained refresh callback addresses the current scope");
const unmountedRequest = h.requests.at(-1);
h.emit("tags_updated");
assert.equal(h.timers.size, 1);
const updatesBeforeUnmount = h.stateUpdates;
h.unmount();
assert.equal(h.timers.size, 0, "Unmount cancels queued refreshes");
assert.equal(h.subscribers.size, 0);
assert.equal(h.window.listenerCount, 0);
assert.equal(h.document.listenerCount, 0);
assert.equal(unmountedRequest.options.signal.aborted, true);
stableRefresh();
h.emit("tags_updated");
h.window.dispatchEvent(new Event("focus"));
h.document.dispatchEvent(new Event("visibilitychange"));
h.window.dispatchEvent(new Event("nowen:tags-updated"));
h.advance(1000);
unmountedRequest.resolve(response(["After unmount"]));
await tick();
assert.equal(h.requests.length, before + 1, "Disposed hooks cannot start new requests");
assert.equal(h.stateUpdates, updatesBeforeUnmount, "Disposed requests cannot update React state");

// Changing scope also cancels a refresh that has not reached the network yet.
const queued = harness();
queued.snapshot();
queued.snapshot().refresh();
queued.snapshot("bob");
assert.equal(queued.requests.length, 2);
queued.advance(1000);
assert.equal(queued.requests.length, 2, "Scope cleanup cancels the old account's pending debounce");
queued.unmount();

const activeUnmount = harness();
activeUnmount.snapshot();
assert.equal(activeUnmount.requests[0].options.signal.aborted, false);
activeUnmount.unmount();
assert.equal(activeUnmount.requests[0].options.signal.aborted, true, "Unmount aborts an active network request even without an earlier invalidation");
activeUnmount.requests[0].resolve(response(["Disposed"]));
await tick();
assert.equal(activeUnmount.stateUpdates, 0);

const initialFailure = harness();
initialFailure.snapshot();
initialFailure.requests[0].reject(new Error("offline"));
await tick();
assert.equal(initialFailure.snapshot().loaded, false, "An initial network failure must not authorize clearing selected tags");
initialFailure.unmount();

console.log("Library tag refresh, event coalescing, races, failures, scope isolation, and cleanup tests passed.");
