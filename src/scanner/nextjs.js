import path from "node:path";
import fs from "node:fs";

const IGNORED_PAGE_FILES = new Set(["_app", "_document", "_error", "middleware"]);
const PAGE_EXTENSIONS = [".js", ".jsx", ".ts", ".tsx"];
// Files the app router treats as special per-segment conventions but that
// are not themselves routes (layout/loading/error/etc). Only "page" and
// "route" define a navigable route or endpoint.
const APP_ROUTER_ROUTE_BASENAMES = new Set(["page", "route"]);

/**
 * Converts one path segment into its route-pattern form, e.g.
 * "[id]" -> ":id", "[...slug]" -> ":slug*", anything else -> itself.
 * Shared by both the pages router and the app router so the bracket-syntax
 * rule is defined in exactly one place.
 */
function transformDynamicSegment(segment) {
  if (segment.startsWith("[...") && segment.endsWith("]")) return `:${segment.slice(4, -1)}*`;
  if (segment.startsWith("[") && segment.endsWith("]")) return `:${segment.slice(1, -1)}`;
  return segment;
}

function segmentsToRoutePath(segments) {
  return "/" + segments.map(transformDynamicSegment).join("/");
}

/**
 * Detects Next.js routes from directory conventions.
 * Supports both the `pages/` router and the `app/` router.
 */
export function extractNextRoutes(rootDir, nextId) {
  const facts = [];

  const pagesDir = fs.existsSync(path.join(rootDir, "pages"))
    ? path.join(rootDir, "pages")
    : fs.existsSync(path.join(rootDir, "src", "pages"))
    ? path.join(rootDir, "src", "pages")
    : null;

  if (pagesDir) {
    walkPages(pagesDir, rootDir, facts, nextId);
  }

  const appDir = fs.existsSync(path.join(rootDir, "app"))
    ? path.join(rootDir, "app")
    : fs.existsSync(path.join(rootDir, "src", "app"))
    ? path.join(rootDir, "src", "app")
    : null;

  if (appDir) {
    walkAppRouter(appDir, rootDir, facts, nextId);
  }

  return facts;
}

function walkPages(pagesDir, rootDir, facts, nextId) {
  const entries = fs.readdirSync(pagesDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(pagesDir, entry.name);
    if (entry.isDirectory()) {
      walkPages(full, rootDir, facts, nextId);
      continue;
    }
    const ext = path.extname(entry.name);
    if (!PAGE_EXTENSIONS.includes(ext)) continue;
    const base = path.basename(entry.name, ext);
    if (IGNORED_PAGE_FILES.has(base)) continue;

    const relToPagesWithExt = path.relative(pagesDir, full);
    const relToPages = relToPagesWithExt.slice(0, -ext.length);
    const isApi = relToPages === "api" || relToPages.startsWith(`api${path.sep}`);
    const segments = relToPages.split(path.sep).filter((p) => p !== "index");
    const routePath = segmentsToRoutePath(segments);

    facts.push({
      id: nextId("nextroute"),
      type: isApi ? "next_api_route" : "next_page_route",
      router: "pages",
      routePath,
      file: path.relative(rootDir, full),
      line: 1,
      evidence: `file convention: pages/${relToPagesWithExt}`,
    });
  }
}

function walkAppRouter(dir, rootDir, facts, nextId, segments = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const isRouteGroup = entry.name.startsWith("(") && entry.name.endsWith(")");
      const nextSegments = isRouteGroup ? segments : [...segments, entry.name];
      walkAppRouter(full, rootDir, facts, nextId, nextSegments);
      continue;
    }
    const ext = path.extname(entry.name);
    if (!PAGE_EXTENSIONS.includes(ext)) continue;
    const base = path.basename(entry.name, ext);
    if (!APP_ROUTER_ROUTE_BASENAMES.has(base)) continue;

    const routePath = segmentsToRoutePath(segments);
    facts.push({
      id: nextId("nextroute"),
      type: base === "page" ? "next_page_route" : "next_api_route",
      router: "app",
      routePath,
      file: path.relative(rootDir, full),
      line: 1,
      evidence: `file convention: app/${segments.join("/")}/${base}${ext}`,
    });
  }
}
