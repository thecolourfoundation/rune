/**
 * Derived understanding is always computed FROM facts, and every derived node
 * records which fact ids it is based on (`basedOn`), so a conclusion can be
 * traced back to the evidence that produced it.
 */
export function deriveUnderstanding(facts, projectInfo) {
  const derived = [];
  let counter = 0;
  const nextId = () => `derived_${(++counter).toString(36)}`;

  const components = facts.filter((f) => f.type === "react_component");
  const expressRoutes = facts.filter((f) => f.type === "express_route");
  const nextPageRoutes = facts.filter((f) => f.type === "next_page_route");
  const nextApiRoutes = facts.filter((f) => f.type === "next_api_route");
  const imports = facts.filter((f) => f.type === "import");

  // --- Architecture summary ---
  const frameworks = [];
  if (projectInfo.hasNext) frameworks.push("Next.js");
  if (projectInfo.hasExpress) frameworks.push("Express");
  if (projectInfo.hasReact && !projectInfo.hasNext) frameworks.push("React");

  derived.push({
    id: nextId(),
    type: "architecture_summary",
    description:
      frameworks.length > 0
        ? `Detected stack: ${frameworks.join(", ")}. ${components.length} React component(s), ` +
          `${expressRoutes.length} Express route(s), ${nextPageRoutes.length} Next.js page route(s), ` +
          `${nextApiRoutes.length} Next.js API route(s) across the scanned source tree.`
        : `No first-class framework (React/Next.js/Express) confirmed from package.json. ` +
          `${components.length} component-like function(s) detected heuristically.`,
    basedOn: [
      ...components.map((c) => c.id),
      ...expressRoutes.map((c) => c.id),
      ...nextPageRoutes.map((c) => c.id),
      ...nextApiRoutes.map((c) => c.id),
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
      id: nextId(),
      type: "file_dependency",
      file,
      dependsOn: fileImports.map((i) => i.target),
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
      id: nextId(),
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
      id: nextId(),
      type: "component_index",
      description: `${components.length} React component(s) identified by declaration pattern + JSX-return heuristic.`,
      components: components.map((c) => ({ name: c.name, file: c.file, line: c.line, kind: c.kind, factId: c.id })),
      basedOn: components.map((c) => c.id),
      confidence: "medium",
    });
  }

  return derived;
}
