import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readGraph, buildGraph, writeGraph } from "../graph/build.js";
import { buildTools } from "./tools.js";
import { getVersion } from "../version.js";

/**
 * Starts an MCP server (stdio transport) exposing the current project's
 * understanding as tools any MCP-compatible AI client can call.
 *
 * This module assumes its dependencies (@modelcontextprotocol/sdk, zod) are
 * installed — the caller (cli/index.js's cmdServe) is responsible for
 * catching a missing-dependency error and telling the user to `npm install`,
 * since that's the one place that can see failures from either package.
 */
export async function startServer(rootDir) {
  let cachedGraph = readGraph(rootDir);
  const getGraph = () => {
    if (!cachedGraph) {
      cachedGraph = buildGraph(rootDir);
      writeGraph(rootDir, cachedGraph);
    }
    return cachedGraph;
  };

  const server = new McpServer({ name: "rune", version: getVersion() });

  // Wraps a tool handler so an unexpected error becomes a structured MCP
  // tool error (isError: true) that the calling AI can see and react to,
  // rather than an unhandled rejection with unpredictable behavior.
  const asToolResult = (handler) => async (args) => {
    try {
      const result = await handler(args || {});
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  };

  for (const tool of buildTools(getGraph)) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.inputSchema },
      asToolResult(tool.handler)
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
    asToolResult(async () => {
      cachedGraph = buildGraph(rootDir);
      writeGraph(rootDir, cachedGraph);
      return { status: "rescanned", fileCount: cachedGraph.meta.fileCount };
    })
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[rune] MCP server running for ${rootDir}`);
}
