// Bring-your-own-key model access. Plain fetch, no SDKs. Nothing is sent
// anywhere unless the user opts in with --explain AND has configured a key.
const ANTHROPIC_DEFAULT_MODEL = "claude-haiku-4-5-20251001";

export function resolveProvider(env = process.env) {
  const explicit = (env.RUNE_LLM_PROVIDER || "").toLowerCase();
  let kind = null;
  if (explicit === "anthropic" || explicit === "openai") kind = explicit;
  else if (env.ANTHROPIC_API_KEY) kind = "anthropic";
  else if (env.RUNE_LLM_BASE_URL || env.OPENAI_API_KEY) kind = "openai";
  if (!kind) return null;

  if (kind === "anthropic") {
    const key = env.RUNE_LLM_API_KEY || env.ANTHROPIC_API_KEY;
    if (!key) return { error: "Set ANTHROPIC_API_KEY to use --explain with Anthropic." };
    return { kind, name: "anthropic", model: env.RUNE_LLM_MODEL || ANTHROPIC_DEFAULT_MODEL, key, baseUrl: "https://api.anthropic.com" };
  }
  const baseUrl = (env.RUNE_LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const key = env.RUNE_LLM_API_KEY || env.OPENAI_API_KEY || "";
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(baseUrl);
  if (!key && !local) return { error: "Set OPENAI_API_KEY (or RUNE_LLM_API_KEY) to use --explain." };
  if (!env.RUNE_LLM_MODEL) return { error: "Set RUNE_LLM_MODEL to the model name to use with this endpoint." };
  return { kind, name: local ? "local" : "openai-compatible", model: env.RUNE_LLM_MODEL, key, baseUrl };
}

export async function callModel(provider, system, user, fetchImpl = globalThis.fetch) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 60000);
  try {
    let res;
    if (provider.kind === "anthropic") {
      res = await fetchImpl(`${provider.baseUrl}/v1/messages`, {
        method: "POST",
        signal: ctl.signal,
        headers: { "content-type": "application/json", "x-api-key": provider.key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: provider.model, max_tokens: 1500, system, messages: [{ role: "user", content: user }] }),
      });
    } else {
      const headers = { "content-type": "application/json" };
      if (provider.key) headers.authorization = `Bearer ${provider.key}`;
      res = await fetchImpl(`${provider.baseUrl}/chat/completions`, {
        method: "POST",
        signal: ctl.signal,
        headers,
        body: JSON.stringify({ model: provider.model, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
      });
    }
    if (!res.ok) {
      const detail = typeof res.text === "function" ? (await res.text()).slice(0, 200) : "";
      throw new Error(`${provider.name} returned HTTP ${res.status}${detail ? ": " + detail : ""}`);
    }
    const body = await res.json();
    return provider.kind === "anthropic"
      ? (body.content || []).map((c) => c.text || "").join("")
      : body.choices?.[0]?.message?.content || "";
  } finally {
    clearTimeout(timer);
  }
}
