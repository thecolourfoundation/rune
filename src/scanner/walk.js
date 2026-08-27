import fs from "node:fs";
import path from "node:path";

const DEFAULT_IGNORES = new Set([
  "node_modules",
  ".git",
  ".rune",
  "dist",
  "build",
  ".next",
  "coverage",
  ".turbo",
  ".cache",
]);

const CODE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]);

/**
 * Recursively walks a directory, returning absolute paths of source files
 * AND coverage stats about what was seen along the way.
 *
 * Previously this only returned the matched file list, with no visibility
 * into how many files existed that weren't JS/TS -- which made a
 * "0 files scanned" result on a Go/Python/C repo indistinguishable from a
 * genuine scanning bug. `stats.filesDiscovered` counts every regular file
 * entry encountered (excluding ignored dirs/dotfiles, which are a
 * deliberate, separate exclusion), so callers can report real coverage
 * ("12,804 of 18,421 files were JS/TS; the rest are unsupported
 * languages") instead of a bare, unexplained count.
 *
 * @param {string} rootDir
 * @param {{ ignore?: string[] }} opts
 * @returns {{ files: string[], stats: { filesDiscovered: number, filesSupported: number, filesSkippedUnsupportedExtension: number } }}
 */
export function walkSourceFiles(rootDir, opts = {}) {
  const ignore = new Set([...DEFAULT_IGNORES, ...(opts.ignore || [])]);
  const results = [];
  const stats = {
    filesDiscovered: 0,
    filesSupported: 0,
    filesSkippedUnsupportedExtension: 0,
  };

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const name = entry.name;

      if (name.startsWith(".")) continue;
      if (ignore.has(name)) continue;

      if (entry.isSymbolicLink && entry.isSymbolicLink()) continue;

      const full = path.join(dir, name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        stats.filesDiscovered += 1;
        if (CODE_EXTENSIONS.has(path.extname(name))) {
          results.push(full);
          stats.filesSupported += 1;
        } else {
          stats.filesSkippedUnsupportedExtension += 1;
        }
      }
    }
  }

  walk(rootDir);
  return { files: results, stats };
}

export function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

export function detectProjectKind(rootDir) {
  const pkgPath = path.join(rootDir, "package.json");
  let pkg = {};
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  } catch {
    // no package.json, or unreadable — proceed with empty deps
  }
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

  const NEXT_CONFIG_FILES = ["next.config.js", "next.config.ts", "next.config.mjs"];
  const hasNext = Boolean(deps.next) || NEXT_CONFIG_FILES.some((f) => fs.existsSync(path.join(rootDir, f)));
  const hasExpress = Boolean(deps.express);
  const hasReact = Boolean(deps.react);

  return { pkg, deps, hasNext, hasExpress, hasReact };
}
