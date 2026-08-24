import path from "node:path";

const WORKFLOW_PATH_RE = /\.github[\/\\]workflows[\/\\][^\/\\]+\.ya?ml$/;

const RULES = [
  {
    name: "Workflow grants write-all permissions",
    re: /permissions:\s*write-all/i,
    severity: "high",
  },
  {
    name: "Workflow grants broad contents:write permission",
    re: /permissions:[\s\S]{0,200}?contents:\s*write/i,
    severity: "medium",
  },
  {
    name: "pull_request_target used (runs with base-repo secrets on fork PRs)",
    re: /^\s*pull_request_target\s*:/m,
    severity: "high",
  },
  {
    name: "Workflow checks out PR head ref while triggered by pull_request_target",
    re: null,
    severity: "critical",
    special: "pwn_request",
  },
];

function evidenceAt(lines, ln, maxChars = 160) {
  const raw = lines[ln - 1]?.trim() || "";
  return raw.length > maxChars ? raw.slice(0, maxChars) + "..." : raw;
}

export function extractWorkflowFindings(filePath, content, rootDir, nextId) {
  const relPath = path.relative(rootDir, filePath);
  if (!WORKFLOW_PATH_RE.test(filePath.replace(/\\/g, "/"))) return [];

  const findings = [];
  const lines = content.split("\n");

  const hasPullRequestTarget = /^\s*pull_request_target\s*:/m.test(content);
  const checksOutHeadRef = /uses:\s*actions\/checkout@[^\n]*\n[\s\S]{0,200}?ref:\s*\$\{\{\s*github\.event\.pull_request\.head/i.test(content) ||
    /ref:\s*\$\{\{\s*github\.event\.pull_request\.head\.(sha|ref)/i.test(content);

  for (const rule of RULES) {
    if (rule.special === "pwn_request") {
      if (hasPullRequestTarget && checksOutHeadRef) {
        const checkoutMatch = content.match(/ref:\s*\$\{\{\s*github\.event\.pull_request\.head\.(sha|ref)[^\n]*/i);
        const idx = checkoutMatch ? content.indexOf(checkoutMatch[0]) : 0;
        const ln = content.slice(0, idx).split("\n").length;
        findings.push({
          id: nextId("workflow"),
          type: "security_finding",
          category: "ci_permission_risk",
          rule: rule.name,
          severity: rule.severity,
          file: relPath,
          line: ln,
          evidence: evidenceAt(lines, ln),
          confidence: "medium",
        });
      }
      continue;
    }

    const m = rule.re.exec(content);
    if (m) {
      const ln = content.slice(0, m.index).split("\n").length;
      findings.push({
        id: nextId("workflow"),
        type: "security_finding",
        category: "ci_permission_risk",
        rule: rule.name,
        severity: rule.severity,
        file: relPath,
        line: ln,
        evidence: evidenceAt(lines, ln),
        confidence: "medium",
      });
    }
  }

  return findings;
}
