import path from "node:path";

const EVIDENCE_MAX_CHARS = 160;

export function extractLeanFacts(filePath, content, rootDir, nextId) {
  const relPath = path.relative(rootDir, filePath);
  const facts = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ln = i + 1;
    const evidence = line.trim().slice(0, EVIDENCE_MAX_CHARS);
    if (!evidence || evidence.startsWith("--")) continue;

    // import X.Y.Z
    const mImport = line.match(/^import\s+([\w.]+)/);
    if (mImport) {
      facts.push({ id: nextId("fact"), type: "lean_import", file: relPath, line: ln, name: mImport[1], target: mImport[1], evidence, confidence: "high" });
      continue;
    }

    // theorem / lemma / def / abbrev / class / structure / instance
    const mDecl = line.match(/^(?:private\s+|protected\s+)?(?:noncomputable\s+)?(theorem|lemma|def|abbrev|class|structure|instance)\s+(\w+)/);
    if (mDecl) {
      const kindMap = { theorem: "theorem", lemma: "lemma", def: "definition", abbrev: "definition", class: "class", structure: "structure", instance: "instance" };
      facts.push({ id: nextId("fact"), type: "lean_declaration", file: relPath, line: ln, name: mDecl[2], kind: kindMap[mDecl[1]] ?? mDecl[1], evidence, confidence: "high" });
      continue;
    }

    // namespace X
    const mNs = line.match(/^namespace\s+(\w+)/);
    if (mNs) {
      facts.push({ id: nextId("fact"), type: "lean_namespace", file: relPath, line: ln, name: mNs[1], evidence, confidence: "high" });
      continue;
    }

    // #check #eval #print
    const mCmd = line.match(/^#(check|eval|print|reduce|norm_num)\b/);
    if (mCmd) {
      facts.push({ id: nextId("fact"), type: "lean_command", file: relPath, line: ln, name: mCmd[1], evidence, confidence: "medium" });
    }
  }

  return facts;
}
