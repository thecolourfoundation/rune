/**
 * The Rune Agent core loop: PERCEIVE -> UNDERSTAND -> RETRIEVE ->
 * IDENTIFY UNKNOWNS -> FORM HYPOTHESES -> GATHER EVIDENCE -> REASON ->
 * PLAN -> ACT -> OBSERVE -> VERIFY -> LEARN.
 */
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

function retrieveRelevantFacts(graph, keywords) {
  if (keywords.length === 0) return [];
  return graph.facts.filter((fact) => {
    const haystack = [fact.file, fact.name, fact.target, fact.type]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return keywords.some((kw) => haystack.includes(kw));
  });
}

function formHypotheses(intent, relevantFacts) {
  const files = [...new Set(relevantFacts.map((f) => f.file).filter(Boolean))];
  return files.map((file) => {
    const factIds = relevantFacts.filter((f) => f.file === file).map((f) => f.id);
    return createHypothesis(`${intent.taskType.replace(/-/g, " ")}: ${file}`, {
      relatedFactIds: factIds,
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
  const relevantFacts = retrieveRelevantFacts(graph, keywords2);
  const relevantMemory = listProjectMemory(rootDir, { statusFilter: "approved" }).filter((m) =>
    keywords.some((kw) => (m.rule || "").toLowerCase().includes(kw))
  );

  const unknowns = keywords.filter(
    (kw) =>
      !relevantFacts.some(
        (f) => (f.file || "").toLowerCase().includes(kw) || (f.name || "").toLowerCase().includes(kw)
      )
  );

  let hypotheses = formHypotheses(intent, relevantFacts);
  hypotheses = gatherEvidenceAndReason(hypotheses, graph, rootDir);
  const ranked = rankHypotheses(hypotheses);
  const synthesis = synthesize(ranked, intent.outputConstraints);

  const outcome = ranked.length > 0 && ranked[0].confidence >= 0.5 ? "success" : "failure";
  addExperience(rootDir, {
    taskDescription: objective,
    strategyUsed: "keyword-retrieval + impact + verify",
    outcome,
    evidenceSource: ranked[0]?.id ?? "no-hypothesis-formed",
  });

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
