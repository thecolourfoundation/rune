import path from "node:path";

const HEADING_RE = /^(#{1,6})\s+(.+)$/;
const CODE_FENCE_RE = /^```(\w*)\s*$/;
const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;
const INSTRUCTION_KEYWORDS_RE = /\b(must|should|never|always|do not|don't|required|only ever)\b/i;
const EVIDENCE_MAX_CHARS = 160;

function evidenceFor(lines, ln) {
  return lines[ln - 1]?.trim().slice(0, EVIDENCE_MAX_CHARS) || "";
}

export function extractMarkdownFacts(filePath, content, rootDir, nextId) {
  const relPath = path.relative(rootDir, filePath);
  const facts = [];
  const lines = content.split("\n");
  let inCodeFence = false;
  let codeFenceStartLine = null;
  let codeFenceLang = null;

  lines.forEach((rawLine, idx) => {
    const ln = idx + 1;
    const line = rawLine;
    const fenceMatch = line.match(CODE_FENCE_RE);
    if (fenceMatch) {
      if (!inCodeFence) {
        inCodeFence = true;
        codeFenceStartLine = ln;
        codeFenceLang = fenceMatch[1] || null;
      } else {
        facts.push({ id: nextId("doc_codeblock"), type: "doc_code_block", file: relPath, line: codeFenceStartLine, language: codeFenceLang, confidence: "high", evidence: evidenceFor(lines, codeFenceStartLine) });
        inCodeFence = false;
        codeFenceStartLine = null;
        codeFenceLang = null;
      }
      return;
    }
    if (inCodeFence) return;

    const headingMatch = line.match(HEADING_RE);
    if (headingMatch) {
      facts.push({ id: nextId("doc_heading"), type: "doc_heading", file: relPath, line: ln, name: headingMatch[2].trim(), level: headingMatch[1].length, confidence: "high", evidence: evidenceFor(lines, ln) });
    }

    let linkMatch;
    LINK_RE.lastIndex = 0;
    while ((linkMatch = LINK_RE.exec(line)) !== null) {
      facts.push({ id: nextId("doc_link"), type: "doc_link", file: relPath, line: ln, name: linkMatch[1], target: linkMatch[2], confidence: "high", evidence: evidenceFor(lines, ln) });
    }

    if (INSTRUCTION_KEYWORDS_RE.test(line) && line.trim().length > 0) {
      facts.push({ id: nextId("doc_instruction"), type: "doc_instruction", file: relPath, line: ln, name: line.trim().slice(0, EVIDENCE_MAX_CHARS), confidence: "medium", evidence: evidenceFor(lines, ln) });
    }
  });
  return facts;
}
