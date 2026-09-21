// Plain-text document extractor (.txt). Deterministic, no model. PROTOTYPE.
// Emits text_section, text_definition, text_reference, text_date, text_amount and
// text_paragraph facts. A file only counts as a structured document if it has at
// least two headings or defined terms; anything else yields nothing.
import path from "node:path";
import { confidenceForFile } from "./confidence.js";

const MAX_FACTS = 3000;
// Must match EVIDENCE_MAX_CHARS in graph/verify.js: `rune verify` re-reads the source
// line and compares it with the stored evidence, so evidence has to be exactly that
// line, trimmed and cut to this length. Paragraph text lives in `name` instead.
const EVIDENCE_MAX_CHARS = 160;

const HEADING_KEYWORD = /^\s*(ARTICLE|Article|SECTION|Section|CLAUSE|Clause|CHAPTER|Chapter|PART|Part|SCHEDULE|Schedule|EXHIBIT|Exhibit|APPENDIX|Appendix)\.?\s+([IVXLCDM]+|\d+(?:\.\d+)*|[A-Z])\b\.?[\s:\-\u2013\u2014.)]*(.*)$/;
const HEADING_NUMBERED = /^\s*(\d+(?:\.\d+)*)[.)]\s+([A-Z][^\n]{2,90})$/;
const DEF_PAREN = /\((?:the |each |a |an )?[\u201C"]([A-Z][A-Za-z0-9 &\-]{1,40})[\u201D"]\)/g;
const DEF_MEANS = /[\u201C"]([A-Z][A-Za-z0-9 &\-]{1,40})[\u201D"]\s+(?:means|shall mean|has the meaning|refers to)/g;
const REF = /\b(Sections?|Articles?|Clauses?|Paragraphs?|Schedules?|Exhibits?|Appendix|Annex)\.?\s+((?:\d+(?:\.\d+)*|[IVXLCDM]+\b|[A-Z]\b)(?:\([a-zA-Z0-9]+\))*)/g;
const DATE = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b|\b\d{4}-\d{2}-\d{2}\b/g;
const AMOUNT = /(?:US\$|\$)\s?\d[\d,]*(?:\.\d+)?(?:\s(?:million|billion|thousand))?|\b(?:USD|EUR|GBP)\s?\d[\d,]*(?:\.\d+)?/g;

function parseHeading(line) {
  if (line.length > 140) return null;
  let m = HEADING_KEYWORD.exec(line);
  if (m) {
    const rest = (m[3] || "").trim();
    // "Section 3 of this Agreement shall..." is a sentence that mentions a section, not a heading.
    if (rest.length > 100 || /^[a-z]/.test(rest)) return null;
    const kw = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
    const label = kw + " " + m[2];
    return { label, name: rest ? label + " " + rest : label };
  }
  m = HEADING_NUMBERED.exec(line);
  if (m) {
    const title = m[2].trim();
    if (/[.;,:]$/.test(title) || title.split(/\s+/).length > 10) return null;
    return { label: "Section " + m[1], name: m[1] + " " + title };
  }
  return null;
}

export function extractTextFacts(filePath, content, rootDir, nextId) {
  const relPath = path.relative(rootDir, filePath);
  const confidence = confidenceForFile(relPath);
  const lines = content.split("\n");
  const items = [];
  const ev = (raw) => raw.trim().slice(0, EVIDENCE_MAX_CHARS);
  let headings = 0;
  let definitions = 0;
  let section = null;
  let sectionName = null;
  let para = null;

  const flush = () => {
    if (!para) return;
    const text = para.parts.join(" ").replace(/\s+/g, " ").trim();
    if (text.length >= 25) {
      const item = { type: "text_paragraph", line: para.start, name: text.slice(0, 300), section: para.section, evidence: ev(para.first) };
      if (para.sectionName) item.target = para.sectionName;
      items.push(item);
    }
    para = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    const ln = i + 1;
    if (!line) { flush(); continue; }

    const h = parseHeading(line);
    if (h) {
      flush();
      headings += 1;
      section = h.label;
      sectionName = h.name;
      items.push({ type: "text_section", line: ln, name: h.name, label: h.label, evidence: ev(raw) });
      continue;
    }

    const e = ev(raw);
    const seen = new Set();
    for (const re of [DEF_PAREN, DEF_MEANS]) {
      for (const m of line.matchAll(re)) {
        if (seen.has(m[1])) continue;
        seen.add(m[1]);
        definitions += 1;
        items.push({ type: "text_definition", line: ln, name: m[1], evidence: e });
      }
    }
    for (const m of line.matchAll(REF)) {
      items.push({ type: "text_reference", line: ln, target: m[1].replace(/s$/, "") + " " + m[2], evidence: e });
    }
    for (const m of line.matchAll(DATE)) items.push({ type: "text_date", line: ln, name: m[0], evidence: e });
    for (const m of line.matchAll(AMOUNT)) items.push({ type: "text_amount", line: ln, name: m[0].trim(), evidence: e });

    if (!para) para = { start: ln, first: raw, parts: [], section, sectionName };
    para.parts.push(line);
  }
  flush();

  if (headings + definitions < 2) return [];
  return items.slice(0, MAX_FACTS).map((it) => ({ id: nextId("txt"), file: relPath, confidence, ...it }));
}
