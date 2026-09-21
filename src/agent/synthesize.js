/**
 * Synthesis layer: clusters ranked hypotheses into concept-level insights
 * and enforces output constraints from the parsed intent.
 */

function clusterByArea(hypotheses) {
  const clusters = new Map();
  for (const hyp of hypotheses) {
    const area = (hyp.description.match(/:\s*(\S+)$/)?.[1] || "unknown").split("/").slice(0, 2).join("/");
    if (!clusters.has(area)) clusters.set(area, []);
    clusters.get(area).push(hyp);
  }
  return [...clusters.entries()].map(([area, hyps]) => ({
    area,
    hypotheses: hyps.sort((a, b) => b.confidence - a.confidence),
    maxConfidence: Math.max(...hyps.map((h) => h.confidence)),
  })).sort((a, b) => b.maxConfidence - a.maxConfidence);
}

const AREA_DESCRIPTIONS = [
  { pattern: /^install\//, insight: "Installation & system bootstrap", why: "Handles first-run setup and environment provisioning — changes here affect every fresh install." },
  { pattern: /^migrations?\//, insight: "Migration scripts", why: "Handles version-to-version upgrades; bugs here can break existing installs silently." },
  { pattern: /^test\//, insight: "Test coverage", why: "Validates behavior in this area; changes without matching test updates risk silent regressions." },
  { pattern: /^(shell|default\/hypr)\//, insight: "Shell / session layer", why: "Core desktop/session behavior users interact with directly." },
  { pattern: /^(config|default)\//, insight: "Configuration & defaults", why: "Governs default behavior across the system; changes here have a broad blast radius." },
  { pattern: /^(docs|manual)\//, insight: "Documentation", why: "User- and agent-facing docs; drift here misleads whoever reads it next." },
  { pattern: /^plans\//, insight: "Planning notes", why: "Forward-looking design notes, not shipped behavior — lower urgency than active code." },
];

// Turns the facts behind an insight into a plain description. Returns null
// when the facts don't support a specific statement (caller falls back).
function describeEvidence(facts) {
  const usable = (facts || []).filter(Boolean);
  if (usable.length === 0) return null;

  const passages = usable.filter((f) => /^text_/.test(String(f.type)));
  if (passages.length > 0) {
    const first = passages.find((f) => f.type === "text_paragraph") || passages[0];
    const where = first.section ? first.section + ", " : "";
    const quote = String((first.type === "text_paragraph" ? first.name : first.evidence) || first.name || "").replace(/\s+/g, " ").trim().slice(0, 140);
    return `Matching passage in this document (${where}line ${first.line}): "${quote}"${passages.length > 1 ? ` (+${passages.length - 1} more)` : ""}.`;
  }

  const routes = usable.filter((f) => /route/.test(String(f.type)) && (f.routePath || f.route));
  if (routes.length > 0) {
    const shown = routes.slice(0, 3).map((f) => `${f.method ? f.method + " " : ""}${f.routePath || f.route}`);
    const more = routes.length > shown.length ? ` (+${routes.length - shown.length} more)` : "";
    return `Defines routes: ${shown.join(", ")}${more}.`;
  }

  const imports = usable.filter((f) => /import|require/.test(String(f.type)) && typeof f.target === "string" && f.target);
  if (imports.length > 0) {
    const external = [...new Set(imports.map((f) => f.target).filter((t) => !t.startsWith(".") && !t.startsWith("/") && !t.startsWith("node:")))];
    if (external.length > 0) {
      const names = external.slice(0, 3).map((t) => "`" + t + "`").join(", ");
      const ev = typeof imports[0].evidence === "string" ? ` (${imports[0].evidence.trim().slice(0, 80)})` : "";
      return `Loads the external package ${names}${ev} - logic tied to this name likely lives there, not in this repo.`;
    }
    const internal = [...new Set(imports.map((f) => f.target))].slice(0, 3).map((t) => "`" + t + "`").join(", ");
    return `Imports local module ${internal}.`;
  }
  return null;
}

function describeArea(area, factCount, evidenceFacts) {
  const match = AREA_DESCRIPTIONS.find((d) => d.pattern.test(area));
  if (match) return { insight: match.insight, whyItMatters: match.why };
  return {
    insight: area,
    whyItMatters: describeEvidence(evidenceFacts) || `${factCount} related fact(s) grouped under this path.`,
  };
}

// Default when the objective asks for no specific count.
const DEFAULT_MAX_INSIGHTS = 8;

export function synthesize(rankedHypotheses, outputConstraints = {}, factsById = new Map()) {
  const areaClusters = clusterByArea(rankedHypotheses);
  const merged = new Map();
  for (const cluster of areaClusters) {
    const topHyp = [...cluster.hypotheses].sort((x, y) => y.confidence - x.confidence)[0];
    const evidenceFacts = topHyp.relatedFactIds.slice(0, 5).map((id) => factsById.get(id));
    const { insight, whyItMatters } = describeArea(cluster.area, cluster.hypotheses[0].relatedFactIds.length, evidenceFacts);
    if (!merged.has(insight)) {
      merged.set(insight, { insight, whyItMatters, area: cluster.area, hypotheses: [], maxConfidence: 0 });
    }
    const entry = merged.get(insight);
    entry.hypotheses.push(...cluster.hypotheses);
    entry.maxConfidence = Math.max(entry.maxConfidence, cluster.maxConfidence);
  }
  let mergedClusters = [...merged.values()].sort((a, b) => b.maxConfidence - a.maxConfidence);

  if (outputConstraints.exactCount) {
    mergedClusters = mergedClusters.slice(0, outputConstraints.exactCount);
  } else if (mergedClusters.length > DEFAULT_MAX_INSIGHTS) {
    mergedClusters = mergedClusters.slice(0, DEFAULT_MAX_INSIGHTS);
  }

  const evidenceCap = outputConstraints.maxEvidenceRefs ?? 5;

  const insights = mergedClusters.map((cluster, i) => {
    const top = [...cluster.hypotheses].sort((a, b) => b.confidence - a.confidence)[0];
    return {
      rank: i + 1,
      area: cluster.area,
      insight: cluster.insight,
      whyItMatters: cluster.whyItMatters,
      confidence: top.confidence,
      evidenceRefs: top.relatedFactIds.slice(0, evidenceCap),
      supportingHypotheses: cluster.hypotheses.length,
    };
  });

  return {
    insights,
    constraintsApplied: { ...outputConstraints, maxEvidenceRefs: evidenceCap },
    totalClustersFound: mergedClusters.length,
  };
}
