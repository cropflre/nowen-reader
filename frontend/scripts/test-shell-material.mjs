import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import * as icons from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";

function load(file, dependencies) {
  const source = ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports,
    window: { addEventListener: (event, callback) => listeners.set(event, callback), removeEventListener() {} },
    require(name) { assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name]; },
  });
  return module.exports;
}
const listeners = new Map();
const common = { react: React, "react/jsx-runtime": jsxRuntime };
const navigation = load("../src/lib/management-navigation.ts", {});
for (const { href } of navigation.managementItems) {
  assert.ok(navigation.isManagementPath(href));
  assert.ok(navigation.isManagementPath(`${href}/detail`));
  assert.ok(!navigation.isManagementPath(`${href}-unrelated`));
}
assert.ok(!navigation.isManagementPath("/books"));
let pathname = "/tag-manager";
const routing = { "react-router-dom": { useLocation: () => ({ pathname }) } };
const tabs = load("../src/components/ManagementTabs.tsx", { ...common, ...routing,
  "next/link": { default: ({ href, children, ...props }) => React.createElement("a", { href, ...props }, children) },
  "@/lib/management-navigation": navigation,
}).default;
for (const { href, label } of navigation.managementItems) {
  pathname = href;
  const html = renderToStaticMarkup(React.createElement(tabs));
  assert.equal((html.match(/aria-current="page"/g) || []).length, 1);
  assert.ok(html.includes(`href="${href}" aria-current="page">${label}`));
  assert.equal((html.match(/href=/g) || []).length, 6);
}
let role = "admin";
const header = load("../src/components/PageHeader.tsx", { ...common, ...routing,
  "@/lib/auth-context": { useAuth: () => ({ user: { role } }) },
  "@/lib/management-navigation": navigation,
  "@/components/ManagementTabs": { default: tabs },
}).PageHeader;
assert.ok(renderToStaticMarkup(React.createElement(header, { title: "巡检" })).includes('class="management-tabs"'));
role = "user";
assert.ok(!renderToStaticMarkup(React.createElement(header, { title: "巡检" })).includes('class="management-tabs"'));
role = "admin";
pathname = "/history";
assert.ok(!renderToStaticMarkup(React.createElement(header, { title: "阅读历史" })).includes('class="management-tabs"'));
for (const route of ["/collections", "/recommendations", "/history", "/stats", ...navigation.managementItems.map(({ href }) => href)]) {
  pathname = route;
  const headerHtml = renderToStaticMarkup(React.createElement(header, { title: "Module", description: "Details" }));
  assert.ok(headerHtml.includes('class="module-header-inner'), `${route} must use the shared header geometry`);
  assert.ok(!headerHtml.includes("max-w-"), `${route} must not move its header with the content width`);
  assert.ok(!headerHtml.includes("min-h-16"), "The inner header must fit inside the shared 64px border box");
}
pathname = "/collections";
const controlledHeader = renderToStaticMarkup(React.createElement(header, {
  title: "Collections", controls: React.createElement("button", null, "Filter control"),
  actions: React.createElement("button", null, "Create action"),
}));
assert.ok(controlledHeader.includes("module-header-has-controls"));
assert.ok(controlledHeader.includes('class="module-header-controls"><button>Filter control</button>'));
assert.ok(controlledHeader.indexOf("Filter control") < controlledHeader.indexOf("</header>"));
assert.ok(controlledHeader.indexOf("Create action") < controlledHeader.indexOf("</header>"));

