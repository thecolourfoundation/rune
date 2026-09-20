
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveProvider } from "../src/llm/provider.js";
import { explainReport } from "../src/llm/explain.js";

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "rune.js");

const graph = { facts: [{ id: "import_1", file: "lib/app.js", line: 1, evidence: "const Router = require('router');" }] };
const report = { objective: "how does routing work", synthesis: { insights: [{ insight: "lib/app.js", whyItMatters: "Loads router", evidenceRefs: ["import_1"] }] } };
const fakeFetch = (statements) => async () => ({
  ok: true,
  json: async () => ({ content: [{ type: "text", text: JSON.stringify({ statements }) }] }),
});

test("provider resolution: none, anthropic, and openai-compatible needing a model", () => {
  assert.equal(resolveProvider({}), null);
  assert.equal(resolveProvider({ ANTHROPIC_API_KEY: "k" }).kind, "anthropic");
  assert.match(resolveProvider({ OPENAI_API_KEY: "k" }).error, /RUNE_LLM_MODEL/);
  assert.equal(resolveProvider({ OPENAI_API_KEY: "k", RUNE_LLM_MODEL: "m" }).kind, "openai");
});

test("verification keeps grounded statements and drops fabricated ones", async () => {
  const out = await explainReport(report, graph, { ANTHROPIC_API_KEY: "k" }, fakeFetch([
    { text: "Routing is delegated to the external router package.", cites: ["import_1"], quote: "require('router')" },
    { text: "It uses a custom trie.", cites: ["import_999"] },
    { text: "Routes are defined in lib/routes.js.", cites: ["import_1"], quote: "app.get('/x')" },
    { text: "Uncited claim." , cites: [] },
  ]));
  assert.equal(out.kept.length, 1);
  assert.equal(out.dropped.length, 3);
  assert.match(out.kept[0].text, /router package/);
});

test("bad model output is reported, never thrown", async () => {
  const badFetch = async () => ({ ok: true, json: async () => ({ content: [{ type: "text", text: "sorry, no JSON here" }] }) });
  const out = await explainReport(report, graph, { ANTHROPIC_API_KEY: "k" }, badFetch);
  assert.ok(out.error);
});

test("no key configured: skipped, nothing sent", async () => {
  let called = false;
  const out = await explainReport(report, graph, {}, async () => { called = true; });
  assert.ok(out.skipped);
  assert.equal(called, false);
});

test("CLI with no model configured prints evidence, then setup help, exit 2", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rune-explain-"));
  fs.mkdirSync(path.join(dir, "lib"));
  fs.writeFileSync(path.join(dir, "lib", "app.js"), "const Router = require('router');\nmodule.exports = Router;\n");
  const r = spawnSync(process.execPath, [BIN, "how does routing work", dir, "--explain"], { encoding: "utf8", env: { PATH: process.env.PATH } });
  assert.match(r.stdout, /bring-your-own-model/);
  assert.equal(r.status, 2);
});

test("CLI --evidence-only prints evidence and exits 0 with no model", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rune-evidence-only-"));
  fs.mkdirSync(path.join(dir, "lib"));
  fs.writeFileSync(path.join(dir, "lib", "app.js"), "const Router = require('router');\nmodule.exports = Router;\n");
  const r = spawnSync(process.execPath, [BIN, "how does routing work", dir, "--evidence-only"], { encoding: "utf8", env: { PATH: process.env.PATH } });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Rune Agent/);
  assert.doesNotMatch(r.stdout, /bring-your-own-model/);
});
