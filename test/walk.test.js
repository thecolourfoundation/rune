import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { walkSourceFiles } from "../src/scanner/walk.js";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "rune-walk-test-"));
}

test("returns both files array and stats object", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "app.js"), "// js file\n");
  const result = walkSourceFiles(dir);
  assert.ok(Array.isArray(result.files));
  assert.ok(typeof result.stats === "object");
});

test("filesSupported counts only JS/TS-family files, matching the returned files array length", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "app.js"), "// js\n");
  fs.writeFileSync(path.join(dir, "app.ts"), "// ts\n");
  fs.writeFileSync(path.join(dir, "readme.md"), "# not code\n");

  const { files, stats } = walkSourceFiles(dir);

  assert.equal(files.length, 2);
  assert.equal(stats.filesSupported, 2);
});

test("REGRESSION: filesDiscovered counts non-JS files too, so a Go/Python-only repo's zero JS files is explainable, not silent", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "main.go"), "package main\n");
  fs.writeFileSync(path.join(dir, "utils.py"), "def f(): pass\n");
  fs.writeFileSync(path.join(dir, "README.md"), "# readme\n");

  const { files, stats } = walkSourceFiles(dir);

  assert.equal(files.length, 0);
  assert.equal(stats.filesSupported, 0);
  assert.equal(stats.filesDiscovered, 3, "the files existed and were seen, even though none are supported languages");
  assert.equal(stats.filesSkippedUnsupportedExtension, 3);
});

test("ignored directories are not counted in filesDiscovered at all", () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, "node_modules"));
  fs.writeFileSync(path.join(dir, "node_modules", "lib.js"), "// dep\n");
  fs.writeFileSync(path.join(dir, "app.js"), "// app\n");

  const { stats } = walkSourceFiles(dir);

  assert.equal(stats.filesDiscovered, 1, "node_modules contents should never be counted");
});
