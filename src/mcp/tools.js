import { z } from "zod";
import { listProjectMemory, listExperience } from "../memory/memory.js";
import { verifyFact, verifyFacts } from "../graph/verify.js";

// NOTE: @modelcontextprotocol/sdk's McpServer.registerTool() requires Zod
// schemas (a raw shape object of Zod types), not JSON Schema. An earlier
// version of this file used JSON-Schema-shaped objects here, which the SDK
// would have rejected at runtime.

const emptySchema = {};

export function buildTools(getGraph, rootDir) {
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
    {
      name: "rune_get_memory",
      title: "Get project memory",
      description:
        "Get durable project-specific knowledge Rune has recorded: conventions, required commands, known pitfalls. Each entry has a status (proposed/approved/rejected) and confidence score -- only 'approved' entries should be treated as trusted; 'proposed' entries are unverified and should be treated as a hint, not a fact.",
      inputSchema: {
        status: z
          .enum(["proposed", "approved", "rejected"])
          .optional()
          .describe("Filter by status. Omit to get all entries regardless of status."),
      },
      handler: async ({ status }) => {
        const entries = listProjectMemory(rootDir, { statusFilter: status });
        return {
          entries,
          note: "Only entries with status 'approved' have been confirmed by a human. Treat 'proposed' entries as unverified hints.",
        };
      },
    },
    {
      name: "rune_get_experience",
      title: "Get task experience log",
      description:
        "Get the history of past task attempts recorded for this project: what was tried, whether it succeeded or failed, and why. This is raw history, not verified rules -- use rune_get_memory for trusted, approved conventions.",
      inputSchema: {
        outcome: z
          .enum(["success", "failure"])
          .optional()
          .describe("Filter by outcome. Omit to get all entries."),
      },
      handler: async ({ outcome }) => {
        const entries = listExperience(rootDir, { outcomeFilter: outcome });
        return { entries };
      },
    },
    {
      name: "rune_get_security_findings",
      title: "Get security findings",
      description:
        "Get all security findings Rune has detected in this project: exposed secrets, dangerous shell execution, risky CI/CD workflow permissions, and typosquat-shaped dependencies. Use this before merging a PR or reviewing a codebase for security risk -- this is the single call that answers 'are there security concerns in this repo.' Every finding cites file, line, matched evidence, severity, and confidence -- nothing is asserted without a source. Filter by severity to focus on what matters first.",
      inputSchema: {
        severity: z
          .enum(["critical", "high", "medium", "low"])
          .optional()
          .describe("Filter to only this severity level. Omit to get all findings across all severities."),
        category: z
          .enum(["secret_exposure", "dangerous_shell_exec", "ci_permission_risk", "dependency_risk"])
          .optional()
          .describe("Filter to only this finding category. Omit to get all categories."),
      },
      handler: async ({ severity, category }) => {
        const graph = getGraph();
        let findings = graph.securityFindings || [];
        if (severity) findings = findings.filter((f) => f.severity === severity);
        if (category) findings = findings.filter((f) => f.category === category);

        const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
        for (const f of graph.securityFindings || []) {
          if (bySeverity[f.severity] !== undefined) bySeverity[f.severity] += 1;
        }

        return {
          findings,
          totalMatchingFilter: findings.length,
          totalAllFindings: (graph.securityFindings || []).length,
          summaryAllFindings: bySeverity,
          note: "Each finding's 'confidence' field indicates how sure Rune is this is a real issue (not a false positive from test/fixture/pattern-definition context) -- low-confidence findings are still real matches, just less certain to be exploitable production code.",
        };
      },
    },
    {
      name: "rune_verify_fact",
      title: "Verify a fact against live code",
      description:
        "Re-check a single fact (by id, as returned by other rune_ tools) against the current state of its source file, instead of trusting what was recorded at the last `rune scan`. Returns 'confirmed' if the code still matches, 'stale' with both the old and new evidence lines if it changed, or 'file_missing'/'line_gone' if the location no longer exists. Cheap: reads only that one file/line, not a full re-scan. Use this before relying on a specific fact from a graph that might be out of date.",
      inputSchema: {
        id: z.string().min(1, "id must not be empty").describe("The fact id to verify (not a derived-conclusion id -- see rune_check_drift for verifying everything at once)"),
      },
      handler: async ({ id }) => {
        const graph = getGraph();
        const fact = graph.facts.find((f) => f.id === id);
        if (!fact) {
          return { error: `No fact found with id "${id}". Note: only raw facts can be verified this way, not derived conclusions.` };
        }
        return { fact, result: verifyFact(fact, rootDir) };
      },
    },
    {
      name: "rune_check_drift",
      title: "Check graph-wide drift",
      description:
        "Re-check every fact in the graph against the live state of the code and summarize how much has drifted since the last `rune scan`. Cheap: re-reads only the specific line each fact points to, not a full re-parse of the project. Use this to decide whether the current graph is still trustworthy before relying on it heavily, or to know it is time to re-run `rune scan`. Returns counts by status plus the full list of drifted facts (stale/file_missing/line_gone) with before/after evidence where applicable.",
      inputSchema: emptySchema,
      handler: async () => {
        const graph = getGraph();
        return verifyFacts(graph.facts, rootDir);
      },
    },
  ];
}