let open = false;
let stateChanged;
const search = load("../src/components/SearchIconButton.tsx", { ...common,
  react: { ...React, useState: () => [open, (next) => { stateChanged = next; }], useEffect() {}, useId: () => "search-test", useRef: () => ({ current: null }) },
  "lucide-react": icons,
  "@/lib/i18n": { useTranslation: () => ({ navbar: { searchPlaceholder: "搜索", aiSearchPlaceholder: "语义搜索" } }) },
}).default;
let query = "森林";
let submitted = false;
const props = { query, onChange: (next) => { query = next; }, onSubmit: () => { submitted = true; }, onAiSearchModeChange() {} };
let html = renderToStaticMarkup(React.createElement(search, props));
assert.ok(html.includes('aria-expanded="false"'));
assert.ok(!html.includes("<input"));
assert.ok(!html.includes('role="dialog"'));
open = true;
html = renderToStaticMarkup(React.createElement(search, props));
assert.ok(html.includes('role="dialog" aria-label="搜索书库"'));
assert.ok(html.includes('value="森林"'));
assert.ok(html.includes('aria-label="清除搜索"'));
assert.ok(html.includes('aria-label="关闭搜索"'));
assert.ok(html.includes('role="switch"'));
html = renderToStaticMarkup(React.createElement(search, { ...props, label: "搜索设置", inputLabel: "设置搜索关键词", placeholder: "搜索设置" }));
assert.ok(html.includes('role="dialog" aria-label="搜索设置"'));
assert.ok(html.includes('aria-label="设置搜索关键词" placeholder="搜索设置"'));
const tree = search(props);
const form = tree.props.children[1].props.children[0];
let prevented = false;
form.props.onSubmit({ preventDefault() { prevented = true; } });
assert.ok(prevented && submitted);
assert.equal(stateChanged, false);

let focus = { comics: [], activeId: "" };
let hideNSFW = false;
let user = { id: "one", role: "admin" };
let publish;
const pathRef = { current: "/" };
let comics = [{ id: "recent", reading: false }, { id: "reading", reading: true }];
const ambientContext = load("../src/lib/ambient-context.ts", common);
const shell = load("../src/components/AppShell.tsx", { ...common, ...routing,
  react: { ...React, useState: () => [focus, (next) => { focus = next; }], useRef: () => pathRef, useEffect: (effect) => effect() },
  "@/components/DesktopSidebar": { default: () => null },
  "@/components/home/DashboardAmbientBackdrop": { default: (props) => React.createElement("div", { "data-active": props.activeId, "data-private": props.hideNSFW }) },
  "@/components/home/dashboard-shelf": { selectContinueReading: (items) => items.filter((comic) => comic.reading) },
  "@/hooks/useComics": { useComics: () => ({ comics, setComics: (next) => { comics = next; } }), LIBRARY_ACCESS_CHANGED_EVENT: "access-changed" },
  "@/hooks/usePrivacyMode": { usePrivacyMode: () => ({ enabled: hideNSFW, blurNSFW: true }) },
  "@/lib/auth-context": { useAuth: () => ({ user }) },
  "@/lib/ambient-context": ambientContext,
  "./home/dashboard-main.css": {}, "./app-shell-material.css": {},
});
function Content() { publish = ambientContext.useAmbientFocus(); return null; }
const renderShell = () => renderToStaticMarkup(React.createElement(shell.default, null, React.createElement(Content)));
pathname = "/books";
assert.ok(renderShell().includes('data-active="reading"'), "A direct module load should derive the home reading backdrop");
pathname = "/";
assert.ok(renderShell().includes('data-active=""'), "Home must wait for its own focused shelf rather than flash fallback art");
publish({ comics: [{ id: "selected" }], activeId: "selected" });
assert.ok(renderShell().includes('data-active="selected"'));
pathname = "/settings";
renderShell();
publish({ comics: [], activeId: "" });
assert.ok(renderShell().includes('data-active="selected"'), "Shelf cleanup must preserve art when leaving Home");
hideNSFW = true;
assert.ok(renderShell().includes('data-private="true"'));
listeners.get("access-changed")();
assert.ok(renderShell().includes('data-active=""'), "Permission changes must discard retained and fallback art until fresh data arrives");
comics = [{ id: "newly-permitted", reading: true }];
assert.ok(renderShell().includes('data-active="newly-permitted"'));
pathname = "/";
renderShell();
publish({ comics: [], activeId: "" });
assert.ok(renderShell().includes('data-active=""'));
const oldKey = shell.default({ children: null }).key;
user = { id: "two", role: "user" };
assert.notEqual(shell.default({ children: null }).key, oldKey, "Account changes must remount retained backdrop state");
console.log("Shared ambient shell, permission reset, management tabs, and icon-search tests passed.");
