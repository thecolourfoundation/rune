import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildGraph, writeGraph } from "../src/graph/build.js";
import { runAgentLoop } from "../src/agent/loop.js";

function makeTempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rune-agent-test-"));
  fs.writeFileSync(
    path.join(dir, "auth.js"),
    "import jwt from 'jsonwebtoken';\n\nexport function validateToken(token) {\n  return jwt.verify(token, 'secret');\n}\n"
  );
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "agent-test-fixture", version: "1.0.0", dependencies: { jsonwebtoken: "^9.0.0" } })
  );
  return dir;
}

test("runAgentLoop forms a hypothesis when objective keywords match real facts", () => {
  const dir = makeTempProject();
  writeGraph(dir, buildGraph(dir));

  const report = runAgentLoop("why is auth failing", dir);

  assert.ok(report.relevantFactCount > 0, "expected at least one relevant fact for 'auth'");
  assert.ok(report.hypotheses.length > 0, "expected at least one hypothesis formed");
  assert.equal(report.topHypothesis.relatedFactIds.length > 0, true);
});

test("runAgentLoop returns no hypotheses when objective matches nothing", () => {
  const dir = makeTempProject();
  writeGraph(dir, buildGraph(dir));

  const report = runAgentLoop("why is the quantum flux capacitor unstable", dir);

  assert.equal(report.hypotheses.length, 0);
  assert.equal(report.topHypothesis, null);
});

test("runAgentLoop throws on empty objective", () => {
  const dir = makeTempProject();
  assert.throws(() => runAgentLoop("", dir), /non-empty objective/);
});
