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

test("architecture summary detects express in the fixture project", () => {
  const graph = buildGraph(FIXTURE_DIR);
  const summary = graph.derived.find((d) => d.type === "architecture_summary");
  assert.ok(summary);
  assert.match(summary.description, /Express/);
});
