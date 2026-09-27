import { confidenceForFile } from "../scanner/confidence.js";
function isLowConfidence(f) {
  return f.confidence === "low" || confidenceForFile(String(f.file || "")) === "low";
}

import { buildGraph, readGraph } from "../graph/build.js";
import { verifyFacts } from "../graph/verify.js";
import { computeImpact } from "../graph/impact.js";
import { listProjectMemory, addExperience } from "../memory/memory.js";
import { parseIntent } from "./intent.js";
import { synthesize } from "./synthesize.js";
import {
  createHypothesis,
  supportHypothesis,
  contradictHypothesis,
  rankHypotheses,
} from "./hypothesis.js";

const MIN_BROAD_MATCH_COUNT = 20;

function filterDiscriminatingKeywords(graph, keywords) {
  if (keywords.length <= 1 || graph.facts.length === 0) return keywords;
  const scored = keywords.map((kw) => {
    const count = graph.facts.filter((fact) => {
      const haystack = [fact.file, fact.name, fact.target, fact.type].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(kw);
    }).length;
    return { kw, count, ratio: count / graph.facts.length };
  });
  const discriminating = scored.filter((s) => !(s.ratio >= 0.5 && s.count >= MIN_BROAD_MATCH_COUNT)).map((s) => s.kw);
  if (discriminating.length > 0) return discriminating;
  scored.sort((a, b) => a.ratio - b.ratio);
  return [scored[0].kw];
}

function retrieveOverviewFacts(graph) {
  const base = graph.facts.filter((f) => f.type !== "function_call" && !String(f.type).startsWith("doc_") && !isLowConfidence(f));
  const code = base.filter((f) => f.type !== "config_key");
  return code.length >= 20 ? code : base;
}

function expandKeyword(kw) {
  const out = new Set([kw]);
  const ing = kw.match(/^(.{4,})ing$/);
  if (ing) { out.add(ing[1] + "e"); out.add(ing[1] + "er"); if (ing[1].length >= 5) out.add(ing[1]); }
  if (kw.length > 4 && kw.endsWith("s")) out.add(kw.slice(0, -1));
  return [...out];
}

const SECONDARY_PATH_RE = /(^|[\\/])(examples?|samples?|demos?|benchmarks?)([\\/]|$)/i;
const SECONDARY_KEYWORD_RE = /^(tests?|specs?|fixtures?|mocks?|examples?|samples?|demos?|benchmarks?)/i;

function retrieveRelevantFacts(graph, keywords) {
  const all = retrieveRelevantFactsRaw(graph, keywords);
  if (keywords.some((k) => SECONDARY_KEYWORD_RE.test(k))) return all;
  const primary = all.filter((f) => !isLowConfidence(f) && !SECONDARY_PATH_RE.test(String(f.file || "")));
  const code = primary.filter((f) => !/\.(md|mdx|txt|rst)$/i.test(String(f.file || "")) && !String(f.type).startsWith("doc_"));
  if (code.length > 0) return code;
  return primary.length > 0 ? primary : all;
}

// FIXED (#31, partial fix landing here): function_call facts have no
// name/target field (only caller/callee), so keyword search previously
// couldn't find them via rune_search's [name,file,routePath,target] check
// OR via this same haystack pattern here. Adding callee/caller so the
// agent's own retrieval doesn't have the same blind spot MCP's search does.
function retrieveRelevantFactsRaw(graph, keywords) {
  if (keywords.length === 0) return [];
  return graph.facts.filter((fact) => {
    const haystack = [fact.file, fact.name, fact.target, fact.type, fact.callee, fact.caller]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return keywords.some((kw) => expandKeyword(kw).some((v) => haystack.includes(v)));
  });
}

