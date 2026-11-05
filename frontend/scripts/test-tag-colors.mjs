import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { Tag, X } from "lucide-react";

const helperSource = ts.transpileModule(fs.readFileSync(new URL("../src/lib/tag-color.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
function loadHelper(css) {
  const module = { exports: {} };
  vm.runInNewContext(helperSource, { module, exports: module.exports, ...(css ? { CSS: css } : {}) });
  return module.exports.getTagColorStyle;
}
const getTagColorStyle = loadHelper();
const plain = (value) => value === undefined ? undefined : { ...value };

for (const [input, color, backgroundColor] of [
  ["#123456", "#123456", "rgba(18, 52, 86, 0.15)"],
  [" #aBc ", "#aBc", "rgba(170, 187, 204, 0.15)"],
  ["#1234", "#1234", "rgba(17, 34, 51, 0.04)"],
  ["#11223380", "#11223380", "rgba(17, 34, 51, 0.0753)"],
  ["#F00F", "#F00F", "rgba(255, 0, 0, 0.15)"],
  ["#0000", "#0000", "rgba(0, 0, 0, 0)"],
  ["#10203000", "#10203000", "rgba(16, 32, 48, 0)"],
]) {
  assert.deepEqual(plain(getTagColorStyle(input)), { color, backgroundColor }, `${input} preserves its color and multiplies its original alpha by 0.15`);
}
for (const input of [
  undefined, null, true, 42, [], {}, { toString() { throw new Error("Do not coerce unknown input"); } },
  "", "   ", "default", " DEFAULT ", "inherit", "INITIAL", "unset", "revert", "revert-layer", "currentColor",
  "#12", "#12345", "#1234567", "#123456789", "#ggg", "not-a-color", "red; background: black", "url(https://example.invalid)",
]) {
  assert.equal(getTagColorStyle(input), undefined, "Absent, invalid and non-concrete colors preserve the caller's fallback classes");
}
for (const input of ["red", "rgb(10 20 30 / 50%)", "hsl(120 50% 40%)"]) {
  assert.equal(getTagColorStyle(input), undefined, "Without browser validation, non-hex colors retain the existing fallback");
}

const supportedColors = new Set(["rebeccapurple", "rgb(10 20 30 / 50%)", "hsl(120 50% 40%)"]);
const supportCalls = [];
const browserStyle = loadHelper({
  supports(property, value) {
    supportCalls.push([property, value]);
    if (property === "color") return supportedColors.has(value);
    return [...supportedColors].some((color) => property === "background-color" && value === `color-mix(in srgb, ${color} 15%, transparent)`);
  },
});
for (const color of supportedColors) {
  supportCalls.length = 0;
  const backgroundColor = `color-mix(in srgb, ${color} 15%, transparent)`;
  assert.deepEqual(plain(browserStyle(` ${color} `)), { color, backgroundColor });
  assert.deepEqual(supportCalls, [["color", color], ["background-color", backgroundColor]], "The complete named/rgb/hsl expression is validated and mixed without corrupting its syntax or alpha");
}
assert.equal(browserStyle("invalid-color"), undefined);
assert.equal(loadHelper({ supports: (property) => property === "color" })("red"), undefined, "Unsupported color-mix falls back even if the foreground color is valid");
let validationCalls = 0;
const permissiveBrowser = loadHelper({ supports() { validationCalls++; return true; } });
for (const input of ["default", "inherit", "currentColor", "var(--accent)", "env(theme-color)"]) {
  assert.equal(permissiveBrowser(input), undefined, "Dynamic values must not bypass the established tag fallback");
}
assert.equal(validationCalls, 0);
for (const input of ["#123456", "#abc8", "#11223380", "rebeccapurple", "rgb(10 20 30 / 50%)", "invalid-color", null]) {
  assert.equal(permissiveBrowser(input, true), undefined, "Excluded tags always retain their muted, struck-through appearance");
}
assert.equal(validationCalls, 0, "Excluded tags do not require browser color support");

// Render the actual tag map callbacks in the series/group/panel UI. Extract by
// their data sources, so removing a style binding makes the rendered assertion
// fail instead of merely causing the test to skip an absent helper call.
for (const [file, sourceExpression, expectedMaps] of [
  ["../src/app/series/[id]/page.tsx", "series.tags", 1],
  ["../src/app/group/[id]/page.tsx", "groupTags", 2],
  ["../src/components/GroupDetailPanel.tsx", "groupTags", 1],
]) {
  const content = fs.readFileSync(new URL(file, import.meta.url), "utf8");
  const parsed = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const callbacks = [];
  const containsJsx = (node) => ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || !!ts.forEachChild(node, containsJsx);
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === "map" && node.expression.expression.getText(parsed) === sourceExpression
      && node.arguments[0] && containsJsx(node.arguments[0])) {
      callbacks.push(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.equal(callbacks.length, expectedMaps, `${file} has the expected tag rendering surfaces`);
  for (const callback of callbacks) {
    const module = { exports: {} };
    const executable = ts.transpileModule(`module.exports.renderTag = (${callback.getText(parsed)});`, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    vm.runInNewContext(executable, {
      module, exports: module.exports, getTagColorStyle, Tag, X,
      series: { canManage: false }, isAdmin: false, tagSaving: false, tagLoading: false, tagLoadError: false,
      handleRemoveTag() {}, handleRemoveGroupTag() {},
      require(name) { assert.equal(name, "react/jsx-runtime"); return jsxRuntime; },
    });
    const renderTag = (color) => renderToStaticMarkup(module.exports.renderTag({ id: 1, name: "Visible tag", color }));
    const custom = renderTag("#37a8");
    assert.ok(custom.includes("Visible tag"));
    assert.ok(custom.includes("color:#37a8"), `${file} renders the saved foreground color`);
    assert.ok(custom.includes("background-color:rgba(51, 119, 170, 0.08)"), `${file} renders the saved alpha with the faint tag background`);
    const fallback = renderTag("default");
    assert.ok(!fallback.includes("style="), `${file} leaves default colors to its existing classes`);
    assert.ok(fallback.includes("text-accent"));
    assert.ok(!renderTag("bad-color").includes("style="), `${file} preserves fallback styling for invalid saved colors`);
  }
}

console.log("Tag color parsing, alpha, browser validation, excluded fallbacks, and series/group/panel rendering tests passed.");
