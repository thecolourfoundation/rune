import path from "node:path";
import { buildLineIndex, lineNumberAt } from "./lines.js";

let factCounter = 0;
function nextId(prefix) {
  factCounter += 1;
  return `${prefix}_${factCounter.toString(36)}`;
}

/**
 * IMPORTANT — this is a heuristic, regex-based extractor, not a full AST parser.
 * Every fact records the exact line + matched text as evidence, so conclusions
 * stay inspectable even though extraction is approximate. Swapping in a real
 * parser (e.g. an AST library) later is a drop-in replacement for this module —
 * the fact schema below is what the rest of Rune depends on, not the method
 * used to produce it.
 */

const IMPORT_RE = /import\s+(?:type\s+)?(?:[\w*${}\s,]{0,300}?\s+from\s+)?['"]([^'"]+)['"]/g;
const REQUIRE_RE = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
const FUNCTION_COMPONENT_RE = /(?:export\s+(?:default\s+)?)?function\s+([A-Z][A-Za-z0-9_]*)\s*\(/g;
const ARROW_COMPONENT_RE = /(?:export\s+(?:default\s+)?)?const\s+([A-Z][A-Za-z0-9_]*)\s*=\s*(?:\([^)]*\)|[\w]+)\s*=>/g;
const CLASS_COMPONENT_RE = /class\s+([A-Z][A-Za-z0-9_]*)\s+extends\s+(?:React\.)?Component/g;
// Requires an actual tag shape (letter followed eventually by whitespace, "/",
// or ">") AND that the "<" isn't immediately preceded by an identifier
// character — which is what distinguishes JSX `<Item>` from a generic type
// `Array<Item>`, since both otherwise look identical to a regex.
const JSX_TAG_RE = /(?<![\w>])<([A-Za-z][\w.]*)[\s/>]/;
const HOOK_USAGE_RE = /\buse[A-Z][A-Za-z0-9_]*\s*\(/g;

export function extractFileFacts(filePath, content, rootDir) {
  const relPath = path.relative(rootDir, filePath);
  const facts = [];
  const lines = content.split("\n");
  const lineOffsets = buildLineIndex(content);
  const lineOf = (index) => lineNumberAt(lineOffsets, index);

  // Imports
  for (const re of [IMPORT_RE, REQUIRE_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content))) {
      const ln = lineOf(m.index);
      facts.push({
        id: nextId("import"),
        type: "import",
        file: relPath,
        line: ln,
        target: m[1],
        evidence: lines[ln - 1]?.trim().slice(0, 160) || "",
      });
    }
  }

  // React components: function declarations
  for (const re of [FUNCTION_COMPONENT_RE, ARROW_COMPONENT_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content))) {
      const ln = lineOf(m.index);
      // Heuristic confirmation: does the following ~40 lines contain a real JSX tag?
      const windowText = lines.slice(ln - 1, ln + 40).join("\n");
      if (JSX_TAG_RE.test(windowText)) {
        facts.push({
          id: nextId("component"),
          type: "react_component",
          kind: "function",
          file: relPath,
          line: ln,
          name: m[1],
          evidence: lines[ln - 1]?.trim().slice(0, 160) || "",
        });
      }
    }
  }

  // React components: classes
  CLASS_COMPONENT_RE.lastIndex = 0;
  {
    let m;
    while ((m = CLASS_COMPONENT_RE.exec(content))) {
      const ln = lineOf(m.index);
      facts.push({
        id: nextId("component"),
        type: "react_component",
        kind: "class",
        file: relPath,
        line: ln,
        name: m[1],
        evidence: lines[ln - 1]?.trim().slice(0, 160) || "",
      });
    }
  }

  // Hook usage (facts only — not attributed to a specific component in v1)
  const hooksSeen = new Set();
  HOOK_USAGE_RE.lastIndex = 0;
  {
    let m;
    while ((m = HOOK_USAGE_RE.exec(content))) {
      const hookName = m[0].replace(/\($/, "").trim();
      if (hooksSeen.has(hookName)) continue;
      hooksSeen.add(hookName);
      const ln = lineOf(m.index);
      facts.push({
        id: nextId("hook"),
        type: "hook_usage",
        file: relPath,
        line: ln,
        name: hookName,
        evidence: lines[ln - 1]?.trim().slice(0, 160) || "",
      });
    }
  }

  return facts;
}
