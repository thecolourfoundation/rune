import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseIntent } from "../src/agent/intent.js";
import { buildGraph, writeGraph } from "../src/graph/build.js";
import { runAgentLoop } from "../src/agent/loop.js";

function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rune-overview-"));
  fs.writeFileSync(path.join(dir, "auth.js"), "import jwt from 'jsonwebtoken';\n\nexport function validateToken(token) {\n  return jwt.verify(token, 'secret');\n}\n");
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "overview-fixture", version: "1.0.0", dependencies: { jsonwebtoken: "^9.0.0" } }));
  return dir;
}

test("count words and 'top' are not target entities", () => {
  const i = parseIntent("top five insights");
  assert.deepEqual(i.targetEntities, []);
  assert.equal(i.taskType, "architecture-overview");
});

test("specific task types still win over the generic overview pattern", () => {
  assert.equal(parseIntent("why does memory fail to load").taskType, "bug-investigation");
});

test("overview queries with no named entity fall back to the whole graph", () => {
  for (const q of ["give me 3 architectural insights", "top five insights"]) {
    const dir = makeProject();
    writeGraph(dir, buildGraph(dir));
    const report = runAgentLoop(q, dir);
    assert.ok(report.relevantFactCount > 0, `no facts for: ${q}`);
    assert.ok(report.hypotheses.length > 0, `no hypotheses for: ${q}`);
  }
});
