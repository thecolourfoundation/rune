import { createIdGenerator } from "../scanner/id.js";

/**
 * Derived understanding is always computed FROM facts, and every derived node
 * records which fact ids it is based on (`basedOn`), so a conclusion can be
 * traced back to the evidence that produced it.
 */
export function deriveUnderstanding(facts, projectInfo) {
  const derived = [];
  const nextId = createIdGenerator();

  const components = facts.filter((f) => f.type === "react_component");
  const expressRoutes = facts.filter((f) => f.type === "express_route");
  const nextPageRoutes = facts.filter((f) => f.type === "next_page_route");
  const nextApiRoutes = facts.filter((f) => f.type === "next_api_route");
  const imports = facts.filter((f) => f.type === "import");
  const shellSources = facts.filter((f) => f.type === "shell_source");
  const docLinks = facts.filter((f) => f.type === "doc_link");

  // --- Architecture summary ---
  // A framework counts as "detected" if EITHER package.json declares it OR
  // actual evidence of its use was found in the scanned source. Manifest-only
  // detection silently misses real usage whenever a codebase imports/uses a
  // framework without (or ahead of) declaring it as a direct dependency --
  // common in monorepos, or when a manifest just lags behind the code.
  const hasNextEvidence = projectInfo.hasNext || nextPageRoutes.length > 0 || nextApiRoutes.length > 0;
  const hasExpressEvidence = projectInfo.hasExpress || expressRoutes.length > 0;
  const hasReactEvidence = projectInfo.hasReact || components.length > 0;

  const frameworks = [];
  if (hasNextEvidence) frameworks.push("Next.js");
  if (hasExpressEvidence) frameworks.push("Express");
  if (hasReactEvidence && !hasNextEvidence) frameworks.push("React");

  const projectName = projectInfo.pkg?.name;
  const namePrefix = projectName ? `"${projectName}" — ` : "";

  derived.push({
    id: nextId("derived"),
    type: "architecture_summary",
    description:
      frameworks.length > 0
        ? `${namePrefix}Detected stack: ${frameworks.join(", ")}. ${components.length} React component(s), ` +
          `${expressRoutes.length} Express route(s), ${nextPageRoutes.length} Next.js page route(s), ` +
          `${nextApiRoutes.length} Next.js API route(s) across the scanned source tree.`
        : `${namePrefix}No first-class framework (React/Next.js/Express) confirmed from package.json. ` +
          `${components.length} component-like function(s) detected heuristically.`,
    basedOn: [
      ...components.map((c) => c.id),
      ...expressRoutes.map((r) => r.id),
      ...nextPageRoutes.map((r) => r.id),
      ...nextApiRoutes.map((r) => r.id),
    ],
    confidence: frameworks.length > 0 ? "high" : "medium",
  });

  // --- File -> internal import graph (relationships) ---
  const importsByFile = new Map();
  for (const imp of imports) {
    if (!imp.target.startsWith(".")) continue; // external package, skip for relationship graph
    if (!importsByFile.has(imp.file)) importsByFile.set(imp.file, []);
    importsByFile.get(imp.file).push(imp);
  }
  for (const [file, fileImports] of importsByFile.entries()) {
    derived.push({
      id: nextId("derived"),
      type: "file_dependency",
      file,
      dependsOn: [...new Set(fileImports.map((i) => i.target))],
      basedOn: fileImports.map((i) => i.id),
      confidence: "high",
    });
  }

  // --- API surface (unified view across Express + Next) ---
  const apiSurface = [
    ...expressRoutes.map((r) => ({ method: r.method, path: r.routePath, file: r.file, factId: r.id })),
    ...nextApiRoutes.map((r) => ({ method: "ANY", path: r.routePath, file: r.file, factId: r.id })),
  ];
  if (apiSurface.length > 0) {
    derived.push({
      id: nextId("derived"),
      type: "api_surface",
      description: `${apiSurface.length} API endpoint(s) discovered across Express and Next.js route conventions.`,
      routes: apiSurface,
      basedOn: apiSurface.map((r) => r.factId),
      confidence: "high",
    });
  }

  // --- Component index ---
  if (components.length > 0) {
    derived.push({
      id: nextId("derived"),
      type: "component_index",
      description: `${components.length} React component(s) identified by declaration pattern + JSX-return heuristic.`,
      components: components.map((c) => ({ name: c.name, file: c.file, line: c.line, kind: c.kind, factId: c.id })),
      basedOn: components.map((c) => c.id),
      confidence: "medium",
    });
  }

  const shellSourcesByFile = new Map();
  for (const src of shellSources) {
    if (!shellSourcesByFile.has(src.file)) shellSourcesByFile.set(src.file, []);
    shellSourcesByFile.get(src.file).push(src);
  }
  for (const [file, srcs] of shellSourcesByFile.entries()) {
    derived.push({ id: nextId("derived"), type: "shell_dependency", file, dependsOn: [...new Set(srcs.map((s) => s.target))], basedOn: srcs.map((s) => s.id), confidence: "high" });
  }

  const localDocLinks = docLinks.filter((l) => !/^https?:\/\//.test(l.target) && !l.target.startsWith("#"));
  const docLinksByFile = new Map();
  for (const link of localDocLinks) {
    if (!docLinksByFile.has(link.file)) docLinksByFile.set(link.file, []);
    docLinksByFile.get(link.file).push(link);
  }
  for (const [file, links] of docLinksByFile.entries()) {
    derived.push({ id: nextId("derived"), type: "doc_reference", file, references: [...new Set(links.map((l) => l.target))], basedOn: links.map((l) => l.id), confidence: "high" });
  }

  return derived;
}
