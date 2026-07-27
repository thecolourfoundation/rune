import { readGraph, buildGraph, writeGraph } from "../graph/build.js";
import { buildTools } from "./tools.js";

/**
 * Starts an MCP server (stdio transport) exposing the current project's
 * understanding graph as tools any MCP-compatible AI client can call.
 *
 * Requires @modelcontextprotocol/sdk — installed as a dependency of this
 * package. If it isn't resolvable, we fail with a clear message rather than
 * a cryptic stack trace.
 */
export async function startServer(rootDir) {
  let McpServer, StdioServerTransport;
  try {
    ({ McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js"));
    ({ StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js"));
  } catch (err) {
    console.error(
      "[rune] @modelcontextprotocol/sdk is not installed. Run `npm install` in this project, then try `rune serve` again."
    );
    throw err;
  }

  let cachedGraph = readGraph(rootDir);
  const getGraph = () => {
    if (!cachedGraph) {
      cachedGraph = buildGraph(rootDir);
      writeGraph(rootDir, cachedGraph);
    }
    return cachedGraph;
  };

  const server = new McpServer({ name: "rune", version: "0.1.0" });

  for (const tool of buildTools(getGraph)) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.inputSchema },
      async (args) => {
        const result = await tool.handler(args || {});
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }
    );
  }

  // Simple refresh tool so a client can ask Rune to re-scan without shelling out.
  server.registerTool(
    "rune_rescan",
    {
      title: "Re-scan project",
      description: "Re-scan the project from disk and refresh Rune's understanding graph. Call this after significant code changes.",
      inputSchema: {},
    },
    async () => {
      cachedGraph = buildGraph(rootDir);
      writeGraph(rootDir, cachedGraph);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ status: "rescanned", fileCount: cachedGraph.meta.fileCount }, null, 2),
          },
        ],
      };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[rune] MCP server running for ${rootDir}`);
}
