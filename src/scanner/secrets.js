import path from "node:path";

const SECRET_PATTERNS = [
  { name: "AWS Access Key ID", re: /\bAKIA[0-9A-Z]{16}\b/g, severity: "high" },
  { name: "AWS Secret Access Key (assignment)", re: /aws_secret_access_key\s*[:=]\s*['"][A-Za-z0-9/+=]{40}['"]/gi, severity: "high" },
  { name: "GitHub personal access token", re: /\bghp_[A-Za-z0-9]{36}\b/g, severity: "high" },
  { name: "GitHub OAuth token", re: /\bgho_[A-Za-z0-9]{36}\b/g, severity: "high" },
  { name: "GitHub fine-grained PAT", re: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g, severity: "high" },
  { name: "Private key block", re: /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g, severity: "critical" },
  { name: "Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, severity: "high" },
  { name: "Stripe live secret key", re: /\bsk_live_[A-Za-z0-9]{24,}\b/g, severity: "critical" },
  {
    name: "Hardcoded API key/secret (generic)",
    re: /\b(api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token)\s*[:=]\s*['"]([A-Za-z0-9_\-]{20,})['"]/gi,
    severity: "medium",
  },
];

const PLACEHOLDER_DENYLIST = new Set([
  "your-api-key-here",
  "your_api_key_here",
  "changeme",
  "replace-me",
  "xxxxxxxxxxxxxxxxxxxx",
  "example-key-do-not-use",
]);

function evidenceAt(lines, ln, maxChars = 160) {
  const raw = lines[ln - 1]?.trim() || "";
  return raw.length > maxChars ? raw.slice(0, maxChars) + "..." : raw;
}

function redact(matchedText) {
  if (matchedText.length <= 8) return "*".repeat(matchedText.length);
  return matchedText.slice(0, 4) + "*".repeat(matchedText.length - 8) + matchedText.slice(-4);
}

export function extractSecretFindings(filePath, content, rootDir, nextId) {
  const relPath = path.relative(rootDir, filePath);
  const findings = [];
  const lines = content.split("\n");

  const offsets = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === "\n") offsets.push(i + 1);
  }
  function lineOf(index) {
    let lo = 0, hi = offsets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (offsets[mid] <= index) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  }

  for (const pattern of SECRET_PATTERNS) {
    pattern.re.lastIndex = 0;
    let m;
    while ((m = pattern.re.exec(content))) {
      const matchedValue = m[2] || m[0];
      if (PLACEHOLDER_DENYLIST.has(matchedValue.toLowerCase())) continue;

      const ln = lineOf(m.index);
      findings.push({
        id: nextId("secret"),
        type: "security_finding",
        category: "secret_exposure",
        rule: pattern.name,
        severity: pattern.severity,
        file: relPath,
        line: ln,
        evidence: evidenceAt(lines, ln),
        redactedMatch: redact(matchedValue),
        confidence: "medium",
      });
    }
  }

  return findings;
}
