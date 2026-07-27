import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let cached;

/**
 * Reads the version from this package's own package.json, once, and caches
 * it. Every place that needs Rune's version (the understanding graph's
 * meta.rune field, the MCP server's reported version, `rune --version`)
 * calls this instead of hardcoding a string that will silently drift from
 * package.json the next time it's bumped.
 */
export function getVersion() {
  if (cached) return cached;
  const pkgPath = path.join(__dirname, "..", "package.json");
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    cached = pkg.version || "0.0.0";
  } catch {
    cached = "0.0.0";
  }
  return cached;
}
