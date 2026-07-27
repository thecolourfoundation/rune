import path from "node:path";
import fs from "node:fs";

let counter = 0;
function nextId() {
  counter += 1;
  return `nextroute_${counter.toString(36)}`;
}

const IGNORED_PAGE_FILES = new Set(["_app", "_document", "_error", "middleware"]);

function fileToRoutePath(relPathNoExt) {
  const parts = relPathNoExt.split(path.sep).filter(Boolean);
  const routeParts = parts
    .filter((p) => p !== "index")
    .map((p) => {
      if (p.startsWith("[...") && p.endsWith("]")) return `:${p.slice(4, -1)}*`;
      if (p.startsWith("[") && p.endsWith("]")) return `:${p.slice(1, -1)}`;
      return p;
    });
  return "/" + routeParts.join("/");
}

/**
 * Detects Next.js routes from directory conventions.
 * Supports both the `pages/` router and the `app/` router.
 */
export function extractNextRoutes(rootDir) {
  const facts = [];

  const pagesDir = fs.existsSync(path.join(rootDir, "pages"))
    ? path.join(rootDir, "pages")
    : fs.existsSync(path.join(rootDir, "src", "pages"))
    ? path.join(rootDir, "src", "pages")
    : null;

  if (pagesDir) {
    walkPages(pagesDir, rootDir, facts);
  }

  const appDir = fs.existsSync(path.join(rootDir, "app"))
    ? path.join(rootDir, "app")
    : fs.existsSync(path.join(rootDir, "src", "app"))
    ? path.join(rootDir, "src", "app")
    : null;

  if (appDir) {
    walkAppRouter(appDir, rootDir, facts);
  }

  return facts;
}

function walkPages(pagesDir, rootDir, facts) {
  const entries = fs.readdirSync(pagesDir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(pagesDir, entry.name);
    if (entry.isDirectory()) {
      walkPages(full, rootDir, facts);
      continue;
    }
    const ext = path.extname(entry.name);
    if (![".js", ".jsx", ".ts", ".tsx"].includes(ext)) continue;
    const base = path.basename(entry.name, ext);
    if (IGNORED_PAGE_FILES.has(base)) continue;

    const relToPages = path.relative(pagesDir, full).replace(new RegExp(`${ext}$`), "");
    const isApi = relToPages === "api" || relToPages.startsWith(`api${path.sep}`);
    const routePath = fileToRoutePath(relToPages);

    facts.push({
      id: nextId(),
      type: isApi ? "next_api_route" : "next_page_route",
      router: "pages",
      routePath: routePath || "/",
      file: path.relative(rootDir, full),
      line: 1,
      evidence: `file convention: pages/${relToPages}${ext}`,
    });
  }
}

function walkAppRouter(dir, rootDir, facts, segments = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const isGroup = entry.name.startsWith("(") && entry.name.endsWith(")");
      const nextSegments = isGroup ? segments : [...segments, entry.name];
      walkAppRouter(full, rootDir, facts, nextSegments);
      continue;
    }
    const ext = path.extname(entry.name);
    if (![".js", ".jsx", ".ts", ".tsx"].includes(ext)) continue;
    const base = path.basename(entry.name, ext);
    const routePath = "/" + segments
      .map((s) => {
        if (s.startsWith("[...") && s.endsWith("]")) return `:${s.slice(4, -1)}*`;
        if (s.startsWith("[") && s.endsWith("]")) return `:${s.slice(1, -1)}`;
        return s;
      })
      .join("/");

    if (base === "page") {
      facts.push({
        id: nextId(),
        type: "next_page_route",
        router: "app",
        routePath: routePath || "/",
        file: path.relative(rootDir, full),
        line: 1,
        evidence: `file convention: app/${segments.join("/")}/page${ext}`,
      });
    } else if (base === "route") {
      facts.push({
        id: nextId(),
        type: "next_api_route",
        router: "app",
        routePath: routePath || "/",
        file: path.relative(rootDir, full),
        line: 1,
        evidence: `file convention: app/${segments.join("/")}/route${ext}`,
      });
    }
  }
}
