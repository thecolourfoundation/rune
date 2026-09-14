import fs from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";
import { confidenceForFile } from "./confidence.js";

const IGNORED_DIRS = new Set([
  "node_modules", ".git", ".rune", "dist", "build", ".next", "coverage", ".turbo", ".cache",
]);
const EVIDENCE_MAX_CHARS = 160;

/**
 * Vue SFC component detection. Regex-extracts the <script> or <script
 * setup> block content (there is no @vue/compiler-sfc dependency in this
 * project, so full SFC parsing is out of scope) and runs that JS through
 * the same Babel parser as the rest of the scanner. Component naming
 * follows Vue SFC convention: an explicit `name:` in export default / a
 * defineComponent(...) call wins if present, otherwise the component name
 * is the file's base name (the convention <script setup> relies on).
 *
 * This is intentionally shallower than the JSX component detection in
 * facts.js -- it identifies that a file IS a Vue component and where, not
 * its internal structure (props, emits, composables used, etc). That
 * depth is a natural follow-up once this first pass is validated against
 * real Vue codebases. Documented limitation, not a silent gap.
 *
 * Does its own directory walk rather than plugging into the shared
 * per-file scanner loop in build.js, following the same pattern nextjs.js
 * already uses for its own directory-convention-based extraction.
 */

const SCRIPT_BLOCK_RE = /<script[^>]*>([\s\S]*?)<\/script>/i;

function findExplicitName(scriptContent) {
  let ast;
  try {
    ast = parse(scriptContent, {
      sourceType: "module",
      plugins: ["typescript"],
      errorRecovery: true,
    });
  } catch {
    return null;
  }

  let found = null;
  // A shallow, non-traversing scan of top-level statements is enough here:
  // `name:` in an SFC's default export or a defineComponent(...) call is
  // always a direct top-level property, never nested inside other logic.
  for (const stmt of ast.program.body) {
    let objExpr = null;
    if (stmt.type === "ExportDefaultDeclaration") {
      const decl = stmt.declaration;
      if (decl.type === "ObjectExpression") objExpr = decl;
      if (
        decl.type === "CallExpression" &&
        decl.callee.type === "Identifier" &&
        decl.callee.name === "defineComponent"
      ) {
        const arg = decl.arguments[0];
        if (arg && arg.type === "ObjectExpression") objExpr = arg;
      }
    }
    if (objExpr) {
      const nameProp = objExpr.properties.find(
        (p) =>
          p.type === "ObjectProperty" &&
          !p.computed &&
          p.key.type === "Identifier" &&
          p.key.name === "name"
      );
      if (nameProp && nameProp.value.type === "StringLiteral") {
        found = nameProp.value.value;
      }
    }
  }
  return found;
}

function walkForVueFiles(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkForVueFiles(full, out);
      continue;
    }
    if (entry.name.endsWith(".vue")) out.push(full);
  }
}

export function extractVueComponents(rootDir, nextId) {
  const facts = [];
  const files = [];
  walkForVueFiles(rootDir, files);

  for (const filePath of files) {
    const relPath = path.relative(rootDir, filePath);
    let content;
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }

    const scriptMatch = SCRIPT_BLOCK_RE.exec(content);
    const explicitName = scriptMatch ? findExplicitName(scriptMatch[1]) : null;
    const name = explicitName || path.basename(filePath, ".vue");

    const lines = content.split("\n");
    const scriptLine = scriptMatch ? content.slice(0, scriptMatch.index).split("\n").length + 1 : 1;

    facts.push({
      id: nextId("component"),
      type: "vue_component",
      file: relPath,
      line: scriptLine,
      name,
      confidence: confidenceForFile(relPath),
      evidence: lines[scriptLine - 1]?.trim().slice(0, EVIDENCE_MAX_CHARS) || "",
    });
  }

  return facts;
}
