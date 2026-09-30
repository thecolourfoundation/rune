import { buildGraph } from '../graph/build.js';
import { computeImpact } from '../graph/impact.js';
import { resolveProvider, callModel } from '../llm/provider.js';
import { isTestFile } from './after.js';

const STOP = new Set(['the', 'and', 'for', 'not', 'but', 'with', 'this', 'that', 'when', 'why', 'how', 'what', 'from', 'into', 'are', 'was', 'has', 'have', 'does', 'doesnt', 'fails', 'failing', 'error', 'bug', 'issue', 'problem', 'broken', 'works', 'working']);
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

const SYSTEM = [
  'You propose competing explanations for a software problem. You do not know which one is true.',
  'Reply with ONLY a JSON array of 2 to 4 objects: {"explanation": string, "factIds": string[], "confirmWith": string, "ruleOutWith": string}.',
  'factIds must be ids taken from the evidence list, naming the facts that support that explanation.',
  'An explanation with no supporting ids from the list will be discarded.',
  'confirmWith and ruleOutWith are one sentence each: what to inspect or run to confirm or rule the explanation out.',
  'Never present any explanation as certain.',
].join('\n');

const keywords = (problem) =>
  [...new Set(String(problem).toLowerCase().match(/[a-z_][a-z0-9_.\/-]{2,}/g) ?? [])].filter((w) => !STOP.has(w));

export function pickFacts(facts, problem, cap = 40) {
  const kws = keywords(problem);
  const scored = [];
  for (const f of facts) {
    if (String(f.type).startsWith('doc')) continue;
    const hay = `${f.file ?? ''} ${f.entity ?? ''} ${f.callee ?? ''} ${f.target ?? ''} ${f.routePath ?? ''}`.toLowerCase();
    const score = kws.filter((k) => hay.includes(k)).length;
    if (score) scored.push([score, f]);
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, cap).map((x) => x[1]);
}

function extractJson(text) {
  if (typeof text !== 'string') return null;
  const t = text.replace(/`{3}(?:json)?/g, '');
  const a = t.indexOf('['), b = t.lastIndexOf(']');
  if (a < 0 || b <= a) return null;
  try { const v = JSON.parse(t.slice(a, b + 1)); return Array.isArray(v) ? v : null; } catch { return null; }
}

export async function generateHypotheses(dir, problem, { env = process.env, fetchImpl = globalThis.fetch, resolve = resolveProvider, call = callModel, graph } = {}) {
  if (typeof problem !== 'string' || !problem.trim()) return { skipped: 'describe the problem in a sentence' };
  const provider = resolve(env);
  if (!provider) {
    return { needsSetup: true, skipped: 'no model configured. Set ANTHROPIC_API_KEY, or OPENAI_API_KEY with RUNE_LLM_MODEL, or RUNE_LLM_BASE_URL (for example a local Ollama) with RUNE_LLM_MODEL.' };
  }
  if (provider.error) return { needsSetup: true, skipped: provider.error };

  const g = graph ?? (await buildGraph(dir));
  const facts = pickFacts(g.facts ?? [], problem);
  if (!facts.length) return { skipped: 'no facts matched the problem; mention a file, function or route name' };
  const byId = new Map(facts.map((f) => [f.id, f]));

  console.error(`[rune] sending ${facts.length} evidence snippet(s) (code excerpts, not your whole project) to ${provider.name} / ${provider.model}`);
  const evidenceList = facts.map((f) => `${f.id} | ${f.type} | ${f.file}:${f.line ?? '?'} | ${clip(f.evidence, 120)}`).join('\n');
  const prompt = `Problem: ${clip(problem, 400)}\n\nEvidence:\n${evidenceList}`;

  let arr;
  try {
    arr = extractJson(await call(provider, SYSTEM, prompt, fetchImpl));
    if (!arr) arr = extractJson(await call(provider, SYSTEM, prompt + '\n\nReply with ONLY the JSON array, starting with [ and nothing else.', fetchImpl));
  } catch (e) {
    return { skipped: `model call failed: ${e.message}` };
  }
  if (!arr) return { skipped: 'model reply was not valid JSON' };

  const hypotheses = [];
  let dropped = 0;
  for (const item of arr.slice(0, 8)) {
    const ids = Array.isArray(item?.factIds) ? item.factIds.filter((id) => byId.has(id)) : [];
    const explanation = clip(item?.explanation, 300);
    if (!explanation || !ids.length) { dropped++; continue; }
    if (hypotheses.length === 4) { dropped++; continue; }
    const evidence = ids.map((id) => ({ id, file: byId.get(id).file, line: byId.get(id).line ?? null }));
    const tests = new Set();
    for (const file of new Set(evidence.map((e) => e.file))) {
      try {
        for (const d of computeImpact(g, file)?.dependents ?? []) if (isTestFile(d.file)) tests.add(d.file);
      } catch {}
    }
    hypotheses.push({ explanation, evidence, confirmWith: clip(item?.confirmWith, 200), ruleOutWith: clip(item?.ruleOutWith, 200), tests: [...tests].slice(0, 5) });
  }

  const notes = ['hypotheses are unverified; each is only as strong as the evidence it cites'];
  if (hypotheses.length < 2) notes.push('fewer than 2 explanations were supported by evidence, so Rune cannot offer a competing set');
  if (dropped) notes.push(`${dropped} proposed explanation(s) dropped for citing no valid evidence`);
  return { provider: provider.name, model: provider.model, problem: clip(problem, 400), factsConsidered: facts.length, hypotheses, dropped, notes };
}

export function formatHypotheses(h) {
  const L = [`HYPOTHESES for: ${h.problem}`, '(unverified: none of these is a finding)', ''];
  h.hypotheses.forEach((x, i) => {
    L.push(`${i + 1}. ${x.explanation}`, `   evidence: ${x.evidence.map((e) => `${e.file}:${e.line ?? '?'}`).join(', ')}`);
    if (x.confirmWith) L.push(`   confirm: ${x.confirmWith}`);
    if (x.ruleOutWith) L.push(`   rule out: ${x.ruleOutWith}`);
    if (x.tests.length) L.push(`   related tests: ${x.tests.join(', ')}`);
    L.push('');
  });
  L.push(...h.notes.map((n) => `- ${n}`));
  return L.join('\n');
}
