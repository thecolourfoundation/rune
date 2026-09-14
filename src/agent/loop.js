/**
 * The Rune Agent core loop: PERCEIVE -> UNDERSTAND -> RETRIEVE ->
 * IDENTIFY UNKNOWNS -> FORM HYPOTHESES -> GATHER EVIDENCE -> REASON ->
 * PLAN -> ACT -> OBSERVE -> VERIFY -> LEARN.
 *
 * v0 scope cut: read-only investigation only. No consequential actions
 * (file edits, commits, installs) are taken. The loop's job right now is
 * to prove out evidence-backed reasoning over the existing
 * graph/impact/verify/memory infrastructure, not to become a full
 * autonomous coding agent in one pass.
 */
import { buildGraph, readGraph } from "../graph/build.js";
import { verifyFacts } from "../graph/verify.js";
import { computeImpact } from "../graph/impact.js";
import { listProjectMemory, addExperience } from "../memory/memory.js";
import {
  createHypothesis,
  supportHypothesis,
  contradictHypothesis,
  rankHypotheses,
} from "./hypothesis.js";

const STOPWORDS = new Set([
  "the", "is", "are", "why", "what", "how", "this", "that", "with", "for",
  "and", "does", "do", "a", "an", "in", "on", "of", "to", "it", "its",
]);

/**
 * Naive keyword extraction from an objective string. This is the seam
 * where a real LLM call replaces keyword matching later, without
 * changing anything downstream that consumes the keyword list.
 */
function extractKeywords(objective) {
  return [...new Set(
    objective
      .toLowerCase()
      .replace(/[^a-z0-9_./-]+/g, " ")
      .split(" ")
      .filter((word) => word.length > 2 && !STOPWORDS.has(word))
  )];
}

/** RETRIEVE: cheap substring match against fact file/name/target/type. */
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

/** FORM HYPOTHESES: one hypothesis per distinct file touched by relevant facts. */
function formHypotheses(objective, relevantFacts) {
  const files = [...new Set(relevantFacts.map((f) => f.file).filter(Boolean))];
  return files.map((file) => {
    const factIds = relevantFacts.filter((f) => f.file === file).map((f) => f.id);
    return createHypothesis(`"${objective}" is explained by something in ${file}`, {
      relatedFactIds: factIds,
    });
  });
}

/**
 * GATHER EVIDENCE + REASON: re-verifies each hypothesis's related facts
 * against the live filesystem and checks impact (dependents). Drifted
 * facts contradict a hypothesis; still-confirmed facts support it.
 */
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
    supportHypothesis(hyp, `${relatedFacts.length} fact(s) still confirmed`);
    hyp.impact = impact;
  }
  return hypotheses;
}

/**
 * Runs one full pass of the agent loop for a given objective. Returns a
 * report object (not a print) so the CLI, MCP server, and tests can each
 * present it differently.
 */
export function runAgentLoop(objective, rootDir, options = {}) {
  if (!objective || typeof objective !== "string") {
    throw new Error("runAgentLoop requires a non-empty objective string");
  }

  const graph = readGraph(rootDir) ?? buildGraph(rootDir, options);
  const keywords = extractKeywords(objective);

  const relevantFacts = retrieveRelevantFacts(graph, keywords);
  const relevantMemory = listProjectMemory(rootDir, { statusFilter: "approved" }).filter((m) =>
    keywords.some((kw) => (m.rule || "").toLowerCase().includes(kw))
  );

  const unknowns = keywords.filter(
    (kw) =>
      !relevantFacts.some(
        (f) => (f.file || "").toLowerCase().includes(kw) || (f.name || "").toLowerCase().includes(kw)
      )
  );

  let hypotheses = formHypotheses(objective, relevantFacts);
  hypotheses = gatherEvidenceAndReason(hypotheses, graph, rootDir);
  const ranked = rankHypotheses(hypotheses);

  const outcome = ranked.length > 0 && ranked[0].confidence >= 0.5 ? "success" : "failure";
  addExperience(rootDir, {
    taskDescription: objective,
    strategyUsed: "keyword-retrieval + impact + verify",
    outcome,
    evidenceSource: ranked[0]?.id ?? "no-hypothesis-formed",
  });

  return {
    objective,
    keywords,
    relevantFactCount: relevantFacts.length,
    relevantMemory,
    unknowns,
    hypotheses: ranked,
    topHypothesis: ranked[0] ?? null,
  };
}
