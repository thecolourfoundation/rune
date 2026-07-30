import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildGraph, writeGraph, createLiveGraphReader } from "../graph/build.js";
import { buildTools } from "./tools.js";
import { getVersion } from "../version.js";

/**
 * Starts an MCP server (stdio transport) exposing the current project's
 * understanding as tools any MCP-compatible AI client can call.
 *
 * The graph is read via createLiveGraphReader, which automatically reloads
 * from disk whenever the graph file's mtime changes -- so if a `rune watch`
 * process is running alongside this server (or someone just runs
 * `rune scan` manually), connected AI clients see the update on their next
 * call without needing to restart this server or call rune_rescan.
 *
 * This module assumes its dependencies (@modelcontextprotocol/sdk, zod) are
 * installed — the caller (cli/index.js's cmdServe) is responsible for
 * catching a missing-dependency error and telling the user to `npm install`,
 * since that's the one place that can see failures from either package.
 */
export async function startServer(rootDir) {
  const getGraph = createLiveGraphReader(rootDir);

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

  // Forces an immediate rebuild rather than waiting for the live reader to
  // notice a change on its own -- useful right after an edit when no
  // `rune watch` process is running to keep the graph current in the
  // background.
  server.registerTool(
    "rune_rescan",
    {
      title: "Re-scan project",
      description: "Re-scan the project from disk and refresh Rune's understanding graph. Call this after significant code changes if `rune watch` isn't already running in the background.",
      inputSchema: {},
    },
    asToolResult(async () => {
      const graph = buildGraph(rootDir);
      writeGraph(rootDir, graph);
      return { status: "rescanned", fileCount: graph.meta.fileCount };
    })
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[rune] MCP server running for ${rootDir}`);
}
