import { verifyFact } from "../graph/verify.js";

export const PROVENANCE = ["observed", "inferred", "supplied", "verified"];

const idOf = (x) => (x && typeof x === "object" ? x.id : x);

export function buildEvidenceSlice(graph, rootDir, files) {
  const set = new Set(files);
  const allFacts = graph.facts || [];
  const byId = new Map(allFacts.map((f) => [f.id, f]));
  const cache = new Map();
  const check = (f) => {
    if (!cache.has(f.id)) cache.set(f.id, verifyFact(f, rootDir));
    return cache.get(f.id);
  };

  const evidence = allFacts
    .filter((f) => set.has(f.file))
    .map((f) => {
      const r = check(f);
      return {
        id: f.id, type: f.type, file: f.file, line: f.line, evidence: f.evidence,
        status: r.status,
        provenance: r.status === "confirmed" ? "verified" : "observed",
      };
    });

  const claims = [];
  for (const d of graph.derived || []) {
    const raw = Array.isArray(d.basedOn) ? d.basedOn : d.basedOn ? [d.basedOn] : [];
    const supporting = raw.map((i) => byId.get(idOf(i))).filter(Boolean);
    const touches = set.has(d.file) || supporting.some((f) => set.has(f.file));
    if (!touches) continue;
    const supports = supporting.map((f) => ({ id: f.id, file: f.file, line: f.line, status: check(f).status }));
    const allOk = supports.length > 0 && supports.every((s) => s.status === "confirmed");
    claims.push({
      id: d.id ?? `${d.type}:${d.file}`,
      type: d.type, file: d.file,
      provenance: allOk ? "verified" : "inferred",
      supports,
    });
  }
  return { evidence, claims };
}
