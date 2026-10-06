import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import * as icons from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";

function load(file, dependencies = {}) {
  const source = ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports,
    require(name) { assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name]; },
  });
  return module.exports;
}
const translations = load("../src/lib/i18n/locales/zh-CN.ts").default;
const group = { id: 1, name: "Alpha", comicCount: 9, coverUrl: "", updatedAt: "2026-10-01", createdAt: "2026-09-01", tags: "" };
const states = [[group, { ...group, id: 2, name: "Beta", comicCount: 1 }], false];
let index = 0;
const common = { react: React, "react/jsx-runtime": jsxRuntime };
const header = load("../src/components/PageHeader.tsx", { ...common,
  "react-router-dom": { useLocation: () => ({ pathname: "/collections" }) },
  "@/lib/auth-context": { useAuth: () => ({ user: { role: "admin" } }) },
  "@/lib/management-navigation": { isManagementPath: () => false },
  "@/components/ManagementTabs": { default: () => null },
});
const Search = ({ label }) => React.createElement("button", { "aria-label": label });
const page = load("../src/app/collections/page.tsx", { ...common,
  react: { ...React, useState(initial) {
    const slot = index++;
    if (!(slot in states)) states[slot] = typeof initial === "function" ? initial() : initial;
    return [states[slot], (next) => { states[slot] = typeof next === "function" ? next(states[slot]) : next; }];
  }, useEffect() {}, useMemo: (factory) => factory(), useCallback: (callback) => callback, useRef: (current) => ({ current }) },
  "next/link": { default: ({ href, children, ...props }) => React.createElement("a", { href, ...props }, children) },
  "next/image": { default: ({ src, alt }) => React.createElement("img", { src, alt }) },
  "lucide-react": icons,
  "@/lib/i18n": { useTranslation: () => translations },
  "@/components/Toast": { useToast: () => ({ error() {} }) },
  "@/api/groups": {}, "@/api/catalog": {},
  "@/components/AutoDetectPanel": { default: () => null },
  "@/components/PageHeader": header,
  "@/components/SearchIconButton": { default: Search },
}).default;
function walk(node, predicate) {
  if (Array.isArray(node)) return node.flatMap((child) => walk(child, predicate));
  if (!React.isValidElement(node)) return [];
  return [...(predicate(node) ? [node] : []), ...walk(node.props.children, predicate)];
}
const render = () => { index = 0; return page(); };
const getHeader = (tree) => walk(tree, (node) => node.type === header.PageHeader)[0];
const button = (tree, name) => walk(getHeader(tree).props.controls, (node) => node.type === "button" && (node.props["aria-label"] === name || node.props.children === name))[0];
const names = (tree) => walk(tree, (node) => !!node.props.group).map((node) => node.props.group.name);
let tree = render();
let html = renderToStaticMarkup(tree);
for (const name of ["合集类型", "搜索合集", "合集视图", "卡片视图", "列表视图", "合集排序"]) {
  assert.ok(html.indexOf(`aria-label="${name}"`) < html.indexOf("</header>"), `${name} must belong to the top header`);
}
assert.equal((html.match(/>漫画<\/button>/g) || []).length, 1, "The content area must not repeat type filters");
assert.equal((html.match(/>小说<\/button>/g) || []).length, 1);
assert.ok(button(tree, "卡片视图").props["aria-pressed"]);
assert.deepEqual(names(tree), ["Alpha", "Beta"]);
button(tree, "列表视图").props.onClick();
tree = render();
assert.ok(button(tree, "列表视图").props["aria-pressed"]);
html = renderToStaticMarkup(tree);
assert.ok(html.includes('class="space-y-2"'), "List selection must render list rows");
button(tree, "合集排序").props.onClick();
tree = render();
const sortOption = walk(getHeader(tree).props.controls, (node) => node.type === "button" && node.props.children?.[0] === "按作品数")[0];
sortOption.props.onClick();
tree = render();
assert.deepEqual(names(tree), ["Beta", "Alpha"], "The moved sort control must still sort actual records");
assert.equal(button(tree, "合集排序").props["aria-expanded"], false);
const search = walk(getHeader(tree).props.controls, (node) => node.type === Search)[0];
assert.equal(search.props.inputLabel, "合集搜索关键词");
search.props.onChange("Beta");
tree = render();
assert.deepEqual(names(tree), ["Beta"], "The moved search must still filter collection names");
search.props.onChange("unmatched");
tree = render();
assert.equal(names(tree).length, 0);
assert.ok(renderToStaticMarkup(tree).includes("无匹配合集"));
search.props.onChange("");
tree = render();
button(tree, "小说").props.onClick();
tree = render();
assert.ok(button(tree, "小说").props["aria-pressed"]);
assert.ok(renderToStaticMarkup(tree).includes("contentType=novel"));
button(tree, "卡片视图").props.onClick();
tree = render();
assert.ok(button(tree, "卡片视图").props["aria-pressed"]);
assert.ok(renderToStaticMarkup(tree).includes("grid-cols-2"));
console.log("Collection top-bar placement, type, view, search, sorting, and empty-state tests passed.");
