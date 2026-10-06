import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import * as icons from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";

const source = ts.transpileModule(fs.readFileSync(new URL("../src/components/DesktopSidebar.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
let pathname = "/";
let user = { role: "admin", username: "reader", nickname: "QA" };
let siteIcon = false;
const dependencies = {
  react: React,
  "react/jsx-runtime": jsxRuntime,
  "next/link": { default: ({ href, children, ...props }) => React.createElement("a", { href, ...props }, children) },
  "react-router-dom": { useLocation: () => ({ pathname }) },
  "lucide-react": icons,
  "@/lib/auth-context": { useAuth: () => ({ user }) },
  "@/hooks/useSiteSettings": { useSiteSettings: () => ({ siteName: "NowenReader", siteIcon }) },
  "@/lib/base-path": { apiPath: (path) => `/reader-base${path}` },
  "@/lib/management-navigation": { isManagementPath: (path) => adminRoutes.some((href) => path === href || path.startsWith(`${href}/`)) },
  "./desktop-dock.css": {},
};
const module = { exports: {} };
vm.runInNewContext(source, {
  module, exports: module.exports,
  require(name) { assert.ok(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name]; },
});
const render = () => {
  return renderToStaticMarkup(React.createElement(module.exports.default));
};
const primaryRoutes = ["/", "/books", "/favorites", "/collections", "/recommendations", "/history", "/stats"];
const adminRoutes = ["/tag-manager", "/scraper", "/file-stats", "/logs", "/data-admin", "/data-qa"];
let html = render();
for (const path of primaryRoutes) assert.ok(html.includes(`href="${path}"`), `Missing primary route ${path}`);
assert.ok(html.includes('class="desktop-brand"'));
assert.ok(html.includes('class="desktop-brand-name">NowenReader</span>'));
assert.ok(!html.includes('class="dock-brand"'), "Branding belongs in the top-left corner, not inside the Dock");
assert.equal((html.match(/class="dock-label"/g) || []).length, 9);
for (const label of ["首页", "书库", "收藏", "合集", "推荐", "阅读历史", "阅读统计", "管理工具", "设置"]) {
  assert.ok(html.includes(`class="dock-label" aria-hidden="true">${label}</span>`), `Missing visible Dock label ${label}`);
}
assert.ok(html.includes('aria-label="管理工具"'));
assert.match(html, /href="\/tag-manager" class="dock-control" aria-label="管理工具"/);
assert.ok(!html.includes('aria-haspopup="dialog"'));
assert.ok(html.includes('href="/settings"'));
assert.ok(!html.includes('role="dialog"'));
assert.ok(!html.includes("QA"), "The static sidebar account badge should not duplicate the top-bar menu");
assert.match(html, /href="\/" aria-label="首页" aria-current="page"/);
pathname = "/books/example";
assert.match(render(), /href="\/books" aria-label="书库" aria-current="page"/);
pathname = "/favorites";
html = render();
assert.match(html, /href="\/favorites" aria-label="收藏" aria-current="page"/);
assert.ok(!html.includes('href="/books" aria-label="书库" aria-current="page"'));
pathname = "/bookstore";
assert.ok(!render().includes('aria-current="page"'), "Route prefixes must not select unrelated paths");
pathname = "/data-qa";
html = render();
assert.match(html, /aria-label="管理工具" aria-current="page"/);
assert.ok(!html.includes('role="dialog"'));
assert.ok(!html.includes('dock-management-panel'));
for (const path of adminRoutes) {
  pathname = path;
  assert.match(render(), /aria-label="管理工具" aria-current="page"/);
}
user = { role: "user", username: "reader" };
html = render();
assert.equal((html.match(/class="dock-label"/g) || []).length, 7);
assert.ok(!html.includes('href="/collections"'));
assert.ok(!html.includes('aria-label="管理工具"'));
assert.ok(!html.includes('role="dialog"'));
for (const path of adminRoutes) assert.ok(!html.includes(`href="${path}"`));
for (const path of primaryRoutes.filter((path) => path !== "/collections")) assert.ok(html.includes(`href="${path}"`));
user = null;
assert.ok(!render().includes('aria-label="管理工具"'));
siteIcon = true;
assert.match(render(), /src="\/reader-base\/api\/site-settings\/icon\?t=\d+" alt=""/);
const dockStyles = fs.readFileSync(new URL("../src/components/desktop-dock.css", import.meta.url), "utf8");
assert.ok(dockStyles.includes("top: 50%; transform: translateY(-50%)"), "The desktop Dock should be vertically centered");
assert.ok(dockStyles.includes("calc(100dvh - 160px)"), "A short viewport should retain clearance below the brand header");
console.log("Desktop Dock render, role, active-route, management, and base-path tests passed.");
