import test from "node:test";
import assert from "node:assert/strict";
import { triage, DEFAULT_TRIAGE_POLICY } from "../src/agent/triage.js";

function hyp(confidence) {
  return { id: `h_${confidence}`, confidence, relatedFactIds: [] };
}

test("zero hypotheses -> escalate to deep, flagged uncertain", () => {
  const result = triage({ intent: { taskType: "entity-lookup" }, hypotheses: [], relevantMemory: [], unknowns: [], relevantFactCount: 0 });
  assert.equal(result.mode, "deep");
  assert.equal(result.uncertain, true);
});

test("single high-confidence hypothesis, no unknowns -> shallow", () => {
  const result = triage({
    intent: { taskType: "entity-lookup" },
    hypotheses: [hyp(0.9)],
    relevantMemory: [],
    unknowns: [],
    relevantFactCount: 5,
  });
  assert.equal(result.mode, "shallow");
  assert.equal(result.uncertain, false);
});

test("low confidence top hypothesis -> deep", () => {
  const result = triage({
    intent: { taskType: "entity-lookup" },
    hypotheses: [hyp(0.4)],
    relevantMemory: [],
    unknowns: [],
    relevantFactCount: 5,
  });
  assert.equal(result.mode, "deep");
  assert.ok(result.reasons.some((r) => /below the shallow-answer threshold/.test(r)));
});

test("close competing hypotheses (ambiguous) -> deep", () => {
  const result = triage({
    intent: { taskType: "entity-lookup" },
    hypotheses: [hyp(0.8), hyp(0.75)],
    relevantMemory: [],
    unknowns: [],
    relevantFactCount: 10,
  });
  assert.equal(result.mode, "deep");
  assert.ok(result.reasons.some((r) => /ambiguous/.test(r)));
});

test("unmatched target entities (unknowns present) -> deep even with high confidence", () => {
  const result = triage({
    intent: { taskType: "entity-lookup" },
    hypotheses: [hyp(0.9)],
    relevantMemory: [],
    unknowns: ["fooBarBaz"],
    relevantFactCount: 5,
  });
  assert.equal(result.mode, "deep");
  assert.ok(result.reasons.some((r) => /matched nothing in the graph/.test(r)));
});

test("bug-investigation task type leans deep unless very high confidence", () => {
  const uncertainBug = triage({
    intent: { taskType: "bug-investigation" },
    hypotheses: [hyp(0.7)],
    relevantMemory: [],
    unknowns: [],
    relevantFactCount: 5,
  });
  assert.equal(uncertainBug.mode, "deep");

  const confidentBug = triage({
    intent: { taskType: "bug-investigation" },
    hypotheses: [hyp(0.9)],
    relevantMemory: [],
    unknowns: [],
    relevantFactCount: 5,
  });
  assert.equal(confidentBug.mode, "shallow");
});

test("signals object exposes the raw numbers used for the decision (debuggability)", () => {
  const result = triage({
    intent: { taskType: "entity-lookup" },
    hypotheses: [hyp(0.9), hyp(0.2)],
    relevantMemory: [{ rule: "x" }],
    unknowns: [],
    relevantFactCount: 7,
  });
  assert.equal(result.signals.hypothesisCount, 2);
  assert.equal(result.signals.topConfidence, 0.9);
  assert.equal(result.signals.memoryHitCount, 1);
});

test("custom policy can change thresholds without touching triage() itself", () => {
  const lenientPolicy = { ...DEFAULT_TRIAGE_POLICY, minShallowConfidence: 0.1 };
  const result = triage({
    intent: { taskType: "entity-lookup" },
    hypotheses: [hyp(0.4)],
    relevantMemory: [],
    unknowns: [],
    relevantFactCount: 5,
  }, lenientPolicy);
  assert.equal(result.mode, "shallow");
});
