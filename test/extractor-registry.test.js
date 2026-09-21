
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildGraph } from "../src/graph/build.js";
import { registerExtractor, extractorsForBucket, listExtractors, validateExtractor } from "../src/scanner/registry.js";

test("built-in extractors keep the order that makes fact ids deterministic", () => {
  assert.deepEqual(
    extractorsForBucket("files").map((e) => e.name),
    ["file-facts", "express-routes", "secrets", "shell-exec", "workflow", "dependencies"]
  );
});

test("registered extractors satisfy the contract and names are unique", () => {
  const list = listExtractors();
  for (const b of ["files", "shellFiles", "configFiles", "markdownFiles", "luaFiles"]) {
    for (const e of extractorsForBucket(b)) validateExtractor(e);
  }
  assert.equal(new Set(list.map((e) => e.name)).size, list.length);
});

test("a newly registered extractor is run by buildGraph with no change to core", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rune-registry-"));
  fs.writeFileSync(path.join(dir, "notes.md"), "# Title\nSome notes\n");
  const unregister = registerExtractor({
    name: "test-note", bucket: "markdownFiles", kind: "facts",
    extract: (filePath, content, rootDir, nextId) => [{
      id: nextId("note"), type: "custom_note", file: path.relative(rootDir, filePath),
      line: 1, confidence: "high", evidence: content.split("\n")[0],
    }],
  });
  try {
    const graph = buildGraph(dir);
    const note = graph.facts.find((f) => f.type === "custom_note");
    assert.ok(note, "custom fact missing from the graph");
    assert.equal(note.evidence, "# Title");
  } finally {
    unregister();
  }
});

test("an extractor with an invalid kind is rejected", () => {
  assert.throws(() => registerExtractor({ name: "bad", bucket: "files", kind: "nope", extract() {} }));
});
