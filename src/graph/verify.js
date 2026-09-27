import fs from "node:fs";
import path from "node:path";
import { EVIDENCE_MAX_CHARS } from "../scanner/constants.js";

function currentEvidenceFor(rootDir, relFile, line) {
  const fullPath = path.join(rootDir, relFile);
  if (!fs.existsSync(fullPath)) return { fileExists: false, evidence: null };
  let content;
  try {
    content = fs.readFileSync(fullPath, "utf8");
  } catch {
    return { fileExists: false, evidence: null };
  }
  const lines = content.split("\n");
  if (line == null || line < 1 || line > lines.length) {
    return { fileExists: true, evidence: null };
  }
  const evidence = lines[line - 1]?.trim().slice(0, EVIDENCE_MAX_CHARS) || "";
  return { fileExists: true, evidence };
}

export function verifyFact(fact, rootDir) {
  if (!fact.file || fact.line == null || fact.evidence == null) {
    return { id: fact.id, status: "unverifiable" };
  }
  const { fileExists, evidence: currentEvidence } = currentEvidenceFor(rootDir, fact.file, fact.line);
  if (!fileExists) return { id: fact.id, status: "file_missing", file: fact.file };
  if (currentEvidence === null) return { id: fact.id, status: "line_gone", file: fact.file, line: fact.line };
  if (currentEvidence === fact.evidence) return { id: fact.id, status: "confirmed" };
  return { id: fact.id, status: "stale", file: fact.file, line: fact.line, previousEvidence: fact.evidence, currentEvidence };
}

export function verifyFacts(facts, rootDir) {
  const results = facts.map((fact) => verifyFact(fact, rootDir));
  const summary = { confirmed: 0, stale: 0, file_missing: 0, line_gone: 0, unverifiable: 0 };
  for (const r of results) summary[r.status] = (summary[r.status] ?? 0) + 1;
  return { verifiedAt: new Date().toISOString(), total: facts.length, summary, drifted: results.filter((r) => r.status !== "confirmed" && r.status !== "unverifiable") };
}
