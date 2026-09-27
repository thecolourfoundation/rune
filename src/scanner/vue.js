import fs from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";
import { confidenceForFile } from "./confidence.js";
import { buildIgnoreMatcher, readIgnorePatterns } from "./walk.js";

const IGNORED_DIRS = new Set([
  "node_modules", ".git", ".rune", "dist", "build", ".next", "coverage", ".turbo", ".cache",
]);
const EVIDENCE_MAX_CHARS = 160;

const SCRIPT_BLOCK_RE = /<script[^>]*>([\s\S]*?)<\/script>/i;

function findExplicitName(scriptContent) {
  let ast;
  try {
    ast = parse(scriptContent, { sourceType: "module", plugins: ["typescript"], errorRecovery: true });
  } catch {
    return null;
  }

  let found = null;
  for (const stmt of ast.program.body) {
    let objExpr = null;
    if (stmt.type === "ExportDefaultDeclaration") {
      const decl = stmt.declaration;
      if (decl.type === "ObjectExpression") objExpr = decl;
      if (decl.type === "CallExpression" && decl.callee.type === "Identifier" && decl.callee.name === "defineComponent") {
        const arg = decl.arguments[0];
        if (arg && arg.type === "ObjectExpression") objExpr = arg;
      }
    }
    if (objExpr) {
      const nameProp = objExpr.properties.find(
        (p) => p.type === "ObjectProperty" && !p.computed && p.key.type === "Identifier" && p.key.name === "name"
      );
      if (nameProp && nameProp.value.type === "StringLiteral") found = nameProp.value.value;
    }
  }
  return found;
}

// FIXED (#30): now checks the user's .rune/config.json ignore patterns via
// the same matcher walk.js's main scan loop uses, in addition to the
// built-in defaults -- previously this walk only ever consulted IGNORED_DIRS.
function walkForVueFiles(dir, rootDir, isIgnored, out) {
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
    const relPath = path.relative(rootDir, full).split(path.sep).join("/");
    if (isIgnored(entry.name, relPath)) continue;
    if (entry.isDirectory()) {
      walkForVueFiles(full, rootDir, isIgnored, out);
      continue;
    }
    if (entry.name.endsWith(".vue")) out.push(full);
  }
}

export function extractVueComponents(rootDir, nextId) {
  const facts = [];
  const files = [];
  const isIgnored = buildIgnoreMatcher(readIgnorePatterns(rootDir));
  walkForVueFiles(rootDir, rootDir, isIgnored, files);

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
