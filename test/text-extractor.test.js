
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractTextFacts } from "../src/scanner/text.js";
import { createIdGenerator } from "../src/scanner/id.js";
import { buildGraph } from "../src/graph/build.js";
import { runAgentLoop } from "../src/agent/loop.js";

const CONTRACT = [
  "SERVICES AGREEMENT",
  "",
  'This Agreement is made on March 1, 2026 between Acme Ltd (the "Company") and Beta LLC (the "Contractor").',
  "",
  "Article 1 Definitions",
  "",
  '"Services" means the work described in Schedule A.',
  "",
  "Section 2.1 Payment",
  "",
  "The Company shall pay the Contractor $12,500 within 30 days of each invoice, subject to Section 4.2.",
  "",
  "Section 3 of this Agreement survives termination.",
  "",
  "Section 4.2 Termination",
  "",
  "Either party may terminate this Agreement on 30 days notice. See Article 1 for defined terms.",
  "",
].join("\n");

function extract(name, text) {
  const root = "/tmp/proj";
  return extractTextFacts(path.join(root, name), text, root, createIdGenerator());
}
function project(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rune-text-"));
  for (const [n, t] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), t);
  return dir;
}

test("finds sections, definitions, references, dates and amounts with line numbers", () => {
  const facts = extract("agreement.txt", CONTRACT);
  const by = (type) => facts.filter((f) => f.type === type);
  assert.deepEqual(by("text_section").map((f) => f.name), ["Article 1 Definitions", "Section 2.1 Payment", "Section 4.2 Termination"]);
  assert.deepEqual(by("text_definition").map((f) => f.name).sort(), ["Company", "Contractor", "Services"]);
  const refs = new Set(by("text_reference").map((f) => f.target));
  for (const r of ["Section 4.2", "Section 3", "Schedule A", "Article 1"]) assert.ok(refs.has(r), "missing reference " + r);
  assert.equal(by("text_amount")[0].name, "$12,500");
  assert.equal(by("text_amount")[0].line, 11);
  assert.equal(by("text_date")[0].name, "March 1, 2026");
  const pay = by("text_paragraph").find((f) => f.name.startsWith("The Company shall pay"));
  assert.equal(pay.section, "Section 2.1");
});

test("a sentence that starts with 'Section 3 of...' is not a heading", () => {
  const sections = extract("agreement.txt", CONTRACT).filter((f) => f.type === "text_section").map((f) => f.label);
  assert.ok(!sections.includes("Section 3"));
});

test("unstructured text files produce no facts", () => {
  assert.deepEqual(extract("requirements.txt", "express==4.18.2\nlodash>=4\n"), []);
  assert.deepEqual(extract("notes.txt", "Meeting on March 3, 2026. Budget $500.\n"), []);
});

test("a folder of only documents is a successful scan", () => {
  const graph = buildGraph(project({ "agreement.txt": CONTRACT }));
  assert.notEqual(graph.meta.status, "no_supported_files");
  assert.ok(graph.facts.some((f) => f.type === "text_section"));
});

test("the agent answers a question about a document with a matching passage", () => {
  const report = runAgentLoop("how does payment work", project({ "agreement.txt": CONTRACT }));
  const insights = report.synthesis.insights;
  assert.ok(insights.length > 0, "no insights for a document question");
  assert.match(insights[0].whyItMatters, /Matching passage/);
  assert.ok(insights[0].evidenceRefs.length > 0);
});

import { verifyFact } from "../src/graph/verify.js";

test("every text fact verifies as confirmed against its source line", () => {
  const dir = project({ "agreement.txt": CONTRACT });
  const graph = buildGraph(dir);
  const textFacts = graph.facts.filter((f) => String(f.type).startsWith("text_"));
  assert.ok(textFacts.length > 0);
  for (const f of textFacts) assert.equal(verifyFact(f, dir).status, "confirmed", f.type + " at line " + f.line);
});

test("a question about a heading quotes the paragraph under it", () => {
  const report = runAgentLoop("how does payment work", project({ "agreement.txt": CONTRACT }));
  assert.match(report.synthesis.insights[0].whyItMatters, /shall pay/);
});
