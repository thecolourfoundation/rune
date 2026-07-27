import path from "node:path";
import { buildLineIndex, lineNumberAt } from "./lines.js";

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
const HOOK_USAGE_RE = /\b(use[A-Z][A-Za-z0-9_]*)\s*\(/g;
const JSX_LOOKAHEAD_WINDOW_LINES = 40;
const EVIDENCE_MAX_CHARS = 160;

export function extractFileFacts(filePath, content, rootDir, nextId) {
  const relPath = path.relative(rootDir, filePath);
  const facts = [];
  const lines = content.split("\n");
  const lineOffsets = buildLineIndex(content);
  const lineOf = (index) => lineNumberAt(lineOffsets, index);
  const evidenceAt = (ln) => lines[ln - 1]?.trim().slice(0, EVIDENCE_MAX_CHARS) || "";

  // Imports (ESM `import` and CJS `require`)
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
        evidence: evidenceAt(ln),
      });
    }
  }

  // React components: function declarations and arrow-function assignments
  for (const re of [FUNCTION_COMPONENT_RE, ARROW_COMPONENT_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content))) {
      const ln = lineOf(m.index);
      const windowText = lines.slice(ln - 1, ln + JSX_LOOKAHEAD_WINDOW_LINES).join("\n");
      if (JSX_TAG_RE.test(windowText)) {
        facts.push({
          id: nextId("component"),
          type: "react_component",
          kind: "function",
          file: relPath,
          line: ln,
          name: m[1],
          evidence: evidenceAt(ln),
        });
      }
    }
  }

  // React components: classes
  CLASS_COMPONENT_RE.lastIndex = 0;
  let classMatch;
  while ((classMatch = CLASS_COMPONENT_RE.exec(content))) {
    const ln = lineOf(classMatch.index);
    facts.push({
      id: nextId("component"),
      type: "react_component",
      kind: "class",
      file: relPath,
      line: ln,
      name: classMatch[1],
      evidence: evidenceAt(ln),
    });
  }

  // Hook usage — one fact per distinct hook name per file, not per call site.
  // (Not attributed to a specific enclosing component in v1.)
  const hooksSeen = new Set();
  HOOK_USAGE_RE.lastIndex = 0;
  let hookMatch;
  while ((hookMatch = HOOK_USAGE_RE.exec(content))) {
    const hookName = hookMatch[1];
    if (hooksSeen.has(hookName)) continue;
    hooksSeen.add(hookName);
    const ln = lineOf(hookMatch.index);
    facts.push({
      id: nextId("hook"),
      type: "hook_usage",
      file: relPath,
      line: ln,
      name: hookName,
      evidence: evidenceAt(ln),
    });
  }

  return facts;
}
