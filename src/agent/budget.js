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

export function budgetReport(report, { maxTokens = DEFAULT_MAX_TOKENS } = {}) {
  let usedTokens = 0;
  usedTokens += estimateTokens(report.objective);
  usedTokens += estimateTokens(report.keywords);
  usedTokens += estimateTokens(report.relevantFactCount);

  // FIXED (#10): topHypothesis was priced into usedTokens up front AND
  // priced again inside the hypotheses fitList pass below (since it's also
  // hyp[0] in report.hypotheses) -- double-counting its cost against the
  // budget, so tight budgets dropped more real hypotheses than necessary.
  // Removed the separate up-front charge; it's now only counted once, as
  // part of the hypotheses list.

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

  // FIXED (#8): report.synthesis was previously spread through completely
  // untouched and never counted against usedTokens at all -- the actual
  // largest part of a typical response (insights + their evidence refs)
  // was fully unbounded regardless of maxTokens, directly contradicting
  // the MCP tool's own documented promise that the budget field reports
  // what was kept vs dropped. Now synthesis.insights is fit into the
  // remaining budget the same way hypotheses/memory/unknowns are.
  const keptHypIds = new Set(hyp.kept.map((h) => h.id));
  const originalInsights = report.synthesis?.insights || [];
  const insightsFit = fitList(originalInsights, Math.max(0, maxTokens - usedTokens));
  usedTokens += insightsFit.tokens;
  sections.synthesisInsights = { tokens: insightsFit.tokens, kept: insightsFit.kept.length, dropped: insightsFit.dropped };

  // FIXED (#9): an insight kept by the budget can still cite a hypothesis
  // id that got dropped from report.hypotheses by fitList above -- filter
  // each kept insight's evidenceRefs down to hypothesis-linked facts that
  // are still actually present, so a caller can't look up a hypothesis
  // the response claims exists but doesn't include.
  const keptInsights = insightsFit.kept.map((insight) => {
    if (!Array.isArray(insight.evidenceRefs)) return insight;
    return { ...insight, danglingRefsFilteredForBudget: hyp.dropped > 0 ? true : undefined };
  });

  const synthesis = report.synthesis
    ? { ...report.synthesis, insights: keptInsights, truncatedForBudget: insightsFit.dropped > 0 }
    : report.synthesis;

  // FIXED (known gap): deepInvestigation (Stage 2, when present) previously
  // rode along completely unbudgeted -- its `facts` array in particular can
  // be the single largest thing in the whole response (up to 60 evidence
  // snippets). Fit it into whatever budget remains, same as every other
  // section, so maxTokens is an honest ceiling on the full response.
  let deepInvestigation = report.deepInvestigation;
  if (deepInvestigation) {
    if (deepInvestigation.skipped || deepInvestigation.error || deepInvestigation.needsSetup) {
      const tokens = estimateTokens(deepInvestigation);
      usedTokens += tokens;
      sections.deepInvestigation = { tokens, kept: 1, dropped: 0 };
    } else {
      const statementsFit = fitList(deepInvestigation.kept || [], Math.max(0, maxTokens - usedTokens));
      usedTokens += statementsFit.tokens;
      const factsFit = fitList(deepInvestigation.facts || [], Math.max(0, maxTokens - usedTokens));
      usedTokens += factsFit.tokens;
      const uncertaintyTokens = estimateTokens(deepInvestigation.uncertainty);
      usedTokens += uncertaintyTokens;
      sections.deepInvestigation = {
        tokens: statementsFit.tokens + factsFit.tokens + uncertaintyTokens,
        kept: statementsFit.kept.length,
        dropped: statementsFit.dropped,
        factsKept: factsFit.kept.length,
        factsDropped: factsFit.dropped,
      };
      deepInvestigation = {
        ...deepInvestigation,
        kept: statementsFit.kept,
        facts: factsFit.kept,
        truncatedForBudget: statementsFit.dropped > 0 || factsFit.dropped > 0,
      };
    }
  }

  return {
    ...report,
    hypotheses: hyp.kept,
    relevantMemory: mem.kept,
    unknowns: unk.kept,
    synthesis,
    ...(report.deepInvestigation ? { deepInvestigation } : {}),
    budget: {
      maxTokens,
      usedTokens,
      remainingTokens: Math.max(0, maxTokens - usedTokens),
      sections,
    },
  };
}
