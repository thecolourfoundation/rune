import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Injected at build time by scripts/build-binary.sh (esbuild --define).
// Undefined when running from source, where package.json is read instead.
const BUILD_VERSION =
  typeof __RUNE_VERSION__ !== "undefined" ? __RUNE_VERSION__ : null;
let cached;

/** Rune's version: build-time constant in the binary, package.json from source. */
export function getVersion() {
  if (cached) return cached;
  if (BUILD_VERSION) return (cached = BUILD_VERSION);
  try {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(
      fs.readFileSync(path.join(dir, "..", "package.json"), "utf8")
    );
    cached = pkg.version || "0.0.0";
  } catch {
    cached = "0.0.0";
  }
  return cached;
}
