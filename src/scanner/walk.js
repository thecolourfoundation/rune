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
 * Recursively walks a directory, returning absolute paths of source files.
 * @param {string} rootDir
 * @param {{ ignore?: string[] }} opts
 * @returns {string[]}
 */
export function walkSourceFiles(rootDir, opts = {}) {
  const ignore = new Set([...DEFAULT_IGNORES, ...(opts.ignore || [])]);
  const results = [];

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const name = entry.name;

      // Never traverse into or read dotfiles/dot-directories (.env, .git, .ssh,
      // editor config, etc). There is no exception for this: a file like
      // `.env.js` would otherwise pass the CODE_EXTENSIONS check below and have
      // its contents (including secrets) embedded as evidence snippets in the
      // understanding graph.
      if (name.startsWith(".")) continue;
      if (ignore.has(name)) continue;

      // Dirent reflects the entry itself (lstat semantics), so symlinks are
      // already reported as neither isDirectory() nor isFile() and are
      // skipped below. We check explicitly anyway so that stays true even if
      // the underlying behavior ever changes.
      if (entry.isSymbolicLink && entry.isSymbolicLink()) continue;

      const full = path.join(dir, name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        if (CODE_EXTENSIONS.has(path.extname(name))) {
          results.push(full);
        }
      }
    }
  }

  walk(rootDir);
  return results;
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

  const hasNext = Boolean(deps.next) || fs.existsSync(path.join(rootDir, "next.config.js")) || fs.existsSync(path.join(rootDir, "next.config.ts")) || fs.existsSync(path.join(rootDir, "next.config.mjs"));
  const hasExpress = Boolean(deps.express);
  const hasReact = Boolean(deps.react);

  return { pkg, deps, hasNext, hasExpress, hasReact };
}
