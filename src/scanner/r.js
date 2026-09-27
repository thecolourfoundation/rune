import path from "node:path";

const EVIDENCE_MAX_CHARS = 160;

export function extractRFacts(filePath, content, rootDir, nextId) {
  const relPath = path.relative(rootDir, filePath);
  const facts = [];
  const lines = content.split("\n");
  const isRmd = /\.(rmd)$/i.test(filePath);
  let inChunk = false;
  let chunkIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ln = i + 1;
    const evidence = line.trim().slice(0, EVIDENCE_MAX_CHARS);
    if (!evidence) continue;

    // R Markdown chunk boundaries
    if (isRmd) {
      if (/^```\{r/i.test(line)) {
        inChunk = true;
        chunkIndex += 1;
        const mName = line.match(/```\{r\s*,?\s*([^,}\s]+)/i);
        facts.push({ id: nextId("fact"), type: "rmd_chunk", file: relPath, line: ln, name: mName ? mName[1] : `chunk_${chunkIndex}`, chunkIndex, evidence: evidence.slice(0, EVIDENCE_MAX_CHARS), confidence: "high" });
        continue;
      }
      if (/^```\s*$/.test(line) && inChunk) { inChunk = false; continue; }
      if (!inChunk) continue;
    }

    if (evidence.startsWith("#")) continue;

    // library(x) / require(x)
    const mLib = line.match(/(?:^|\s)(?:library|require)\s*\(\s*["']?([\w.]+)["']?\s*\)/);
    if (mLib) {
      facts.push({ id: nextId("fact"), type: "r_library", file: relPath, line: ln, name: mLib[1], target: mLib[1], evidence, confidence: "high" });
      continue;
    }

    // name <- function(
    const mFn = line.match(/^(\w+)\s*<-\s*function\s*\(/);
    if (mFn) {
      facts.push({ id: nextId("fact"), type: "r_function", file: relPath, line: ln, name: mFn[1], evidence, confidence: "high" });
      continue;
    }

    // top-level assignment name <- value
    const mAssign = line.match(/^(\w+)\s*<-\s*(?!function\s*\()(.+)/);
    if (mAssign) {
      facts.push({ id: nextId("fact"), type: "r_assignment", file: relPath, line: ln, name: mAssign[1], evidence, confidence: "medium" });
    }
  }

  return facts;
}
