import test from "node:test";
import assert from "node:assert/strict";
import { estimateTokens, budgetReport } from "../src/agent/budget.js";

function fakeReport(overrides = {}) {
  return {
    objective: "why is auth failing",
    keywords: ["auth", "failing"],
    relevantFactCount: 3,
    relevantMemory: [],
    unknowns: [],
    hypotheses: [
      { id: "hyp_1", description: "explained by auth.js", status: "supported", confidence: 0.7, evidence: [], relatedFactIds: ["f1"] },
      { id: "hyp_2", description: "explained by middleware.js", status: "supported", confidence: 0.5, evidence: [], relatedFactIds: ["f2"] },
    ],
    topHypothesis: null,
    ...overrides,
  };
}

test("estimateTokens is roughly chars/4 for a plain string", () => {
  const tokens = estimateTokens("a".repeat(400));
  assert.equal(tokens, 100);
});

test("estimateTokens returns 0 for null/undefined", () => {
  assert.equal(estimateTokens(null), 0);
  assert.equal(estimateTokens(undefined), 0);
});

test("budgetReport keeps everything when maxTokens is generous", () => {
  const report = fakeReport();
  const result = budgetReport(report, { maxTokens: 8000 });
  assert.equal(result.hypotheses.length, 2);
  assert.equal(result.budget.sections.hypotheses.dropped, 0);
  assert.ok(result.budget.usedTokens < 8000);
});

test("budgetReport drops hypotheses when maxTokens is very tight", () => {
  const report = fakeReport();
  const result = budgetReport(report, { maxTokens: 5 });
  assert.ok(result.hypotheses.length < report.hypotheses.length);
  assert.ok(result.budget.remainingTokens >= 0);
});

test("budgetReport never mutates the original report object", () => {
  const report = fakeReport();
  const originalHypLength = report.hypotheses.length;
  budgetReport(report, { maxTokens: 5 });
  assert.equal(report.hypotheses.length, originalHypLength);
});

test("budgetReport reports a budget field with maxTokens and usedTokens", () => {
  const report = fakeReport();
  const result = budgetReport(report, { maxTokens: 1000 });
  assert.equal(result.budget.maxTokens, 1000);
  assert.ok(typeof result.budget.usedTokens === "number");
});
