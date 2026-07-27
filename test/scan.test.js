import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildGraph } from "../src/graph/build.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, "fixtures", "sample-express");

test("detects express routes from app.* and router.* calls", () => {
  const graph = buildGraph(FIXTURE_DIR);
  const routes = graph.facts.filter((f) => f.type === "express_route");

  const methods = routes.map((r) => `${r.method} ${r.routePath}`).sort();
  assert.ok(methods.includes("GET /health"));
  assert.ok(methods.includes("GET /"));
  assert.ok(methods.includes("POST /"));
});

test("detects a React function component with hook usage", () => {
  const graph = buildGraph(FIXTURE_DIR);
  const components = graph.facts.filter((f) => f.type === "react_component");
  assert.ok(components.some((c) => c.name === "UserCard"));

  const hooks = graph.facts.filter((f) => f.type === "hook_usage");
  assert.ok(hooks.some((h) => h.name === "useState"));
});

test("every derived node is based on at least one traceable fact id", () => {
  const graph = buildGraph(FIXTURE_DIR);
  const factIds = new Set(graph.facts.map((f) => f.id));

  for (const node of graph.derived) {
    if (!node.basedOn) continue;
    for (const id of node.basedOn) {
      assert.ok(factIds.has(id), `derived node ${node.id} references unknown fact id ${id}`);
    }
  }
});

test("never scans dotfiles like .env.js, even though the extension matches", () => {
  const graph = buildGraph(FIXTURE_DIR);
  const leaked = graph.facts.some((f) => JSON.stringify(f).includes("supersecretpassword"));
  assert.equal(leaked, false, "secret from .env.js leaked into the understanding graph");

  const scannedEnvFile = graph.facts.some((f) => typeof f.file === "string" && f.file.includes(".env"));
  assert.equal(scannedEnvFile, false, ".env.js should never be scanned");
});

test("does not misdetect TypeScript generics (Array<Item>) as JSX / a React component", () => {
  const graph = buildGraph(FIXTURE_DIR);
  const falsePositive = graph.facts.find(
    (f) => f.type === "react_component" && f.name === "NotAComponent"
  );
  assert.equal(falsePositive, undefined, "generic syntax should not be detected as a JSX-returning component");
});

test("readGraph returns null instead of throwing on a corrupted graph.json", async () => {
  const { readGraph, RUNE_DIR, GRAPH_FILENAME } = await import("../src/graph/build.js");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const runeDir = path.join(FIXTURE_DIR, RUNE_DIR);
  fs.mkdirSync(runeDir, { recursive: true });
  const graphPath = path.join(runeDir, GRAPH_FILENAME);
  fs.writeFileSync(graphPath, "{ this is not valid json");

  assert.doesNotThrow(() => {
    const result = readGraph(FIXTURE_DIR);
    assert.equal(result, null);
  });

  fs.rmSync(runeDir, { recursive: true, force: true });
});

test("line numbers reported for facts match the actual source line", () => {
  const graph = buildGraph(FIXTURE_DIR);
  const userCardFacts = graph.facts.filter((f) => f.file === "components/UserCard.jsx");
  const importFact = userCardFacts.find((f) => f.type === "import" && f.target === "react");
  assert.ok(importFact);
  assert.equal(importFact.line, 1);

  const componentFact = userCardFacts.find((f) => f.type === "react_component" && f.name === "UserCard");
  assert.ok(componentFact);
  assert.equal(componentFact.line, 3);
});

test("architecture summary detects express in the fixture project", () => {
  const graph = buildGraph(FIXTURE_DIR);
  const summary = graph.derived.find((d) => d.type === "architecture_summary");
  assert.ok(summary);
  assert.match(summary.description, /Express/);
});

