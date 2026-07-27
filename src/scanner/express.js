import path from "node:path";
import { buildLineIndex, lineNumberAt } from "./lines.js";

let counter = 0;
function nextId() {
  counter += 1;
  return `route_${counter.toString(36)}`;
}

const ROUTE_RE = /\b(app|router)\.(get|post|put|delete|patch|use|all)\(\s*['"`]([^'"`]+)['"`]/g;

/**
 * Extracts Express route facts from a file's raw content.
 * Heuristic: matches `app.<method>('/path', ...)` and `router.<method>('/path', ...)`.
 * Does not resolve router mount prefixes across files in v1 (documented limitation).
 */
export function extractExpressRoutes(filePath, content, rootDir) {
  const relPath = path.relative(rootDir, filePath);
  const facts = [];
  const lines = content.split("\n");
  const lineOffsets = buildLineIndex(content);
  const lineOf = (index) => lineNumberAt(lineOffsets, index);

  ROUTE_RE.lastIndex = 0;
  let m;
  while ((m = ROUTE_RE.exec(content))) {
    const [, receiver, method, routePath] = m;
    if (method === "use" && !routePath.startsWith("/")) continue;
    const ln = lineOf(m.index);
    facts.push({
      id: nextId(),
      type: "express_route",
      method: method.toUpperCase(),
      routePath,
      receiver,
      file: relPath,
      line: ln,
      evidence: lines[ln - 1]?.trim().slice(0, 160) || "",
    });
  }
  return facts;
}
