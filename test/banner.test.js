import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runeBin = path.join(__dirname, "..", "bin", "rune.js");

test("`rune serve` prints the RUNE banner before starting the MCP server", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rune-banner-test-"));
  fs.writeFileSync(path.join(dir, "app.js"), `export function greet() {\n  return "hi";\n}\n`);

  // `rune serve` runs forever (stdio MCP server) -- spawn it with a short
  // timeout to capture startup output, then let the timeout kill it. We
  // only care that the banner text appears in the initial output, not
  // that the process exits on its own.
  const result = spawnSync("node", [runeBin, "serve", dir], {
    encoding: "utf8",
    timeout: 1500,
  });

  const output = (result.stdout || "") + (result.stderr || "");
  assert.match(output, /RUNE/);
});

test("`rune watch` prints the RUNE banner before entering watch mode", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rune-banner-watch-test-"));
  fs.writeFileSync(path.join(dir, "app.js"), `export function greet() {\n  return "hi";\n}\n`);

  const result = spawnSync("node", [runeBin, "watch", dir], {
    encoding: "utf8",
    timeout: 1500,
  });

  const output = (result.stdout || "") + (result.stderr || "");
  assert.match(output, /RUNE/);
});
