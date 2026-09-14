/**
 * Token budgeting for the Rune Agent. Compresses a runAgentLoop report to
 * fit within a caller-specified token budget, prioritizing the sections
 * that matter most for a decision: ranked hypotheses first, previously
 * established memory second, open unknowns last (cheap but least critical).
 *
 * Token estimation uses the standard chars/4 heuristic. No tokenizer
 * dependency is installed for v0 -- this is a documented approximation
 * (~10-15% accuracy for typical English code/prose), good enough for
 * budget allocation decisions, not for billing-grade counts.
 */

const CHARS_PER_TOKEN = 4;
const DEFAULT_MAX_TOKENS = 8000;

export function estimateTokens(value) {
  if (value == null) return 0;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function slimHypothesis(hyp) {
  return { id: hyp.id, description: hyp.description, status: hyp.status, confidence: hyp.confidence };
}

/** Greedily keeps items (in order) until the next one would exceed the remaining budget. */
function fitList(items, remainingBudget) {
  if (!items || items.length === 0) return { kept: [], tokens: 0, dropped: 0 };
  const kept = [];
  let used = 0;
  for (const item of items) {
    const cost = estimateTokens(item);
    if (used + cost > remainingBudget) break;
    kept.push(item);
    used += cost;
  }
  return { kept, tokens: used, dropped: items.length - kept.length };
}

/**
 * Compresses a runAgentLoop() report to fit within maxTokens. Does not
 * mutate the input report. Returns a new report object with a `budget`
 * field documenting what was kept/compressed/dropped and why, so the
 * caller can see the tradeoff instead of having it applied silently.
 */
export function budgetReport(report, { maxTokens = DEFAULT_MAX_TOKENS } = {}) {
  let usedTokens = 0;
  usedTokens += estimateTokens(report.objective);
  usedTokens += estimateTokens(report.keywords);
  usedTokens += estimateTokens(report.relevantFactCount);
  usedTokens += estimateTokens(report.topHypothesis ? slimHypothesis(report.topHypothesis) : null);

  const sections = {};

  const hyp = fitList(report.hypotheses.map(slimHypothesis), Math.max(0, maxTokens - usedTokens));
  usedTokens += hyp.tokens;
  sections.hypotheses = { tokens: hyp.tokens, kept: hyp.kept.length, dropped: hyp.dropped };

  const mem = fitList(report.relevantMemory, Math.max(0, maxTokens - usedTokens));
  usedTokens += mem.tokens;
  sections.relevantMemory = { tokens: mem.tokens, kept: mem.kept.length, dropped: mem.dropped };

  const unk = fitList(report.unknowns, Math.max(0, maxTokens - usedTokens));
  usedTokens += unk.tokens;
  sections.unknowns = { tokens: unk.tokens, kept: unk.kept.length, dropped: unk.dropped };

  return {
    ...report,
    hypotheses: hyp.kept,
    relevantMemory: mem.kept,
    unknowns: unk.kept,
    budget: {
      maxTokens,
      usedTokens,
      remainingTokens: Math.max(0, maxTokens - usedTokens),
      sections,
    },
  };
}
