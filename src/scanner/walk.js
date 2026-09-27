import fs from "node:fs";
import path from "node:path";

const DEFAULT_IGNORES = new Set([
  "node_modules", ".git", ".rune", "dist", "build", ".next", "coverage", ".turbo", ".cache",
]);

const CODE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]);
const SHELL_EXTENSIONS = new Set([".sh", ".bash"]);
const CONFIG_EXTENSIONS = new Set([".toml", ".yaml", ".yml", ".json", ".jsonc"]);
const CONFIG_FILENAME_EXCLUDES = new Set(["package.json", "package-lock.json", "npm-shrinkwrap.json"]);
const MARKDOWN_EXTENSIONS = new Set([".md", ".mdx"]);
const LUA_EXTENSIONS = new Set([".lua"]);
const ENV_FILENAME_RE = /^\.env(\..+)?$/i;
const ALLOWED_DOTFILE_RE = ENV_FILENAME_RE;

export const BUILTIN_EXTENSIONS = new Set([
  ...CODE_EXTENSIONS, ...SHELL_EXTENSIONS, ...CONFIG_EXTENSIONS, ...MARKDOWN_EXTENSIONS, ...LUA_EXTENSIONS,
]);

function buildIgnoreMatcher(patterns) {
  const exact = new Set();
  const pathPrefixes = [];
  const globRes = [];
  for (const raw of patterns) {
    const p = String(raw).replace(/\\/g, "/").replace(/^\.\//, "");
    if (p.includes("*")) {
      const escaped = p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
      globRes.push(new RegExp(`^${escaped}$`));
    } else if (p.includes("/")) {
      pathPrefixes.push(p.replace(/\/+$/, ""));
    } else {
      exact.add(p);
    }
  }
  return function isIgnored(name, relPath) {
    if (exact.has(name)) return true;
    const normalizedRel = relPath.replace(/\\/g, "/");
    for (const prefix of pathPrefixes) {
      if (normalizedRel === prefix || normalizedRel.startsWith(prefix + "/")) return true;
    }
    for (const re of globRes) {
      if (re.test(name) || re.test(normalizedRel)) return true;
    }
    return false;
  };
}

export function walkSourceFiles(rootDir, opts = {}) {
  const isIgnored = buildIgnoreMatcher([...DEFAULT_IGNORES, ...(opts.ignore || [])]);
  const results = [];
  const shellFiles = [];
  const configFiles = [];
  const markdownFiles = [];
  const luaFiles = [];
  const envFiles = [];
  const extra = opts.extraExtensions || {};
  const extraBuckets = {};
  const stats = { filesDiscovered: 0, filesSupported: 0, filesSkippedUnsupportedExtension: 0 };

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const name = entry.name;
      const full = path.join(dir, name);
      const relPath = path.relative(rootDir, full).split(path.sep).join("/");

      if (entry.isSymbolicLink && entry.isSymbolicLink()) continue;

      const isDotfile = name.startsWith(".");
      if (entry.isDirectory()) {
        if (isDotfile) continue;
        if (isIgnored(name, relPath)) continue;
        walk(full);
        continue;
      }

      if (entry.isFile()) {
        if (isDotfile && !ALLOWED_DOTFILE_RE.test(name)) continue;
        if (isIgnored(name, relPath)) continue;

        stats.filesDiscovered += 1;
        const ext = path.extname(name);
        if (ALLOWED_DOTFILE_RE.test(name)) {
          envFiles.push(full);
          stats.filesSupported += 1;
        } else if (CODE_EXTENSIONS.has(ext)) {
          results.push(full);
          stats.filesSupported += 1;
        } else if (SHELL_EXTENSIONS.has(ext)) {
          shellFiles.push(full);
          stats.filesSupported += 1;
        } else if (CONFIG_EXTENSIONS.has(ext) && !CONFIG_FILENAME_EXCLUDES.has(name)) {
          configFiles.push(full);
          stats.filesSupported += 1;
        } else if (CONFIG_EXTENSIONS.has(ext) && CONFIG_FILENAME_EXCLUDES.has(name)) {
          stats.filesSkippedUnsupportedExtension += 1;
        } else if (MARKDOWN_EXTENSIONS.has(ext)) {
          markdownFiles.push(full);
          stats.filesSupported += 1;
        } else if (LUA_EXTENSIONS.has(ext)) {
          luaFiles.push(full);
          stats.filesSupported += 1;
        } else if (extra[ext.toLowerCase()]) {
          const bucket = extra[ext.toLowerCase()];
          (extraBuckets[bucket] = extraBuckets[bucket] || []).push(full);
          stats.filesSupported += 1;
        } else {
          stats.filesSkippedUnsupportedExtension += 1;
        }
      }
    }
  }

  walk(rootDir);
  return { files: results, shellFiles, configFiles, markdownFiles, luaFiles, envFiles, ...extraBuckets, stats };
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
  } catch {}
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const NEXT_CONFIG_FILES = ["next.config.js", "next.config.ts", "next.config.mjs"];
  const hasNext = Boolean(deps.next) || NEXT_CONFIG_FILES.some((f) => fs.existsSync(path.join(rootDir, f)));
  const hasExpress = Boolean(deps.express);
  const hasReact = Boolean(deps.react);
  return { pkg, deps, hasNext, hasExpress, hasReact };
}
