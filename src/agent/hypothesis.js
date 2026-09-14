/**
 * Hypothesis engine: represents competing explanations the Rune Agent
 * investigates during an objective, and tracks how evidence shifts
 * confidence in each one. Deliberately simple state machine — no ML,
 * just explicit status transitions with a provenance trail.
 */

let hypothesisCounter = 0;

function nextHypothesisId() {
  hypothesisCounter += 1;
  return `hyp_${Date.now().toString(36)}_${hypothesisCounter}`;
}

export function createHypothesis(description, { relatedFactIds = [] } = {}) {
  if (!description || typeof description !== "string") {
    throw new Error("createHypothesis requires a non-empty description string");
  }
  return {
    id: nextHypothesisId(),
    description,
    status: "open", // open | supported | contradicted | eliminated | confirmed
    confidence: 0.3,
    relatedFactIds: [...relatedFactIds],
    evidence: [],
  };
}

function addEvidence(hypothesis, type, note, factId) {
  hypothesis.evidence.push({ type, note, factId: factId ?? null, at: new Date().toISOString() });
  return hypothesis;
}

export function supportHypothesis(hypothesis, note, factId) {
  addEvidence(hypothesis, "supports", note, factId);
  hypothesis.confidence = Math.min(0.95, hypothesis.confidence + 0.2);
  hypothesis.status = hypothesis.confidence >= 0.8 ? "confirmed" : "supported";
  return hypothesis;
}

export function contradictHypothesis(hypothesis, note, factId) {
  addEvidence(hypothesis, "contradicts", note, factId);
  hypothesis.confidence = Math.max(0, hypothesis.confidence - 0.3);
  hypothesis.status = hypothesis.confidence === 0 ? "eliminated" : "contradicted";
  return hypothesis;
}

export function eliminateHypothesis(hypothesis, reason) {
  addEvidence(hypothesis, "contradicts", reason);
  hypothesis.confidence = 0;
  hypothesis.status = "eliminated";
  return hypothesis;
}

export function rankHypotheses(hypotheses) {
  return [...hypotheses].sort((a, b) => b.confidence - a.confidence);
}
