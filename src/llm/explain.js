import { resolveProvider, callModel } from "./provider.js";

const SYSTEM = `You explain a software project to a developer using ONLY the numbered evidence facts you are given. Return JSON only, with no prose and no code fences, in this shape:
{"statements":[{"text":"one plain sentence","cites":["fact id"],"quote":"optional exact text copied from a cited snippet"}]}
Rules: every statement must cite at least one fact id from the evidence; never mention files, packages or behavior that the evidence does not show; if the evidence does not answer the question, say so in one statement that cites the closest fact.`;

const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();

export function collectFacts(report, graph, cap = 40) {
  const byId = new Map((graph.facts || []).map((f) => [f.id, f]));
  const ids = [];
  for (const ins of report.synthesis?.insights || []) {
    for (const id of ins.evidenceRefs || []) if (!ids.includes(id)) ids.push(id);
  }
  return ids.slice(0, cap).map((id) => byId.get(id)).filter(Boolean);
}

export function buildPrompt(report, facts) {
  return JSON.stringify({
    question: report.objective,
    rune_findings: (report.synthesis?.insights || []).map((i) => ({ area: i.insight, note: i.whyItMatters })),
    evidence: facts.map((f) => ({ id: f.id, file: f.file, line: f.line ?? null, snippet: norm(f.evidence).slice(0, 300) })),
  });
}

export function parseStatements(text) {
  const t = String(text || "").replace(/```(?:json)?/gi, "");
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("model did not return JSON");
  const obj = JSON.parse(t.slice(a, b + 1));
  if (!Array.isArray(obj.statements)) throw new Error("model JSON has no statements array");
  return obj.statements;
}

// The verification rule: a statement survives only if everything it cites was
// really retrieved, and any quote it gives really appears in the cited evidence.
export function verifyStatements(statements, facts) {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const kept = [];
  const dropped = [];
  for (const s of statements) {
    const text = typeof s?.text === "string" ? s.text.trim() : "";
    const cites = Array.isArray(s?.cites) ? s.cites.filter((c) => typeof c === "string") : [];
    if (!text) { dropped.push({ reason: "empty statement" }); continue; }
    if (cites.length === 0) { dropped.push({ reason: "no citation", text }); continue; }
    const unknown = cites.filter((c) => !byId.has(c));
    if (unknown.length > 0) { dropped.push({ reason: "cites unknown evidence: " + unknown.join(", "), text }); continue; }
    if (typeof s.quote === "string" && s.quote.trim()) {
      const q = norm(s.quote);
      if (!cites.some((c) => norm(byId.get(c).evidence).includes(q))) {
        dropped.push({ reason: "quote not found in cited evidence", text });
        continue;
      }
    }
    kept.push({ text, cites });
  }
  return { kept, dropped };
}

export async function explainReport(report, graph, env = process.env, fetchImpl = globalThis.fetch) {
  const provider = resolveProvider(env);
  if (!provider) {
    return { skipped: "no model configured. Set ANTHROPIC_API_KEY, or OPENAI_API_KEY with RUNE_LLM_MODEL, or RUNE_LLM_BASE_URL (for example a local Ollama) with RUNE_LLM_MODEL." };
  }
  if (provider.error) return { skipped: provider.error };
  const facts = collectFacts(report, graph);
  if (facts.length === 0) return { skipped: "no evidence to explain." };
  console.error(`[rune] sending ${facts.length} evidence snippet(s) (not your whole project) to ${provider.name} / ${provider.model}`);
  try {
    const text = await callModel(provider, SYSTEM, buildPrompt(report, facts), fetchImpl);
    const { kept, dropped } = verifyStatements(parseStatements(text), facts);
    return { provider: provider.name, model: provider.model, kept, dropped, facts };
  } catch (err) {
    return { error: String(err?.message || err) };
  }
}
