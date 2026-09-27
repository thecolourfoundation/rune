import path from "node:path";
import fs from "node:fs";
import { confidenceForFile } from "./confidence.js";
import { buildIgnoreMatcher, readIgnorePatterns } from "./walk.js";

const IGNORED_PAGE_FILES = new Set(["_app", "_document", "_error", "middleware"]);
const PAGE_EXTENSIONS = [".js", ".jsx", ".ts", ".tsx"];
const APP_ROUTER_ROUTE_BASENAMES = new Set(["page", "route"]);

function transformDynamicSegment(segment) {
  if (segment.startsWith("[[...") && segment.endsWith("]]")) return `:${segment.slice(5, -2)}*?`;
  if (segment.startsWith("[...") && segment.endsWith("]")) return `:${segment.slice(4, -1)}*`;
  if (segment.startsWith("[") && segment.endsWith("]")) return `:${segment.slice(1, -1)}`;
  return segment;
}

function segmentsToRoutePath(segments) {
  return "/" + segments.map(transformDynamicSegment).join("/");
}

export function extractNextRoutes(rootDir, nextId) {
  const facts = [];
  const isIgnored = buildIgnoreMatcher(readIgnorePatterns(rootDir));

  const pagesDir = fs.existsSync(path.join(rootDir, "pages"))
    ? path.join(rootDir, "pages")
    : fs.existsSync(path.join(rootDir, "src", "pages"))
    ? path.join(rootDir, "src", "pages")
    : null;

  if (pagesDir) walkPages(pagesDir, pagesDir, rootDir, facts, nextId, isIgnored);

  const appDir = fs.existsSync(path.join(rootDir, "app"))
    ? path.join(rootDir, "app")
    : fs.existsSync(path.join(rootDir, "src", "app"))
    ? path.join(rootDir, "src", "app")
    : null;

  if (appDir) walkAppRouter(appDir, rootDir, facts, nextId, isIgnored);

  return facts;
}

// FIXED (#30): now consults the user's .rune/config.json ignore list via
// the shared matcher, in addition to the existing dotfile skip.
function walkPages(dir, pagesRootDir, rootDir, facts, nextId, isIgnored) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    const relPath = path.relative(rootDir, full).split(path.sep).join("/");
    if (isIgnored(entry.name, relPath)) continue;
    if (entry.isDirectory()) {
      walkPages(full, pagesRootDir, rootDir, facts, nextId, isIgnored);
      continue;
    }
    const ext = path.extname(entry.name);
    if (!PAGE_EXTENSIONS.includes(ext)) continue;
    const base = path.basename(entry.name, ext);
    if (IGNORED_PAGE_FILES.has(base)) continue;

    const relToPagesWithExt = path.relative(pagesRootDir, full);
    const relToPages = relToPagesWithExt.slice(0, -ext.length);
    const isApi = relToPages === "api" || relToPages.startsWith(`api${path.sep}`);
    const segments = relToPages.split(path.sep).filter((p) => p !== "index");
    const routePath = segmentsToRoutePath(segments);
    const relPath2 = path.relative(rootDir, full);

    facts.push({
      id: nextId("nextroute"),
      type: isApi ? "next_api_route" : "next_page_route",
      router: "pages",
      routePath,
      file: relPath2,
      line: 1,
      confidence: confidenceForFile(relPath2),
      evidence: `file convention: pages/${relToPagesWithExt}`,
    });
  }
}

function walkAppRouter(dir, rootDir, facts, nextId, isIgnored, segments = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    const relPath = path.relative(rootDir, full).split(path.sep).join("/");
    if (isIgnored(entry.name, relPath)) continue;
    if (entry.isDirectory()) {
      const isRouteGroup = entry.name.startsWith("(") && entry.name.endsWith(")");
      const nextSegments = isRouteGroup ? segments : [...segments, entry.name];
      walkAppRouter(full, rootDir, facts, nextId, isIgnored, nextSegments);
      continue;
    }
    const ext = path.extname(entry.name);
    if (!PAGE_EXTENSIONS.includes(ext)) continue;
    const base = path.basename(entry.name, ext);
    if (!APP_ROUTER_ROUTE_BASENAMES.has(base)) continue;

    const routePath = segmentsToRoutePath(segments);
    const relPath2 = path.relative(rootDir, full);
    facts.push({
      id: nextId("nextroute"),
      type: base === "page" ? "next_page_route" : "next_api_route",
      router: "app",
      routePath,
      file: relPath2,
      line: 1,
      confidence: confidenceForFile(relPath2),
      evidence: `file convention: app/${segments.join("/")}/${base}${ext}`,
    });
  }
}
