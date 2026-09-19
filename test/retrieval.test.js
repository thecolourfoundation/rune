import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseIntent } from "../src/agent/intent.js";
import { buildGraph, writeGraph } from "../src/graph/build.js";
import { runAgentLoop } from "../src/agent/loop.js";

function makeProject(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rune-retrieval-"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "retrieval-fixture", version: "1.0.0" }));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
  return dir;
}

test("symptom words are not search terms", () => {
  assert.deepEqual(parseIntent("why does routing fail").targetEntities, ["routing"]);
  assert.deepEqual(parseIntent("why does memory fail to load").targetEntities, ["memory", "load"]);
});

test("'routing' finds router facts", () => {
  const dir = makeProject({ "router.js": "import { Router } from 'express';\nexport const router = Router();\n" });
  writeGraph(dir, buildGraph(dir));
  assert.ok(runAgentLoop("why does routing fail", dir).relevantFactCount > 0);
});

test("a symptom word alone does not manufacture insights", () => {
  const dir = makeProject({ "auth.js": "import jwt from 'jsonwebtoken';\nexport function check(t) { return jwt.verify(t, 'k'); }\n" });
  writeGraph(dir, buildGraph(dir));
  assert.equal(runAgentLoop("why does routing fail", dir).hypotheses.length, 0);
});
