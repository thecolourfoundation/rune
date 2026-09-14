import path from "node:path";

const FUNCTION_DEF_RE = /^\s*(?:local\s+)?function\s+([a-zA-Z_][a-zA-Z0-9_.:]*)\s*\(/;
const REQUIRE_RE = /require\s*\(?\s*["']([^"']+)["']\s*\)?/;
const COMMENT_RE = /^\s*--/;
const EVIDENCE_MAX_CHARS = 160;

function evidenceFor(lines, ln) {
  return lines[ln - 1]?.trim().slice(0, EVIDENCE_MAX_CHARS) || "";
}

export function extractLuaFacts(filePath, content, rootDir, nextId) {
  const relPath = path.relative(rootDir, filePath);
  const facts = [];
  const lines = content.split("\n");

  lines.forEach((rawLine, idx) => {
    const ln = idx + 1;
    const line = rawLine;
    if (COMMENT_RE.test(line) || line.trim() === "") return;

    const fnMatch = line.match(FUNCTION_DEF_RE);
    if (fnMatch) {
      facts.push({ id: nextId("lua_function"), type: "lua_function_def", file: relPath, line: ln, name: fnMatch[1], confidence: "high", evidence: evidenceFor(lines, ln) });
    }
    const reqMatch = line.match(REQUIRE_RE);
    if (reqMatch) {
      facts.push({ id: nextId("lua_require"), type: "lua_require", file: relPath, line: ln, target: reqMatch[1], confidence: "high", evidence: evidenceFor(lines, ln) });
    }
  });
  return facts;
}
