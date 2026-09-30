import { resolveProvider, callModel } from '../llm/provider.js';

// Whitelist: the model may only propose these shapes. Everything else is dropped.
const SPECS = {
  import_removed: { req: ['target'], opt: ['file'] },
  import_added: { req: ['target'], opt: ['file'] },
  fact_removed: { req: ['entity'], opt: ['type', 'file'] },
  route_exists: { req: ['routePath'], opt: [] },
  no_remaining_references: { req: ['entity'], opt: [] },
  file_changed: { req: ['file'], opt: [] },
};

const SYSTEM = [
  "You translate an AI coding agent's claims about its own code changes into structural predicates.",
  'You never judge whether a claim is true. You only pick the predicate that would check it.',
  'Reply with ONLY a JSON array, one item per claim: {"i": <claim number>, "predicate": <object or null>}.',
  'Use null when a claim is about behavior, performance, bugs, intent, or anything not checkable from code structure.',
  'Predicate types and fields:',
  '  import_removed {target, file?}  import_added {target, file?}  fact_removed {entity, type?, file?}',
  '  route_exists {routePath}  no_remaining_references {entity}  file_changed {file}',
  'Use only file paths and names that appear in the claim text. Never invent them; omit optional fields instead.',
].join('\n');

const buildPrompt = (texts) =>
  'Claims:\n' + texts.map((t, i) => `${i}. ${t}`).join('\n');

export function validatePredicate(p) {
  if (!p || typeof p !== 'object') return null;
  const spec = SPECS[p.type];
  if (!spec) return null;
  const out = { type: p.type };
  for (const k of spec.req) {
    if (typeof p[k] !== 'string' || !p[k].trim()) return null;
    out[k] = p[k].trim();
  }
  for (const k of spec.opt) if (typeof p[k] === 'string' && p[k].trim()) out[k] = p[k].trim();
  return out;
}

function extractJson(text) {
  if (typeof text !== 'string') return null;
  const t = text.replace(/`{3}(?:json)?/g, '');
  const a = t.indexOf('['), b = t.lastIndexOf(']');
  if (a < 0 || b <= a) return null;
  try { const v = JSON.parse(t.slice(a, b + 1)); return Array.isArray(v) ? v : null; } catch { return null; }
}

export async function translateClaims(texts, { env = process.env, fetchImpl = globalThis.fetch, resolve = resolveProvider, call = callModel } = {}) {
  const provider = resolve(env);
  if (!provider) {
    return { needsSetup: true, skipped: 'no model configured. Set ANTHROPIC_API_KEY, or OPENAI_API_KEY with RUNE_LLM_MODEL, or RUNE_LLM_BASE_URL (for example a local Ollama) with RUNE_LLM_MODEL.' };
  }
  if (provider.error) return { needsSetup: true, skipped: provider.error };
  console.error(`[rune] sending ${texts.length} claim(s) (claim text only, no code) to ${provider.name} / ${provider.model}`);

  const prompt = buildPrompt(texts);
  let arr;
  try {
    arr = extractJson(await call(provider, SYSTEM, prompt, fetchImpl));
    if (!arr) arr = extractJson(await call(provider, SYSTEM, prompt + '\n\nReply with ONLY the JSON array, starting with [ and nothing else.', fetchImpl));
  } catch (e) {
    return { skipped: `model call failed: ${e.message}` };
  }
  if (!arr) return { skipped: 'model reply was not valid JSON' };

  const byIndex = new Map();
  for (const item of arr) if (item && Number.isInteger(item.i)) byIndex.set(item.i, item.predicate);
  const predicates = texts.map((claim, i) => {
    const v = validatePredicate(byIndex.get(i));
    return v ? { claim, ...v } : { claim, type: 'unmapped' };
  });
  return { provider: provider.name, model: provider.model, predicates };
}
