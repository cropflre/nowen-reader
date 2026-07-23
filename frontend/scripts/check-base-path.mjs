import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const sourceRoot = path.resolve("src");
const violations = [];

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(target);
    return /\.(ts|tsx)$/.test(entry.name) ? [target] : [];
  });
}

function isApiPathCall(node) {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "apiPath"
  );
}

function containsUnsafeRootApiLiteral(node) {
  let unsafe = false;

  function visit(current, insideApiPath) {
    const nextInsideApiPath = insideApiPath || isApiPathCall(current);
    if (
      (ts.isStringLiteral(current) ||
        ts.isNoSubstitutionTemplateLiteral(current) ||
        ts.isTemplateHead(current) ||
        ts.isTemplateMiddle(current) ||
        ts.isTemplateTail(current)) &&
      (current.text === "/api" || current.text.startsWith("/api/")) &&
      !nextInsideApiPath
    ) {
      unsafe = true;
      return;
    }
    ts.forEachChild(current, (child) => visit(child, nextInsideApiPath));
  }

  visit(node, false);
  return unsafe;
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function report(file, sourceFile, node, message) {
  violations.push(`${path.relative(process.cwd(), file)}:${lineOf(sourceFile, node)} ${message}`);
}

for (const file of walk(sourceRoot)) {
  const source = fs.readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const isApiClient = file.endsWith(path.join("lib", "apiClient.ts"));

  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "fetch" &&
      node.arguments.length > 0 &&
      !isApiClient &&
      !isApiPathCall(node.arguments[0])
    ) {
      report(file, sourceFile, node, "fetch() must wrap its URL with apiPath()");
    }

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "sendBeacon" &&
      node.arguments.length > 0 &&
      !isApiPathCall(node.arguments[0])
    ) {
      report(file, sourceFile, node, "sendBeacon() must wrap its URL with apiPath()");
    }

    if (ts.isJsxAttribute(node) && (node.name.text === "src" || node.name.text === "href")) {
      const initializer = node.initializer;
      if (
        initializer &&
        ts.isStringLiteral(initializer) &&
        (initializer.text === "/api" || initializer.text.startsWith("/api/"))
      ) {
        report(file, sourceFile, node, `JSX ${node.name.text} must not use a root /api URL`);
      }
      if (
        initializer &&
        ts.isJsxExpression(initializer) &&
        initializer.expression &&
        containsUnsafeRootApiLiteral(initializer.expression)
      ) {
        report(file, sourceFile, node, `JSX ${node.name.text} must wrap /api URLs with apiPath()`);
      }
    }

    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      node.text.includes("url(/api")
    ) {
      report(file, sourceFile, node, "CSS URL must not reference root /api");
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

if (violations.length > 0) {
  console.error("Base Path safety check failed:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log("Base Path safety check passed.");
