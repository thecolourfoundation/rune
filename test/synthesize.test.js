import test from "node:test";
import assert from "node:assert/strict";
import { synthesize } from "../src/agent/synthesize.js";

const hyp = { description: "Investigate: lib/app.js", confidence: 0.5, relatedFactIds: ["import_1"] };

test("describes an external-package import from its evidence", () => {
  const facts = new Map([["import_1", { id: "import_1", type: "import", target: "router", file: "lib/app.js", line: 1, evidence: "var Router = require('router');" }]]);
  const out = synthesize([hyp], {}, facts);
  assert.match(out.insights[0].whyItMatters, /external package `router`/);
});

test("falls back to the generic text when no facts are supplied", () => {
  const out = synthesize([hyp], {});
  assert.match(out.insights[0].whyItMatters, /related fact/);
});
