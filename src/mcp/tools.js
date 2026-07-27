import { z } from "zod";

// NOTE: @modelcontextprotocol/sdk's McpServer.registerTool() requires Zod
// schemas (a raw shape object of Zod types), not JSON Schema. An earlier
// version of this file used JSON-Schema-shaped objects here, which the SDK
// would have rejected at runtime.

const emptySchema = {};

export function buildTools(getGraph) {
  return [
    {
      name: "rune_get_overview",
      title: "Project overview",
      description:
        "Get a high-level architecture summary of the software: detected stack, component count, route count. Start here.",
      inputSchema: emptySchema,
      handler: async () => {
        const graph = getGraph();
        const summary = graph.derived.find((d) => d.type === "architecture_summary");
        return {
          meta: graph.meta,
          summary: summary || null,
        };
      },
    },
    {
      name: "rune_list_components",
      title: "List components",
      description: "List all React components Rune has identified, with file location and detection kind (function/class).",
      inputSchema: emptySchema,
      handler: async () => {
        const graph = getGraph();
        const index = graph.derived.find((d) => d.type === "component_index");
        return { components: index?.components || [] };
      },
    },
    {
      name: "rune_list_routes",
      title: "List routes",
      description: "List all API/page routes Rune has identified across Express and Next.js (pages + app router).",
      inputSchema: emptySchema,
      handler: async () => {
        const graph = getGraph();
        const surface = graph.derived.find((d) => d.type === "api_surface");
        const pageRoutes = graph.facts.filter((f) => f.type === "next_page_route");
        return {
          apiRoutes: surface?.routes || [],
          pageRoutes: pageRoutes.map((r) => ({ path: r.routePath, file: r.file })),
        };
      },
    },
    {
      name: "rune_search",
      title: "Search understanding",
      description:
        "Search facts and derived understanding by name, file path, or route path substring. Use this to find where something lives before reading files directly.",
      inputSchema: {
        query: z.string().min(1, "query must not be empty").max(500).describe("Substring to search for"),
      },
      handler: async ({ query }) => {
        const graph = getGraph();
        const q = query.toLowerCase();
        const matchFacts = graph.facts.filter((f) =>
          [f.name, f.file, f.routePath, f.target].some((v) => typeof v === "string" && v.toLowerCase().includes(q))
        );
        return { matches: matchFacts.slice(0, 50), totalMatches: matchFacts.length };
      },
    },
    {
      name: "rune_explain",
      title: "Explain a conclusion",
      description:
        "Given a fact or derived-conclusion id (as returned by other rune_ tools), return the full evidence trail: the raw fact(s) it's based on, file, line, and matched source text.",
      inputSchema: {
        id: z.string().min(1, "id must not be empty").describe("The fact or derived id to explain"),
      },
      handler: async ({ id }) => {
        const graph = getGraph();
        const fact = graph.facts.find((f) => f.id === id);
        if (fact) return { kind: "fact", ...fact };

        const derivedNode = graph.derived.find((d) => d.id === id);
        if (derivedNode) {
          const evidenceChain = (derivedNode.basedOn || [])
            .map((factId) => graph.facts.find((f) => f.id === factId))
            .filter(Boolean);
          return { kind: "derived", ...derivedNode, evidenceChain };
        }
        return { error: `No fact or derived node found with id "${id}"` };
      },
    },
    {
      name: "rune_get_file_dependencies",
      title: "File dependencies",
      description: "Get the internal (relative-import) dependency list for a given file path, as recorded in the understanding graph.",
      inputSchema: {
        file: z.string().min(1, "file must not be empty").describe("File path relative to project root, as returned by other rune_ tools"),
      },
      handler: async ({ file }) => {
        const graph = getGraph();
        const node = graph.derived.find((d) => d.type === "file_dependency" && d.file === file);
        return node || { file, dependsOn: [], note: "No recorded internal dependencies for this file." };
      },
    },
  ];
}
