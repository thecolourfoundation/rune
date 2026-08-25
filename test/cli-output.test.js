import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runeBin = path.join(__dirname, "..", "bin", "rune.js");

function tmpProjectWithSecret() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rune-scan-verdict-test-"));
  fs.writeFileSync(path.join(dir, "config.js"), `const awsKey = "AKIAIOSFODNN7EXAMPLE";\n`);
  return dir;
}

function tmpCleanProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rune-scan-verdict-clean-test-"));
  fs.writeFileSync(path.join(dir, "app.js"), `export function add(a, b) {\n  return a + b;\n}\n`);
  return dir;
}

test("`rune scan` prints a security findings summary with counts when a real secret is present", () => {
  const dir = tmpProjectWithSecret();
  const output = execFileSync("node", [runeBin, "scan", dir], { encoding: "utf8" });
  assert.match(output, /\[rune\] security findings: 1/);
  assert.match(output, /high: 1/);
  assert.match(output, /AWS Access Key ID/);
});

test("`rune scan` prints 'no findings' when the project is clean", () => {
  const dir = tmpCleanProject();
  const output = execFileSync("node", [runeBin, "scan", dir], { encoding: "utf8" });
  assert.match(output, /\[rune\] security: no findings\./);
});

test("`rune scan` still prints the standard fact/derived summary alongside the verdict", () => {
  const dir = tmpCleanProject();
  const output = execFileSync("node", [runeBin, "scan", dir], { encoding: "utf8" });
  assert.match(output, /facts: \d+, derived conclusions: \d+/);
});

test("`rune explain` with no graph gives an actionable message telling the user to scan first", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rune-explain-noscan-test-"));
  let output;
  try {
    output = execFileSync("node", [runeBin, "explain", "some_id", dir], { encoding: "utf8" });
  } catch (err) {
    output = err.stdout?.toString() || "";
  }
  assert.match(output, /Run `rune scan` first/);
});
