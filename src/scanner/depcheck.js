import path from "node:path";

const WELL_KNOWN_PACKAGES = [
  "react", "express", "lodash", "axios", "chalk", "commander",
  "webpack", "eslint", "typescript", "jest", "babel", "vue",
  "next", "redux", "moment", "request", "async", "underscore",
];

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function findTyposquatMatch(depName) {
  for (const known of WELL_KNOWN_PACKAGES) {
    if (depName === known) continue;
    const dist = levenshtein(depName, known);
    if (dist > 0 && dist <= 2 && known.length >= 4) {
      return known;
    }
  }
  return null;
}

export function extractDependencyFindings(filePath, content, rootDir, nextId) {
  const relPath = path.relative(rootDir, filePath);
  if (path.basename(filePath) !== "package.json") return [];

  let pkg;
  try {
    pkg = JSON.parse(content);
  } catch {
    return [];
  }

  const findings = [];
  const lines = content.split("\n");
  const allDeps = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
  };

  for (const depName of Object.keys(allDeps)) {
    const typosquatTarget = findTyposquatMatch(depName);
    if (typosquatTarget) {
      const lineIdx = lines.findIndex((l) => l.includes(`"${depName}"`));
      const ln = lineIdx >= 0 ? lineIdx + 1 : 1;
      findings.push({
        id: nextId("depcheck"),
        type: "security_finding",
        category: "dependency_risk",
        rule: `Dependency name "${depName}" closely resembles popular package "${typosquatTarget}"`,
        severity: "medium",
        file: relPath,
        line: ln,
        evidence: lines[ln - 1]?.trim() || "",
        confidence: "low",
      });
    }
  }

  return findings;
}
