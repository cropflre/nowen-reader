import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createElement, isValidElement } from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as icons from "lucide-react";

const compile = (file, jsx = false) => ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    ...(jsx ? { jsx: ts.JsxEmit.ReactJSX } : {}),
  },
}).outputText;
const translationModule = { exports: {} };
vm.runInNewContext(compile("../src/lib/i18n/locales/en.ts"), { module: translationModule, exports: translationModule.exports });
const t = translationModule.exports.default;
const colorModule = { exports: {} };
vm.runInNewContext(compile("../src/lib/tag-color.ts"), { module: colorModule, exports: colorModule.exports });
const source = compile("../src/app/comic/[id]/page.tsx", true);
const noop = () => {};
const Empty = () => null;
const baseComic = {
  id: "comic-1", title: "Permission test comic", filename: "permission-test.cbz",
  pageCount: 20, fileSize: 1024, addedAt: "2026-11-05T00:00:00Z", lastReadPage: 0,
  lastReadAt: null, isFavorite: false, rating: null, coverUrl: "", coverAspectRatio: 0,
  sortOrder: 0, totalReadTime: 0, categories: [], author: "", publisher: "", year: null,
  description: "", language: "", genre: "", metadataSource: "", type: "comic",
  tags: [{ name: "Adventure", color: "default" }, { name: "冒险 & Mystery", color: "default" }],
};

function mount({ role = "user", canManage = false, tags = baseComic.tags, tagSources = [], aiConfigured = true } = {}) {
  const env = {
    user: { id: "reader-1", username: "reader", role },
    comic: { ...baseComic, canManage, tags },
    statusCode: 200,
    aiConfigured,
    requests: [],
    backgroundRequests: [],
    tagSourceRequests: [],
    tagWrites: [],
  };
  // Preserve state by the normal hook call order. Tests change it through the
  // rendered input/button handlers, never by injecting values into hook slots.
  const slots = [];
  const effects = [];
  let cursor = 0;
  const react = {
    useState(initial) {
      const i = cursor++;
      slots[i] ??= { value: typeof initial === "function" ? initial() : initial };
      return [slots[i].value, (next) => { slots[i].value = typeof next === "function" ? next(slots[i].value) : next; }];
    },
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useCallback(callback) { return callback; },
    useEffect(callback, deps) {
      const i = cursor++;
      const sameDeps = slots[i]?.deps && deps && slots[i].deps.length === deps.length && slots[i].deps.every((value, index) => Object.is(value, deps[index]));
      if (!sameDeps) {
        const previous = slots[i];
        slots[i] = { deps };
        effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = callback(); });
      }
    },
  };
  const dependencies = {
    "react": react,
    "react/jsx-runtime": jsxRuntime,
    "lucide-react": icons,
    "next/navigation": { useParams: () => ({ id: baseComic.id }), useRouter: () => ({ push: noop, back: noop }) },
    "next/image": { default: Empty },
    "next/link": { default: ({ href, children, ...props }) => createElement("a", { href, ...props }, children) },
    "@/components/LazyImage": { default: Empty },
    "@/components/DetailAmbientBackdrop": { default: Empty },
    "@/components/ForbiddenPage": { default: () => createElement("p", { role: "alert" }, "Access Denied") },
    "@/components/Toast": { useToast: () => ({ error: noop, success: noop }) },
    "@/components/MetadataSearch": { MetadataSearch: Empty },
    "@/components/Recommendations": { SimilarComics: Empty },
    "@/components/PdfRendererBanner": { default: Empty },
    "@/lib/auth-context": { useAuth: () => ({ user: env.user }) },
    "@/lib/i18n": { useTranslation: () => t, useLocale: () => ({ locale: "en" }) },
    "@/hooks/useAIStatus": { useAIStatus: () => ({ aiConfigured: env.aiConfigured }) },
    "@/hooks/useComics": {
      useComicDetail: () => ({ comic: env.comic, loading: false, statusCode: env.statusCode, error: null, refetch: noop }),
      useCategories: () => ({ categories: [], refetch: noop, initCategories: noop }),
      setReadingStatus: noop, toggleComicFavorite: noop, updateComicRating: noop,
      addComicTags: async (comicId, names) => { env.tagWrites.push({ comicId, names: Array.from(names) }); },
      removeComicTag: noop, clearAllComicTags: noop, deleteComicById: noop,
      addComicCategories: noop, removeComicCategory: noop, clearAllComicCategories: noop, updateComicMetadata: noop,
    },
    "@/lib/progress": { calculateStoredReadingProgress: () => 0, getReadingPageNumber: () => 1, isStoredReadingFinished: () => false },
    "@/api/groups": { fetchGroupedComicMap: async () => ({}), fetchGroupDetail: noop },
    "@/api/comics": { getComicTagsWithSource: async (id) => { env.tagSourceRequests.push(id); return tagSources; } },
    "@/lib/pwa": { invalidateSwCache: noop },
    "@/hooks/useComicList": { invalidateComicsCache: noop },
    "@/hooks/useSyncEvent": { useSyncEvent: noop },
    "@/lib/sync-event": { emitMetadataUpdated: noop, emitTagsUpdated: noop, emitCategoriesUpdated: noop, emitScrapeApplied: noop },
    "@/lib/comic-utils": {
      formatFileSize: () => "1 KB", isNovelFile: () => false, isNovelComic: () => false,
      getReaderUrl: (comic) => `/reader/${comic.id}`, getDetailUrl: (comic) => `/comic/${comic.id}`,
    },
    "@/lib/base-path": { apiPath: (path) => `/reader${path}` },
    "@/lib/tag-color": colorModule.exports,
  };
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, exports: module.exports,
    window: { confirm: () => true },
    fetch: async (url, options) => {
      if (url === "/reader/api/translate/engines") {
        env.backgroundRequests.push({ url, options });
        return { ok: true, json: async () => ({ engines: [] }) };
      }
      env.requests.push({ url, options });
      assert.equal(url, "/reader/api/comics/comic-1/ai-suggest-tags", "Only the clicked AI suggestion action should fetch in this fixture");
      return { ok: true, json: async () => ({ suggestedTags: ["Suggested adventure", "Suggested mystery"] }) };
    },
    require(name) {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  });
  return {
    env,
    render() {
      cursor = 0;
      const tree = module.exports.default();
      const html = renderToStaticMarkup(tree);
      effects.splice(0).forEach((effect) => effect());
      return { tree, html };
    },
  };
}

