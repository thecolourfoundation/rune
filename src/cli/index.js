import path from "node:path";
import fs from "node:fs";
import { buildGraph, writeGraph, readGraph, RUNE_DIR, GRAPH_FILENAME } from "../graph/build.js";

const HELP = `
Rune — the Software Intelligence Runtime

Usage:
  rune init             Set up Rune in the current project
  rune scan [dir]        Build (or rebuild) the understanding graph
  rune serve [dir]       Start the MCP server so AI clients can query the graph
  rune explain <id>      Show the evidence trail behind a fact or derived conclusion
  rune --help            Show this help
`;

export async function runCli(args) {
  const [command, ...rest] = args;

  switch (command) {
    case undefined:
    case "-h":
    case "--help":
    case "help":
      console.log(HELP);
      return;
    case "init":
      return cmdInit(rest);
    case "scan":
      return cmdScan(rest);
    case "serve":
      return cmdServe(rest);
    case "explain":
      return cmdExplain(rest);
    default:
      console.log(`Unknown command: ${command}\n${HELP}`);
      process.exitCode = 1;
  }
}

function resolveDir(rest) {
  return path.resolve(rest[0] || process.cwd());
}

async function cmdInit(rest) {
  const dir = resolveDir(rest);
  const runeDir = path.join(dir, RUNE_DIR);
  fs.mkdirSync(runeDir, { recursive: true });

  const configPath = path.join(runeDir, "config.json");
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(
      configPath,
      JSON.stringify({ ignore: [], version: 1 }, null, 2)
    );
  }

  const gitignorePath = path.join(dir, ".gitignore");
  const runeIgnoreLine = `${RUNE_DIR}/${GRAPH_FILENAME}`;
  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, "utf8");
    if (!content.includes(runeIgnoreLine)) {
      fs.appendFileSync(gitignorePath, `\n# Rune understanding graph (regenerate with \`rune scan\`)\n${runeIgnoreLine}\n`);
    }
  }

  console.log(`[rune] initialized at ${runeDir}`);
  console.log(`[rune] run \`rune scan\` to build the understanding graph.`);
}

async function cmdScan(rest) {
  const dir = resolveDir(rest);
  const start = Date.now();
  const graph = buildGraph(dir);
  const filePath = writeGraph(dir, graph);
  const ms = Date.now() - start;

  console.log(`[rune] scanned ${graph.meta.fileCount} file(s) in ${ms}ms`);
  console.log(`[rune] facts: ${graph.facts.length}, derived conclusions: ${graph.derived.length}`);
  console.log(`[rune] graph written to ${filePath}`);
}

async function cmdServe(rest) {
  const dir = resolveDir(rest);
  const existing = readGraph(dir);
  if (!existing) {
    console.log(`[rune] no graph found — scanning ${dir} first...`);
    writeGraph(dir, buildGraph(dir));
  }
  const { startServer } = await import("../mcp/server.js");
  await startServer(dir);
}

async function cmdExplain(rest) {
  const [id] = rest;
  if (!id) {
    console.log("Usage: rune explain <id>");
    process.exitCode = 1;
    return;
  }
  const dir = resolveDir(rest.slice(1));
  const graph = readGraph(dir);
  if (!graph) {
    console.log(`[rune] no graph found. Run \`rune scan\` first.`);
    process.exitCode = 1;
    return;
  }

  const fact = graph.facts.find((f) => f.id === id);
  const derivedNode = graph.derived.find((d) => d.id === id);

  if (fact) {
    console.log(JSON.stringify({ kind: "fact", ...fact }, null, 2));
    return;
  }
  if (derivedNode) {
    const basis = (derivedNode.basedOn || [])
      .map((factId) => graph.facts.find((f) => f.id === factId))
      .filter(Boolean);
    console.log(
      JSON.stringify(
        {
          kind: "derived",
          ...derivedNode,
          evidenceChain: basis,
        },
        null,
        2
      )
    );
    return;
  }

  console.log(`[rune] no fact or derived node found with id "${id}"`);
  process.exitCode = 1;
}
