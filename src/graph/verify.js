import fs from "node:fs";
import path from "node:path";

// Must match EVIDENCE_MAX_CHARS in scanner/facts.js and scanner/express.js -
// verification re-derives evidence the same way extraction did, so the two
// have to agree on the truncation length or every fact would look "stale"
// just from a formatting mismatch.
const EVIDENCE_MAX_CHARS = 160;

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

/**
 * Re-checks a single fact against the current state of its source file.
 * Deliberately cheap: reads one file and re-derives one line of evidence,
 * not a full re-scan or re-parse of the project.
 *
 * Facts missing file/line/evidence (should not happen for current
 * extractors, but graph.json is user-editable JSON on disk) are reported
 * "unverifiable" rather than silently counted as confirmed - an agent
 * trusting Rune's output should be able to tell "checked and true" apart
 * from "couldn't check."
 */
export function verifyFact(fact, rootDir) {
  if (!fact.file || fact.line == null || fact.evidence == null) {
    return { id: fact.id, status: "unverifiable" };
  }

  const { fileExists, evidence: currentEvidence } = currentEvidenceFor(rootDir, fact.file, fact.line);

  if (!fileExists) {
    return { id: fact.id, status: "file_missing", file: fact.file };
  }
  if (currentEvidence === null) {
    return { id: fact.id, status: "line_gone", file: fact.file, line: fact.line };
  }
  if (currentEvidence === fact.evidence) {
    return { id: fact.id, status: "confirmed" };
  }
  return {
    id: fact.id,
    status: "stale",
    file: fact.file,
    line: fact.line,
    previousEvidence: fact.evidence,
    currentEvidence,
  };
}

/**
 * Verifies a batch of facts (typically an entire graph.facts array) and
 * summarizes drift. Backs both a `rune verify` CLI report and an MCP tool
 * an agent can call before trusting a stored fact - turning "here's what
 * Rune found once" into "here's what's true right now, checked live."
 */
export function verifyFacts(facts, rootDir) {
  const results = facts.map((fact) => verifyFact(fact, rootDir));

  const summary = { confirmed: 0, stale: 0, file_missing: 0, line_gone: 0, unverifiable: 0 };
  for (const r of results) {
    summary[r.status] = (summary[r.status] ?? 0) + 1;
  }

  return {
    verifiedAt: new Date().toISOString(),
    total: facts.length,
    summary,
    drifted: results.filter((r) => r.status !== "confirmed" && r.status !== "unverifiable"),
  };
}
