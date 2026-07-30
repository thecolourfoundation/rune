import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { buildGraph, writeGraph, createLiveGraphReader, RUNE_DIR, GRAPH_FILENAME } from "../src/graph/build.js";
import { startWatch } from "../src/watch/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function makeTempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rune-watch-test-"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "watch-fixture", dependencies: {} }));
  fs.writeFileSync(path.join(dir, "index.js"), "console.log('hello');\n");
  return dir;
}

test("createLiveGraphReader reloads when the graph file's mtime changes", async () => {
  const dir = makeTempProject();
  try {
    const graph1 = buildGraph(dir);
    writeGraph(dir, graph1);

    const getGraph = createLiveGraphReader(dir);
    const first = getGraph();
    assert.equal(first.meta.fileCount, 1);

    // Simulate an external process (e.g. `rune watch`) rebuilding the graph
    // with a new file added -- write it with a guaranteed-later mtime.
    fs.writeFileSync(path.join(dir, "second.js"), "module.exports = {};\n");
    const graph2 = buildGraph(dir);
    const futureTime = new Date(Date.now() + 5000);
    writeGraph(dir, graph2);
    fs.utimesSync(path.join(dir, RUNE_DIR, GRAPH_FILENAME), futureTime, futureTime);

    const second = getGraph();
    assert.equal(second.meta.fileCount, 2, "live reader should have picked up the externally-updated graph");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("createLiveGraphReader builds a graph on first call if none exists yet", async () => {
  const dir = makeTempProject();
  try {
    const getGraph = createLiveGraphReader(dir);
    const graph = getGraph();
    assert.equal(graph.meta.fileCount, 1);
    assert.ok(fs.existsSync(path.join(dir, RUNE_DIR, GRAPH_FILENAME)), "should have written the graph it built");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("watch mode performs an initial scan immediately on start", async () => {
  const dir = makeTempProject();
  const rebuilds = [];
  const handle = startWatch(dir, {
    debounceMs: 50,
    onRebuild: (result) => rebuilds.push(result),
  });
  try {
    assert.equal(rebuilds.length, 1);
    assert.equal(rebuilds[0].reason, "initial");
    assert.equal(rebuilds[0].ok, true);
    assert.equal(rebuilds[0].graph.meta.fileCount, 1);
  } finally {
    handle.stop();
  }
});

test("watch mode rebuilds when a source file changes", async () => {
  const dir = makeTempProject();
  const rebuilds = [];
  const handle = startWatch(dir, {
    debounceMs: 50,
    onRebuild: (result) => rebuilds.push(result),
  });
  try {
    await new Promise((r) => setTimeout(r, 100)); // let the initial scan settle

    fs.writeFileSync(path.join(dir, "added.js"), "export const x = 1;\n");

    // Poll for the debounced rebuild rather than a single fixed sleep, so
    // this isn't flaky under slower CI machines.
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && rebuilds.length < 2) {
      await new Promise((r) => setTimeout(r, 50));
    }

    assert.ok(rebuilds.length >= 2, "expected at least one rebuild after the initial scan");
    const latest = rebuilds[rebuilds.length - 1];
    assert.equal(latest.ok, true);
    assert.equal(latest.graph.meta.fileCount, 2, "the newly added file should be reflected in the rebuilt graph");
  } finally {
    handle.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("watch mode's stop() actually stops further rebuilds", async () => {
  const dir = makeTempProject();
  const rebuilds = [];
  const handle = startWatch(dir, {
    debounceMs: 50,
    onRebuild: (result) => rebuilds.push(result),
  });

  await new Promise((r) => setTimeout(r, 100));
  handle.stop();
  const countAtStop = rebuilds.length;

  fs.writeFileSync(path.join(dir, "after-stop.js"), "export const y = 2;\n");
  await new Promise((r) => setTimeout(r, 500));

  assert.equal(rebuilds.length, countAtStop, "no rebuild should occur after stop() is called");
  fs.rmSync(dir, { recursive: true, force: true });
});
