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

function describeArea(area, factCount) {
  const match = AREA_DESCRIPTIONS.find((d) => d.pattern.test(area));
  if (match) return { insight: match.insight, whyItMatters: match.why };
  return {
    insight: area,
    whyItMatters: `A distinct functional area with ${factCount} related fact(s); no heuristic category matched, so this label is the raw path prefix.`,
  };
}

export function synthesize(rankedHypotheses, outputConstraints = {}) {
  const areaClusters = clusterByArea(rankedHypotheses);
  const merged = new Map();
  for (const cluster of areaClusters) {
    const { insight, whyItMatters } = describeArea(cluster.area, cluster.hypotheses[0].relatedFactIds.length);
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