// FIXED (#4): file is now set explicitly on the hypothesis object instead
// of only being embedded in the description string for synthesize.js to
// regex back out later.
function formHypotheses(intent, relevantFacts) {
  const files = [...new Set(relevantFacts.map((f) => f.file).filter(Boolean))];
  return files.map((file) => {
    const factIds = relevantFacts.filter((f) => f.file === file).map((f) => f.id);
    return createHypothesis(`${intent.taskType.replace(/-/g, " ")}: ${file}`, {
      relatedFactIds: factIds,
      file,
    });
  });
}

function gatherEvidenceAndReason(hypotheses, graph, rootDir) {
  for (const hyp of hypotheses) {
    const relatedFacts = graph.facts.filter((f) => hyp.relatedFactIds.includes(f.id));
    const verification = verifyFacts(relatedFacts, rootDir);
    const drifted = verification.drifted;
    const file = relatedFacts[0]?.file;
    const impact = file ? computeImpact(graph, file) : null;

    if (drifted.length > 0) {
      contradictHypothesis(hyp, `${drifted.length} related fact(s) have drifted or are missing`, drifted[0].id);
      continue;
    }
    supportHypothesis(hyp, `${relatedFacts.length} fact(s) still confirmed`, null, relatedFacts.length);
    hyp.impact = impact;
  }
  return hypotheses;
}

export function runAgentLoop(objective, rootDir, options = {}) {
  if (!objective || typeof objective !== "string") {
    throw new Error("runAgentLoop requires a non-empty objective string");
  }

  const graph = readGraph(rootDir) ?? buildGraph(rootDir, options);
  const intent = parseIntent(objective);
  const keywords = intent.targetEntities;
  const keywords2 = filterDiscriminatingKeywords(graph, keywords);
  const relevantFacts =
    keywords2.length === 0 && intent.taskType === "architecture-overview"
      ? retrieveOverviewFacts(graph)
      : retrieveRelevantFacts(graph, keywords2);
  const relevantMemory = listProjectMemory(rootDir, { statusFilter: "approved" }).filter((m) =>
    keywords.some((kw) => (m.rule || "").toLowerCase().includes(kw))
  );

  // FIXED (#2): unknowns is now computed against keywords2 (the actual
  // post-filter retrieval keywords), not the original pre-filter keywords.
  // Previously a keyword filtered out by filterDiscriminatingKeywords for
  // being TOO COMMON (opposite of unknown) could still be reported as
  // "unknown" if it didn't happen to appear in the narrower relevantFacts.
  const unknowns = keywords2.filter(
    (kw) =>
      !relevantFacts.some(
        (f) => (f.file || "").toLowerCase().includes(kw) || (f.name || "").toLowerCase().includes(kw)
      )
  );

  let hypotheses = formHypotheses(intent, relevantFacts);
  hypotheses = gatherEvidenceAndReason(hypotheses, graph, rootDir);
  const ranked = rankHypotheses(hypotheses);
  const synthesis = synthesize(ranked, intent.outputConstraints, new Map((graph.facts || []).map((f) => [f.id, f])));

  const outcome = ranked.length > 0 && ranked[0].confidence >= 0.5 ? "success" : "failure";

  // FIXED (#35, the loop.js side): addExperience() now only fires when the
  // caller opts in via options.recordExperience -- previously this fired
  // unconditionally on every call, which combined with cli/index.js calling
  // runAgentLoop() twice per invocation (once for the plain report, again
  // for the LLM-explain pass) meant every real CLI invocation silently
  // double-logged into the experience history. The CLI now passes
  // recordExperience: true exactly once, on whichever call actually runs.
  if (options.recordExperience) {
    addExperience(rootDir, {
      taskDescription: objective,
      strategyUsed: "keyword-retrieval + impact + verify",
      outcome,
      evidenceSource: ranked[0]?.id ?? "no-hypothesis-formed",
    });
  }

  return {
    objective,
    intent,
    synthesis,
    keywords,
    relevantFactCount: relevantFacts.length,
    relevantMemory,
    unknowns,
    hypotheses: ranked,
    topHypothesis: ranked[0] ?? null,
  };
}