function elements(tree, predicate) {
  const found = [];
  const visit = (node) => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!isValidElement(node)) return;
    if (predicate(node)) found.push(node);
    visit(node.props.children);
  };
  visit(tree);
  return found;
}
const tagSection = (tree) => elements(tree, (node) => node.type === "section" && node.props["aria-label"] === t.comicDetail.tagsLabel)[0];
const buttons = (tree) => elements(tree, (node) => node.type === "button");
const input = (tree) => elements(tree, (node) => node.type === "input" && node.props.placeholder === t.comicDetail.addTagPlaceholder)[0];
const text = (tree) => {
  if (tree === null || tree === undefined || typeof tree === "boolean") return "";
  if (Array.isArray(tree)) return tree.map(text).join("");
  if (isValidElement(tree)) return text(tree.props.children);
  return String(tree);
};
const buttonWithText = (tree, label) => buttons(tree).find((button) => text(button).includes(label));
function assertReadOnlyTags(tree) {
  const section = tagSection(tree);
  assert.ok(section, "Readers can find the labeled tags section");
  assert.equal(input(section), undefined, "Readers cannot add tags");
  assert.equal(buttons(section).length, 0, "Readers have no remove, clear, add, AI suggestion or AI apply controls");
  for (const label of [t.comicDetail.clearAllTags, t.comicDetail.aiSuggestTags, t.comicDetail.aiAddSelected, t.comicDetail.aiAddAll]) {
    assert.ok(!text(section).includes(label), `The read-only tags section omits ${label}`);
  }
  return section;
}

const reader = mount();
let rendered = reader.render();
let section = assertReadOnlyTags(rendered.tree);
assert.ok(text(section).includes("Adventure"));
assert.ok(text(section).includes("冒险 & Mystery"));
assert.ok(rendered.html.includes("冒险 &amp; Mystery"), "Tag names are rendered through React escaping");

const noTagsReader = mount({ tags: [] });
section = assertReadOnlyTags(noTagsReader.render().tree);
assert.ok(text(section).includes(t.comicDetail.noTags), "Readers see the no-tags state instead of losing the entire section");
assert.equal(reader.env.requests.length, 0, "Displaying tags does not call editing endpoints");

