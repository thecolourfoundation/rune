import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildGraph } from "../src/graph/build.js";

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "rune-resilience-test-"));
}

test("REGRESSION: one file that throws during traversal does not kill the whole scan", () => {
  const dir = tmpProject();
  const pathological = "1" + "+1".repeat(50000);
  fs.writeFileSync(path.join(dir, "broken.js"), `const x = ${pathological};\n`);
  fs.writeFileSync(path.join(dir, "fine.js"), `export function Ok() {\n  return 1;\n}\n`);

  const graph = buildGraph(dir);

  assert.equal(graph.meta.status, "success");
});

test("REGRESSION: a repository with zero scannable files reports status 'no_supported_files', not silent success", () => {
  const dir = tmpProject();
  fs.writeFileSync(path.join(dir, "README.md"), "# Just a readme\n");

  const graph = buildGraph(dir);

  assert.equal(graph.meta.fileCount, 0);
  assert.equal(graph.meta.status, "no_supported_files");
});

test("a repository with real scannable files reports status 'success'", () => {
  const dir = tmpProject();
  fs.writeFileSync(path.join(dir, "app.js"), `export function greet() {\n  return "hi";\n}\n`);

  const graph = buildGraph(dir);

  assert.equal(graph.meta.status, "success");
});

test("zero scannable files does not manufacture an architecture_summary from no evidence", () => {
  const dir = tmpProject();
  fs.writeFileSync(path.join(dir, "README.md"), "# Just a readme\n");

  const graph = buildGraph(dir);

  assert.equal(graph.derived.length, 0);
});

test("graph always includes a scanWarnings array, even when empty", () => {
  const dir = tmpProject();
  fs.writeFileSync(path.join(dir, "app.js"), `export function greet() {\n  return "hi";\n}\n`);

  const graph = buildGraph(dir);

  assert.ok(Array.isArray(graph.scanWarnings));
});
