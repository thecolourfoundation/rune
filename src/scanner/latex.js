import path from "node:path";

const EVIDENCE_MAX_CHARS = 160;

const MATH_ENVIRONMENTS = new Set([
  "theorem", "lemma", "definition", "proof", "proposition", "corollary",
  "remark", "example", "conjecture", "axiom", "claim", "notation", "algorithm",
  "equation", "align", "gather",
]);

export function extractLatexFacts(filePath, content, rootDir, nextId) {
  const relPath = path.relative(rootDir, filePath);
  const facts = [];
  const lines = content.split("\n");
  const isBib = filePath.toLowerCase().endsWith(".bib");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ln = i + 1;
    const evidence = line.trim().slice(0, EVIDENCE_MAX_CHARS);
    if (!evidence || evidence.startsWith("%")) continue;

    if (isBib) {
      const m = line.match(/^@(\w+)\s*\{\s*([^,]+)/);
      if (m) facts.push({ id: nextId("fact"), type: "bib_entry", file: relPath, line: ln, name: m[2].trim(), entryType: m[1].toLowerCase(), evidence, confidence: "high" });
      continue;
    }

    // \begin{environment}
    const mBegin = line.match(/\\begin\{(\w+)\}/);
    if (mBegin && MATH_ENVIRONMENTS.has(mBegin[1].toLowerCase())) {
      facts.push({ id: nextId("fact"), type: "latex_environment", file: relPath, line: ln, name: mBegin[1].toLowerCase(), evidence, confidence: "high" });
    }

    // \label{key}
    const mLabel = line.match(/\\label\{([^}]+)\}/);
    if (mLabel) facts.push({ id: nextId("fact"), type: "latex_label", file: relPath, line: ln, name: mLabel[1], evidence, confidence: "high" });

    // \cite{key1, key2}
    for (const m of line.matchAll(/\\cite(?:\w*)?(?:\[.*?\])?\{([^}]+)\}/g)) {
      for (const key of m[1].split(",")) {
        const k = key.trim();
        if (k) facts.push({ id: nextId("fact"), type: "latex_citation", file: relPath, line: ln, name: k, target: k, evidence, confidence: "high" });
      }
    }

    // \section / \subsection / \subsubsection
    const mSection = line.match(/\\(subsubsection|subsection|section)\*?\{([^}]+)\}/);
    if (mSection) facts.push({ id: nextId("fact"), type: "latex_section", file: relPath, line: ln, name: mSection[2].trim(), kind: mSection[1], evidence, confidence: "high" });

    // \input{} \include{}
    const mInput = line.match(/\\(?:input|include)\{([^}]+)\}/);
    if (mInput) facts.push({ id: nextId("fact"), type: "latex_include", file: relPath, line: ln, name: mInput[1], target: mInput[1], evidence, confidence: "high" });

    // \usepackage{pkg}
    const mPkg = line.match(/\\usepackage(?:\[.*?\])?\{([^}]+)\}/);
    if (mPkg) {
      for (const pkg of mPkg[1].split(",")) {
        const p = pkg.trim();
        if (p) facts.push({ id: nextId("fact"), type: "latex_package", file: relPath, line: ln, name: p, target: p, evidence, confidence: "high" });
      }
    }
  }

  return facts;
}
