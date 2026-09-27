/**
 * Stage 1 -- Fast Triage.
 *
 * Pure, synchronous, no LLM/network calls. Looks at what runAgentLoop's
 * existing (cheap) retrieval/hypothesis/ranking pipeline already computed
 * and decides whether that's enough to answer from, or whether the
 * objective needs Stage 2 (deep, LLM-driven investigation).
 *
 * Assumes `hypotheses` is already sorted descending by confidence (i.e.
 * the output of rankHypotheses) -- loop.js always provides it that way.
 *
 * Deliberately just a policy object + a scoring function so the routing
 * logic can evolve (new signals, different thresholds, a learned policy
 * later) without callers caring how the decision was made -- they only
 * ever look at `.mode`.
 */

export const DEFAULT_TRIAGE_POLICY = {
  minShallowConfidence: 0.6,
  maxAmbiguityGap: 0.15,
  deepLeaningTaskTypes: new Set(["bug-investigation"]),
  deepLeaningConfidenceFloor: 0.85,
};

function computeSignals(input) {
  const hyps = input.hypotheses || [];
  const topConfidence = hyps[0]?.confidence ?? 0;
  const secondConfidence = hyps[1]?.confidence ?? 0;
  return {
    taskType: input.intent?.taskType ?? "unknown",
    hypothesisCount: hyps.length,
    topConfidence,
    secondConfidence,
    confidenceGap: hyps.length > 1 ? topConfidence - secondConfidence : null,
    unknownCount: (input.unknowns || []).length,
    relevantFactCount: input.relevantFactCount ?? 0,
    memoryHitCount: (input.relevantMemory || []).length,
  };
}

export function triage(input, policy = DEFAULT_TRIAGE_POLICY) {
  const signals = computeSignals(input);
  const reasons = [];

  if (signals.hypothesisCount === 0) {
    reasons.push("no hypotheses formed from available evidence -- escalating so the model can reason directly about the objective, any unknowns, and project memory rather than Rune silently giving up");
    return { mode: "deep", uncertain: true, confidence: 0, reasons, signals };
  }

  const isAmbiguous =
    signals.hypothesisCount > 1 &&
    signals.confidenceGap !== null &&
    signals.confidenceGap < policy.maxAmbiguityGap;
  if (isAmbiguous) {
    reasons.push(`top ${signals.hypothesisCount} hypotheses are close in confidence (gap ${signals.confidenceGap.toFixed(2)} < ${policy.maxAmbiguityGap}) -- ambiguous, escalating to connect/compare evidence`);
  }

  if (signals.unknownCount > 0) {
    reasons.push(`${signals.unknownCount} target entit${signals.unknownCount === 1 ? "y" : "ies"} from the objective matched nothing in the graph -- escalating so the model can reason about why, or whether the search terms need to change`);
  }

  const deepLeaningTask = policy.deepLeaningTaskTypes.has(signals.taskType);
  if (deepLeaningTask && signals.topConfidence < policy.deepLeaningConfidenceFloor) {
    reasons.push(`task type "${signals.taskType}" typically needs causal reasoning across facts, and top confidence (${signals.topConfidence.toFixed(2)}) isn't high enough to skip that`);
  }

  const lowConfidence = signals.topConfidence < policy.minShallowConfidence;
  if (lowConfidence) {
    reasons.push(`top hypothesis confidence (${signals.topConfidence.toFixed(2)}) is below the shallow-answer threshold (${policy.minShallowConfidence})`);
  }

  const needsDeep =
    isAmbiguous ||
    signals.unknownCount > 0 ||
    (deepLeaningTask && signals.topConfidence < policy.deepLeaningConfidenceFloor) ||
    lowConfidence;

  if (needsDeep) {
    return { mode: "deep", uncertain: false, confidence: signals.topConfidence, reasons, signals };
  }

  reasons.push(`top hypothesis confidence (${signals.topConfidence.toFixed(2)}) meets the shallow-answer threshold, unambiguous, no unmatched entities`);
  return { mode: "shallow", uncertain: false, confidence: signals.topConfidence, reasons, signals };
}
