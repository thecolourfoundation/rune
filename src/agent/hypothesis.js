let hypothesisCounter = 0;

function nextHypothesisId() {
  hypothesisCounter += 1;
  return `hyp_${hypothesisCounter}`;
}

export function createHypothesis(description, { relatedFactIds = [], file = null } = {}) {
  if (!description || typeof description !== "string") {
    throw new Error("createHypothesis requires a non-empty description string");
  }
  return {
    id: nextHypothesisId(),
    description,
    // FIXED (#4): file is now an explicit field set by the caller instead
    // of being regex-parsed back out of `description` by synthesize.js
    // later. Same coupling class as a prior bug where the area-clustering
    // regex broke after the description format changed -- an explicit
    // field can't desync from itself.
    file,
    status: "open",
    confidence: 0.3,
    relatedFactIds: [...relatedFactIds],
    evidence: [],
  };
}

function addEvidence(hypothesis, type, note, factId) {
  hypothesis.evidence.push({ type, note, factId: factId ?? null, at: new Date().toISOString() });
  return hypothesis;
}

export function supportHypothesis(hypothesis, note, factId, strength = 1) {
  addEvidence(hypothesis, "supports", note, factId);
  const s = Math.max(1, strength);
  hypothesis.confidence = Math.min(0.95, 0.3 + 0.6 * (s / (s + 5)));
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
