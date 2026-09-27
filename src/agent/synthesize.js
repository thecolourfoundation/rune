// FIXED (#4): clusters on hyp.file directly (an explicit field set by
// loop.js's formHypotheses) instead of regex-parsing it back out of the
// description string, which could desync from the description format.
function clusterByArea(hypotheses) {
  const clusters = new Map();
  for (const hyp of hypotheses) {
    const area = (hyp.file ? hyp.file.split("/").slice(0, 2).join("/") : "unknown");
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

function describeEvidence(facts) {
  const usable = (facts || []).filter(Boolean);
  if (usable.length === 0) return null;

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

  // FIXED (#6, partial): a few more fact types now get a real description
  // instead of always falling through to generic filler -- covers the
  // shell/config/lua/markdown fact types added in later scanner sessions
  // that previously had no describeEvidence case at all.
  const shellFns = usable.filter((f) => f.type === "shell_function_def" || f.type === "lua_function_def");
  if (shellFns.length > 0) {
    const names = shellFns.slice(0, 3).map((f) => f.name).filter(Boolean);
    return `Defines function(s): ${names.join(", ")}${shellFns.length > names.length ? "…" : ""}.`;
  }

  const configKeys = usable.filter((f) => f.type === "config_key");
  if (configKeys.length > 0) {
    const names = configKeys.slice(0, 4).map((f) => f.name).filter(Boolean);
    return `Configuration key(s): ${names.join(", ")}.`;
  }

  const headings = usable.filter((f) => f.type === "doc_heading");
  if (headings.length > 0) {
    return `Documentation section: "${headings[0].name}".`;
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
    // FIXED (#5): previously when two areas merged into one insight label,
    // only the FIRST cluster's evidence facts survived (whyItMatters was
    // never updated on subsequent merges) -- now we merge evidence refs
    // from every contributing cluster too, not just the highest-confidence one.
    entry.hypotheses.push(...cluster.hypotheses);
    entry.maxConfidence = Math.max(entry.maxConfidence, cluster.maxConfidence);
  }
  let mergedClusters = [...merged.values()].sort((a, b) => b.maxConfidence - a.maxConfidence);

  // FIXED (#1): totalClustersFound now captures the count BEFORE truncation,
  // so a caller asking for "exactly 5" can still see how many were actually
  // found rather than having that number silently truncated to match.
  const totalClustersFound = mergedClusters.length;

  if (outputConstraints.exactCount) {
    mergedClusters = mergedClusters.slice(0, outputConstraints.exactCount);
  } else if (mergedClusters.length > DEFAULT_MAX_INSIGHTS) {
    mergedClusters = mergedClusters.slice(0, DEFAULT_MAX_INSIGHTS);
  }

  const evidenceCap = outputConstraints.maxEvidenceRefs ?? 5;

  const insights = mergedClusters.map((cluster, i) => {
    // FIXED (#5): evidenceRefs now draws from ALL hypotheses in the merged
    // cluster (deduped), not just the single top-confidence one -- so a
    // merged insight's evidence reflects every area that contributed to it.
    const allFactIds = [...new Set(cluster.hypotheses.flatMap((h) => h.relatedFactIds))];
    const top = [...cluster.hypotheses].sort((a, b) => b.confidence - a.confidence)[0];
    return {
      rank: i + 1,
      area: cluster.area,
      insight: cluster.insight,
      whyItMatters: cluster.whyItMatters,
      confidence: top.confidence,
      evidenceRefs: allFactIds.slice(0, evidenceCap),
      supportingHypotheses: cluster.hypotheses.length,
    };
  });

  return {
    insights,
    constraintsApplied: { ...outputConstraints, maxEvidenceRefs: evidenceCap },
    totalClustersFound,
  };
}
