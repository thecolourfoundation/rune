import path from "node:path";

const EVIDENCE_MAX_CHARS = 160;

function detectCellRole(source) {
  const src = source.toLowerCase();
  if (/\bplt\.|matplotlib|seaborn|plotly|bokeh/.test(src)) return "visualization";
  if (/\bfit\(|\.train\(|model\.compile|torch\.optim|keras/.test(src)) return "model_training";
  if (/\bpd\.read_|pd\.DataFrame|load_dataset|np\.load/.test(src)) return "data_loading";
  if (/^\s*(?:import|from)\s/m.test(src)) return "imports";
  if (/\bprint\(|display\(|\.head\(|\.describe\(/.test(src)) return "exploration";
  if (/\bdef\s+\w+\s*\(/.test(src)) return "function_definition";
  return "computation";
}

function extractCellImports(source) {
  const imports = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m1 = line.match(/^\s*import\s+([\w.,\s]+)/);
    const m2 = line.match(/^\s*from\s+([\w.]+)\s+import\s+/);
    if (m1) {
      for (const name of m1[1].split(",")) {
        const t = name.trim().split(" as ")[0].trim();
        if (t) imports.push({ name: t, line: i + 1, evidence: line.trim().slice(0, EVIDENCE_MAX_CHARS) });
      }
    } else if (m2) {
      imports.push({ name: m2[1], line: i + 1, evidence: line.trim().slice(0, EVIDENCE_MAX_CHARS) });
    }
  }
  return imports;
}

export function extractNotebookFacts(filePath, content, rootDir, nextId) {
  const relPath = path.relative(rootDir, filePath);
  const facts = [];

  let notebook;
  try { notebook = JSON.parse(content); } catch { return facts; }

  const cells = notebook.cells || notebook.worksheets?.[0]?.cells || [];
  if (!Array.isArray(cells)) return facts;

  const codeCells = cells.filter((c) => c.cell_type === "code");
  const markdownCells = cells.filter((c) => c.cell_type === "markdown");

  facts.push({
    id: nextId("fact"),
    type: "notebook_structure",
    file: relPath,
    line: 1,
    name: path.basename(filePath, ".ipynb"),
    codeCellCount: codeCells.length,
    markdownCellCount: markdownCells.length,
    kernelName: notebook.metadata?.kernelspec?.name ?? null,
    language: notebook.metadata?.kernelspec?.language ?? notebook.metadata?.language_info?.name ?? null,
    evidence: `${codeCells.length} code cell(s), ${markdownCells.length} markdown cell(s)`,
    confidence: "high",
  });

  let lineOffset = 1;
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const source = Array.isArray(cell.source) ? cell.source.join("") : (cell.source || "");
    const cellLineCount = source.split("\n").length;

    if (cell.cell_type === "code" && source.trim()) {
      const role = detectCellRole(source);
      const firstLine = source.split("\n")[0].trim();
      facts.push({
        id: nextId("fact"),
        type: "notebook_cell",
        file: relPath,
        line: lineOffset,
        name: `cell_${i + 1}`,
        cellIndex: i,
        role,
        evidence: firstLine.slice(0, EVIDENCE_MAX_CHARS),
        confidence: "high",
      });
      for (const imp of extractCellImports(source)) {
        facts.push({
          id: nextId("fact"),
          type: "notebook_import",
          file: relPath,
          line: lineOffset + imp.line - 1,
          name: imp.name,
          target: imp.name,
          cellIndex: i,
          evidence: imp.evidence,
          confidence: "high",
        });
      }
    }
    lineOffset += cellLineCount + 1;
  }

  return facts;
}
