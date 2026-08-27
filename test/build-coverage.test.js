import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildGraph } from "../src/graph/build.js";

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "rune-coverage-test-"));
}

test("meta.coverage reports filesDiscovered/filesSupported/filesScanned correctly on a small mixed-language repo", () => {
  const dir = tmpProject();
  fs.writeFileSync(path.join(dir, "app.js"), `export function greet() {\n  return "hi";\n}\n`);
  fs.writeFileSync(path.join(dir, "main.go"), "package main\n");
  fs.writeFileSync(path.join(dir, "README.md"), "# readme\n");

  const graph = buildGraph(dir);

  assert.equal(graph.meta.coverage.filesDiscovered, 3);
  assert.equal(graph.meta.coverage.filesSupported, 1);
  assert.equal(graph.meta.coverage.filesScanned, 1);
  assert.equal(graph.meta.status, "success");
});

test("REGRESSION: a repo with only non-JS/TS files reports status 'no_supported_files' with real coverage numbers, not a bare 0", () => {
  const dir = tmpProject();
  fs.writeFileSync(path.join(dir, "main.go"), "package main\n");
  fs.writeFileSync(path.join(dir, "lib.go"), "package lib\n");

  const graph = buildGraph(dir);

  assert.equal(graph.meta.status, "no_supported_files");
  assert.equal(graph.meta.coverage.filesDiscovered, 2);
  assert.equal(graph.meta.coverage.filesSupported, 0);
});

test("REGRESSION: exceeding maxScanMs produces status 'timeout' with partial results, never hangs", () => {
  const dir = tmpProject();
  for (let i = 0; i < 20; i++) {
    fs.writeFileSync(path.join(dir, `file${i}.js`), `export function f${i}() { return ${i}; }\n`);
  }

  const graph = buildGraph(dir, { maxScanMs: 0 });

  assert.equal(graph.meta.status, "timeout");
  assert.ok(graph.meta.coverage.filesScanned < graph.meta.coverage.filesSupported);
});

test("no maxScanMs option means no self-imposed timeout -- a normal scan completes as 'success'", () => {
  const dir = tmpProject();
  fs.writeFileSync(path.join(dir, "app.js"), `export function greet() {\n  return "hi";\n}\n`);

  const graph = buildGraph(dir);

  assert.equal(graph.meta.status, "success");
});

test("onProgress callback fires when scanning enough files to cross the reporting threshold", () => {
  const dir = tmpProject();
  for (let i = 0; i < 205; i++) {
    fs.writeFileSync(path.join(dir, `file${i}.js`), `export function f${i}() { return ${i}; }\n`);
  }

  let calls = 0;
  buildGraph(dir, {
    onProgress: () => {
      calls += 1;
    },
  });

  assert.ok(calls >= 1, "onProgress should fire at least once for 205 files at a 200-file interval");
});

test("coveragePercent is null (not NaN or a crash) when there are zero supported files", () => {
  const dir = tmpProject();
  fs.writeFileSync(path.join(dir, "main.go"), "package main\n");

  const graph = buildGraph(dir);

  assert.equal(graph.meta.coverage.coveragePercent, null);
});

test("REGRESSION: a real JS project with genuinely zero extractable facts still reports 'success', not treated the same as no-supported-files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rune-coverage-test-"));
  // Deliberately a valid JS file that yields zero facts: no imports, no
  // components, no hooks -- just an expression statement.
  fs.writeFileSync(path.join(dir, "app.js"), `console.log("hello");\n`);

  const graph = buildGraph(dir);

  // The file WAS supported and scanned -- this must be "success", not
  // "no_supported_files", even though zero facts came out of it.
  assert.equal(graph.meta.status, "success");
  assert.equal(graph.meta.coverage.filesSupported, 1);
  assert.equal(graph.meta.coverage.filesScanned, 1);
});
