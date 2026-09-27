import { resolveProvider, callModel } from "./provider.js";
import { verifyStatements } from "./explain.js";
import { estimateTokens } from "../agent/budget.js";

const SYSTEM = `You are the deep-investigation stage of Rune, a code-understanding tool. Rune's fast stage already retrieved evidence and formed ranked hypotheses -- your job is to reason across them, not restate them. Use ONLY the evidence facts and hypotheses you are given: never invent a file, package, or behavior that isn't in the evidence. When the evidence conflicts or is thin, say so explicitly rather than guessing. If multiple hypotheses compete, state which is best supported and why.

Return JSON only, no prose, no code fences, in this exact shape:
{"statements":[{"text":"one plain sentence forming part of your conclusion","cites":["fact id"],"quote":"optional exact text copied from a cited snippet"}],"uncertainty":"one sentence naming what remains unverified or unknown, or an empty string if nothing does"}

Rules: every statement must cite at least one fact id from the evidence given; if the evidence does not answer the objective, your only statement should say so and cite the closest fact.`;

const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();

/**
 * Deep investigation gets a WIDER evidence net than the narrate-only
 * explain.js pass: every hypothesis's related facts (not just the ones
 * that survived synthesize()'s per-area merge/truncation), because the
 * whole point of escalating is to let the model reason over facts the
 * fast stage's cheap heuristics didn't fully resolve. Callers should pass
 * a report that has already been through widenForDeepInvestigation()
 * (src/agent/loop.js) so `report.hypotheses` reflects the widened set,
 * not the original shallow one.
 */
export function collectDeepFacts(report, graph, cap = 60) {
  const byId = new Map((graph.facts || []).map((f) => [f.id, f]));
  const ids = [];
  for (const hyp of report.hypotheses || []) {
    for (const id of hyp.relatedFactIds || []) if (!ids.includes(id)) ids.push(id);
  }
  return ids.slice(0, cap).map((id) => byId.get(id)).filter(Boolean);
}

export function buildDeepPrompt(report, facts) {
  return JSON.stringify({
    objective: report.objective,
    taskType: report.intent?.taskType,
    unknowns: report.unknowns || [],
    hypotheses: (report.hypotheses || []).map((h) => ({
      id: h.id,
      description: h.description,
      status: h.status,
      confidence: h.confidence,
      relatedFactIds: h.relatedFactIds,
    })),
    relevantMemory: (report.relevantMemory || []).map((m) => ({ rule: m.rule, confidence: m.confidence })),
    evidence: facts.map((f) => ({ id: f.id, file: f.file, line: f.line ?? null, snippet: norm(f.evidence).slice(0, 300) })),
  });
}

function parseDeepOutput(text) {
  const t = String(text || "").replace(/```(?:json)?/gi, "");
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("model did not return JSON");
  const obj = JSON.parse(t.slice(a, b + 1));
  if (!Array.isArray(obj.statements)) throw new Error("model JSON has no statements array");
  return { statements: obj.statements, uncertainty: typeof obj.uncertainty === "string" ? obj.uncertainty : "" };
}

/**
 * Stage 2 -- Deep Investigation. Only ever called when Stage 1 triage
 * (src/agent/triage.js) has decided the objective needs it, or the caller
 * explicitly forces it. Same non-negotiable rule as explain.js: nothing
 * is claimed without a citation, and every citation is checked against
 * real retrieved evidence -- verifyStatements is reused as-is, not
 * reimplemented, so the two LLM-facing surfaces in Rune can never drift
 * apart on what "grounded" means.
 */
export async function investigateDeep(report, graph, env = process.env, fetchImpl = globalThis.fetch) {
  const provider = resolveProvider(env);
  if (!provider) {
    return { needsSetup: true, skipped: "no model configured. Set ANTHROPIC_API_KEY, or OPENAI_API_KEY with RUNE_LLM_MODEL, or RUNE_LLM_BASE_URL (for example a local Ollama) with RUNE_LLM_MODEL." };
  }
  if (provider.error) return { needsSetup: true, skipped: provider.error };

  const facts = collectDeepFacts(report, graph);
  if (facts.length === 0) {
    return { skipped: "no evidence to investigate -- fast triage found nothing to escalate with." };
  }

  const prompt = buildDeepPrompt(report, facts);
  console.error(`[rune] deep investigation: sending ${facts.length} evidence snippet(s) (~${estimateTokens(prompt)} tokens, not your whole project) to ${provider.name} / ${provider.model}`);

  try {
    let text = await callModel(provider, SYSTEM, prompt, fetchImpl);
    if (env.RUNE_LLM_DEBUG) console.error("[rune] raw deep-investigation output:\n" + text);
    let parsed;
    try {
      parsed = parseDeepOutput(text);
    } catch {
      text = await callModel(provider, SYSTEM, prompt + "\n\nReply with ONLY the JSON object, starting with { and nothing else.", fetchImpl);
      if (env.RUNE_LLM_DEBUG) console.error("[rune] raw deep-investigation output (retry):\n" + text);
      parsed = parseDeepOutput(text);
    }
    const { kept, dropped } = verifyStatements(parsed.statements, facts);
    if (env.RUNE_LLM_DEBUG) for (const d of dropped) console.error("[rune] deep-investigation dropped: " + d.reason + (d.text ? " - " + d.text : ""));
    return { provider: provider.name, model: provider.model, kept, dropped, uncertainty: parsed.uncertainty, facts };
  } catch (err) {
    return { error: String(err?.message || err) };
  }
}
