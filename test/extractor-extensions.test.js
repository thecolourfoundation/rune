
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildGraph } from "../src/graph/build.js";
import { registerExtractor } from "../src/scanner/registry.js";

const textExtractor = (name = "test-text") => ({
  name, bucket: "textFiles", kind: "facts", extensions: [".txt"],
  extract: (filePath, content, rootDir, nextId) => [{
    id: nextId("txt"), type: "text_line", file: path.relative(rootDir, filePath), line: 1,
    confidence: "high", evidence: content.split("\n")[0],
  }],
});

function tmpProject(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rune-ext-"));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
}

test("without a registered extractor a .txt file is not scanned", () => {
  const graph = buildGraph(tmpProject({ "a.txt": "Hello\n" }));
  assert.equal(graph.facts.length, 0);
  assert.equal(graph.meta.status, "no_supported_files");
});

test("an extractor can claim its own file extension", () => {
  const dir = tmpProject({ "contract.txt": "Section 1. Term\nmore\n" });
  const unregister = registerExtractor(textExtractor());
  try {
    const graph = buildGraph(dir);
    const fact = graph.facts.find((f) => f.type === "text_line");
    assert.ok(fact, "text fact missing");
    assert.equal(fact.file, "contract.txt");
    assert.equal(fact.evidence, "Section 1. Term");
    assert.equal(graph.meta.coverage.filesSupported, 1);
    assert.notEqual(graph.meta.status, "no_supported_files");
  } finally {
    unregister();
  }
});

test("built-in extensions cannot be claimed", () => {
  assert.throws(() => registerExtractor({ name: "steal-md", bucket: "textFiles", kind: "facts", extensions: [".md"], extract() { return []; } }), /built-in/);
});

test("extensions need a new bucket", () => {
  assert.throws(() => registerExtractor({ name: "bad-bucket", bucket: "markdownFiles", kind: "facts", extensions: [".txt"], extract() { return []; } }), /new bucket/);
});

test("two buckets cannot claim the same extension", () => {
  const unregister = registerExtractor(textExtractor("first"));
  try {
    assert.throws(() => registerExtractor({ name: "second", bucket: "otherFiles", kind: "facts", extensions: [".txt"], extract() { return []; } }), /already claimed/);
  } finally {
    unregister();
  }
});
