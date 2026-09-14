import path from "node:path";

const DEP_FIELD_BY_TYPE = { file_dependency: "dependsOn", shell_dependency: "dependsOn", doc_reference: "references" };

function stripExt(p) { return p.replace(/\.[^/.]+$/, ""); }

function resolveTarget(fromFile, target) {
  if (!target.startsWith(".")) return target;
  const dir = path.dirname(fromFile);
  return path.normalize(path.join(dir, target)).split(path.sep).join("/");
}

export function computeImpact(graph, targetFile) {
  const normalizedTarget = stripExt(targetFile);
  const dependents = [];
  for (const node of graph.derived || []) {
    const field = DEP_FIELD_BY_TYPE[node.type];
    if (!field) continue;
    const targets = node[field] || [];
    for (const t of targets) {
      const resolved = resolveTarget(node.file, t);
      if (stripExt(resolved) === normalizedTarget || resolved === targetFile) {
        dependents.push({ file: node.file, via: node.type, rawTarget: t, basedOn: node.basedOn });
        break;
      }
    }
  }
  return { target: targetFile, dependents, confidence: dependents.length > 0 ? "medium" : "low", note: "Best-effort relative-path resolution across import/source/doc-link relationships; not a full module-resolution-algorithm." };
}
