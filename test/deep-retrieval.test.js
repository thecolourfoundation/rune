import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildGraph, writeGraph } from "../src/graph/build.js";
import { runAgentLoop, widenForDeepInvestigation } from "../src/agent/loop.js";

function makeTempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rune-deep-retrieval-test-"));
  fs.writeFileSync(
    path.join(dir, "auth.js"),
    "import jwt from \'jsonwebtoken\';\n\nexport function validateToken(token) {\n  return jwt.verify(token, \'secret\');\n}\n"
  );
  fs.mkdirSync(path.join(dir, "examples"));
  fs.writeFileSync(
    path.join(dir, "examples", "auth-example.js"),
    "import jwt from \'jsonwebtoken\';\n\nexport function demoAuth(token) {\n  return jwt.decode(token);\n}\n"
  );
  fs.writeFileSync(
    path.join(dir, "billing.js"),
    "import Stripe from \'stripe\';\n\nexport function chargeCard(amount) {\n  return Stripe.charges.create({ amount });\n}\n"
  );
  return dir;
}

test("shallow pass excludes the examples/ path, widened pass includes it", () => {
  const dir = makeTempProject();
  writeGraph(dir, buildGraph(dir));

  const shallow = runAgentLoop("how does auth work", dir);
  const shallowFiles = shallow.hypotheses.map((h) => h.file);
  assert.ok(shallowFiles.includes("auth.js"));
  assert.ok(!shallowFiles.some((f) => f.includes("examples")), "shallow pass should exclude the examples/ path");

  const widened = widenForDeepInvestigation(shallow, dir);
  const widenedFiles = widened.hypotheses.map((h) => h.file);
  assert.ok(widenedFiles.includes("auth.js"));
  assert.ok(widenedFiles.some((f) => f.includes("examples")), "widened pass should recover the examples/ evidence");
  assert.equal(widened.widenedForDeep, true);
  assert.ok(widened.relevantFactCount > shallow.relevantFactCount);
});

test("a genuinely irrelevant file never leaks in, shallow or widened", () => {
  const dir = makeTempProject();
  writeGraph(dir, buildGraph(dir));

  const shallow = runAgentLoop("how does auth work", dir);
  assert.ok(!shallow.hypotheses.some((h) => h.file === "billing.js"));

  const widened = widenForDeepInvestigation(shallow, dir);
  assert.ok(!widened.hypotheses.some((h) => h.file === "billing.js"), "widening must not pull in keyword-irrelevant files");
});

test("widening never drops facts the shallow pass already found", () => {
  const dir = makeTempProject();
  writeGraph(dir, buildGraph(dir));

  const shallow = runAgentLoop("how does auth work", dir);
  const shallowFactIds = new Set(shallow.hypotheses.flatMap((h) => h.relatedFactIds));

  const widened = widenForDeepInvestigation(shallow, dir);
  const widenedFactIds = new Set(widened.hypotheses.flatMap((h) => h.relatedFactIds));

  for (const id of shallowFactIds) {
    assert.ok(widenedFactIds.has(id), `widened pass dropped fact ${id} that shallow had already found`);
  }
});
