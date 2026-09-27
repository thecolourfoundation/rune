import test from "node:test";
import assert from "node:assert/strict";
import { investigateDeep, collectDeepFacts } from "../src/llm/investigate.js";

const graph = {
  facts: [
    { id: "import_1", file: "auth.js", line: 1, evidence: "import jwt from 'jsonwebtoken';" },
    { id: "call_1", file: "auth.js", line: 4, evidence: "return jwt.verify(token, 'secret');" },
  ],
};

const report = {
  objective: "why is auth failing",
  intent: { taskType: "bug-investigation" },
  unknowns: [],
  relevantMemory: [],
  hypotheses: [
    { id: "hyp_1", description: "bug investigation: auth.js", status: "supported", confidence: 0.6, relatedFactIds: ["import_1", "call_1"] },
  ],
};

const fakeFetch = (statements, uncertainty = "") => async () => ({
  ok: true,
  json: async () => ({ content: [{ type: "text", text: JSON.stringify({ statements, uncertainty }) }] }),
});

test("collectDeepFacts pulls from ALL hypotheses related facts", () => {
  const facts = collectDeepFacts(report, graph);
  assert.equal(facts.length, 2);
});

test("no model configured: skipped, nothing sent", async () => {
  let called = false;
  const out = await investigateDeep(report, graph, {}, async () => { called = true; });
  assert.ok(out.skipped);
  assert.equal(called, false);
});

test("verified statements kept, fabricated citation dropped, uncertainty passed through", async () => {
  const out = await investigateDeep(
    report,
    graph,
    { ANTHROPIC_API_KEY: "k" },
    fakeFetch(
      [
        { text: "Token verification uses the jsonwebtoken package.", cites: ["import_1"], quote: "jsonwebtoken" },
        { text: "It always fails after 5 minutes.", cites: ["import_999"] },
      ],
      "Cannot confirm the failure trigger without a stack trace."
    )
  );
  assert.equal(out.kept.length, 1);
  assert.equal(out.dropped.length, 1);
  assert.match(out.uncertainty, /stack trace/);
});

test("bad model output is reported as an error, never thrown", async () => {
  const badFetch = async () => ({ ok: true, json: async () => ({ content: [{ type: "text", text: "not json at all" }] }) });
  const out = await investigateDeep(report, graph, { ANTHROPIC_API_KEY: "k" }, badFetch);
  assert.ok(out.error);
});

test("no evidence available: skipped before ever calling the model", async () => {
  let called = false;
  const emptyReport = { ...report, hypotheses: [] };
  const out = await investigateDeep(emptyReport, graph, { ANTHROPIC_API_KEY: "k" }, async () => { called = true; });
  assert.ok(out.skipped);
  assert.equal(called, false);
});
