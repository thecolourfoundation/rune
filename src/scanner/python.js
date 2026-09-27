import path from "node:path";

const EVIDENCE_MAX_CHARS = 160;

export function extractPythonFacts(filePath, content, rootDir, nextId) {
  const relPath = path.relative(rootDir, filePath);
  const facts = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ln = i + 1;
    const evidence = line.trim().slice(0, EVIDENCE_MAX_CHARS);
    if (!evidence || evidence.startsWith("#")) continue;

    // import x [as y], x2 [as y2]
    const m1 = line.match(/^import\s+([\w.,\s]+)/);
    if (m1) {
      for (const part of m1[1].split(",")) {
        const name = part.trim().split(/\s+as\s+/)[0].trim();
        if (name) facts.push({ id: nextId("fact"), type: "python_import", file: relPath, line: ln, name, target: name, evidence, confidence: "high" });
      }
      continue;
    }

    // from x import y
    const m2 = line.match(/^from\s+([\w.]+)\s+import\s+/);
    if (m2) {
      facts.push({ id: nextId("fact"), type: "python_import", file: relPath, line: ln, name: m2[1], target: m2[1], evidence, confidence: "high" });
      continue;
    }

    // def name(
    const m3 = line.match(/^(\s*)def\s+(\w+)\s*\(/);
    if (m3) {
      facts.push({ id: nextId("fact"), type: "python_function", file: relPath, line: ln, name: m3[2], kind: m3[1].length > 0 ? "method" : "function", evidence, confidence: "high" });
      continue;
    }

    // class Name
    const m4 = line.match(/^class\s+(\w+)/);
    if (m4) {
      facts.push({ id: nextId("fact"), type: "python_class", file: relPath, line: ln, name: m4[1], evidence, confidence: "high" });
      continue;
    }

    // @decorator
    const m5 = line.match(/^@([\w.]+)/);
    if (m5) {
      facts.push({ id: nextId("fact"), type: "python_decorator", file: relPath, line: ln, name: m5[1], evidence, confidence: "medium" });
    }
  }

  return facts;
}
