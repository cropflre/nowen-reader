import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createElement } from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { ChevronDown, UserRound } from "lucide-react";

const source = ts.transpileModule(fs.readFileSync(new URL("../src/components/UserMenuButton.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const dependencies = {
  "react/jsx-runtime": jsxRuntime,
  "lucide-react": { ChevronDown, UserRound },
  "@/lib/i18n": { useTranslation: () => ({ auth: { userMenu: "User menu" } }) },
};
const module = { exports: {} };
vm.runInNewContext(source, {
  module, exports: module.exports,
  require(name) { assert.ok(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name]; },
});
const UserMenuButton = module.exports.default;
const render = (user, open = false) => renderToStaticMarkup(createElement(UserMenuButton, { user, open, onClick() {} }));

let html = render({ username: "reader", nickname: "Alice" });
assert.ok(html.includes('aria-label="User menu Alice"'));
assert.ok(html.includes('title="Alice"'));
assert.ok(html.includes('aria-expanded="false"'));
assert.ok(html.includes('aria-haspopup="true"'));
assert.ok(html.includes('>A</span>'));
assert.ok(html.includes('truncate'));
assert.ok(html.includes('max-w-[120px]'));
assert.ok(!html.includes('MoreVertical'));
assert.ok(render({ username: "reader", nickname: " " }).includes('aria-label="User menu reader"'));
assert.ok(render({ username: "reader" }).includes('>R</span>'));
assert.ok(render({ username: "reader", nickname: " Alice " }).includes('title="Alice"'));
assert.ok(render({ username: "reader", nickname: "Alice" }, true).includes('aria-expanded="true"'));
assert.ok(render({ username: "reader", nickname: "Alice" }, true).includes('rotate-180'));
const nickname = "Long nickname ".repeat(20);
assert.ok(render({ username: "reader", nickname }).includes(`title="${nickname.trim()}"`));
assert.ok(render({ username: "reader", nickname: "\u5c0f\u660e" }).includes('>\u5c0f</span>'));
assert.ok(render({ username: "reader", nickname: "<script>test</script>" }).includes('&lt;script&gt;test&lt;/script&gt;'));
assert.ok(render(null).includes('lucide-user-round'));
console.log("User menu button tests passed.");