const coloredReader = mount({
  tags: [
    { name: "Custom color", color: "#3a7" },
    { name: "Default color", color: "default" },
    { name: "Inherited color", color: "#1234" },
    { name: "Excluded color", color: "#f00" },
  ],
  tagSources: [{ name: "Inherited color", source: "series" }, { name: "Excluded color", source: "excluded" }],
});
coloredReader.render();
for (let i = 0; i < 12; i++) await Promise.resolve();
rendered = coloredReader.render();
section = assertReadOnlyTags(rendered.tree);
assert.deepEqual(coloredReader.env.tagSourceRequests, ["comic-1"], "The real source-loading effect requests tag provenance");
const chip = (name) => elements(section, (node) => node.type === "span" && node.key === name)[0];
assert.deepEqual({ ...chip("Custom color").props.style }, { color: "#3a7", backgroundColor: "rgba(51, 170, 119, 0.15)" }, "Readers see the saved custom color");
assert.ok(rendered.html.includes("background-color:rgba(51, 170, 119, 0.15)"));
assert.equal(chip("Default color").props.style, undefined);
assert.ok(chip("Default color").props.className.includes("bg-accent/15"), "Default tags keep their existing accent styling");
assert.deepEqual({ ...chip("Inherited color").props.style }, { color: "#1234", backgroundColor: "rgba(17, 34, 51, 0.04)" });
assert.ok(text(chip("Inherited color")).includes("系列"), "Custom color preserves the inherited-source badge");
assert.equal(chip("Excluded color").props.style, undefined, "Excluded tags ignore their saved custom color");
assert.ok(chip("Excluded color").props.className.includes("line-through"));
assert.ok(text(chip("Excluded color")).includes("已排除"), "Excluded tags preserve their muted source indication");

for (const permission of [{ role: "admin", canManage: false }, { role: "user", canManage: true }]) {
  const manager = mount(permission);
  rendered = manager.render();
  section = tagSection(rendered.tree);
  assert.ok(section);
  assert.ok(input(section), "Admins and delegated library managers retain the add-tag input");
  assert.ok(buttons(section).some((button) => button.props.title === t.comicDetail.clearAllTags));
  assert.ok(buttons(section).some((button) => button.props.title === t.comicDetail.aiSuggestTags), "AI-configured managers retain suggestion generation");
  assert.equal(buttons(section).length, baseComic.tags.length + 3, "Each existing tag retains a removal button, alongside clear, add and AI actions");
  input(section).props.onChange({ target: { value: "New tag" } });
  section = tagSection(manager.render().tree);
  await input(section).props.onKeyDown({ key: "Enter" });
  assert.deepEqual(manager.env.tagWrites, [{ comicId: "comic-1", names: ["New tag"] }], "The retained add control still executes the real handler");
}

const emptyManager = mount({ canManage: true, tags: [], aiConfigured: false });
section = tagSection(emptyManager.render().tree);
assert.ok(input(section), "Managers can add the first tag");
assert.ok(text(section).includes(t.comicDetail.noTags));
assert.ok(!buttonWithText(section, t.comicDetail.clearAllTags));
assert.ok(!buttonWithText(section, t.comicDetail.aiSuggestTags), "AI controls stay absent when AI is not configured");

// Exercise the actual asynchronous suggestion handler rather than forcing an
// internal useState slot, then simulate a permission downgrade with pending UI.
const aiManager = mount({ canManage: true });
section = tagSection(aiManager.render().tree);
await buttons(section).find((button) => button.props.title === t.comicDetail.aiSuggestTags).props.onClick();
assert.equal(aiManager.env.requests.length, 1);
assert.deepEqual(JSON.parse(aiManager.env.requests[0].options.body), { targetLang: "en", apply: false });
section = tagSection(aiManager.render().tree);
assert.ok(text(section).includes("Suggested adventure"));
assert.ok(buttonWithText(section, t.comicDetail.aiAddSelected));
assert.ok(buttonWithText(section, t.comicDetail.aiAddAll));
aiManager.env.comic.canManage = false;
rendered = aiManager.render();
section = assertReadOnlyTags(rendered.tree);
assert.ok(!text(section).includes("Suggested adventure"), "Pending AI suggestions disappear when management permission is removed");
assert.ok(text(section).includes("Adventure"), "Existing tags stay visible after a management permission downgrade");
aiManager.env.comic.canManage = true;
section = tagSection(aiManager.render().tree);
await buttonWithText(section, t.comicDetail.aiAddSelected).props.onClick();
assert.deepEqual(aiManager.env.tagWrites, [{ comicId: "comic-1", names: ["Suggested adventure", "Suggested mystery"] }]);
assert.ok(!text(tagSection(aiManager.render().tree)).includes("Suggested adventure"), "Applying suggestions clears the pending suggestion controls");

reader.env.statusCode = 403;
rendered = reader.render();
assert.equal(tagSection(rendered.tree), undefined, "The change does not display metadata when access to the work is forbidden");
assert.ok(rendered.html.includes("Access Denied"));

console.log("Comic tag visibility, reader restrictions, manager controls, and AI permission tests passed.");
