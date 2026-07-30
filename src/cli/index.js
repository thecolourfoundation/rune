import path from "node:path";
import fs from "node:fs";
import { buildGraph, writeGraph, readGraph, RUNE_DIR, GRAPH_FILENAME } from "../graph/build.js";
import { getVersion } from "../version.js";

const HELP = `
Rune — the Software Intelligence Runtime

Usage:
  rune init [dir]     Set up Rune in the current (or given) project
  rune scan [dir]     Build (or rebuild) the understanding graph, once
  rune watch [dir]    Keep the understanding graph current as files change
  rune serve [dir]    Start the MCP server so AI clients can query it
  rune explain <id>   Show the evidence trail behind a fact or conclusion
  rune --version      Print the installed Rune version
  rune --help         Show this help
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
    case "-v":
    case "--version":
    case "version":
      console.log(getVersion());
      return;
    case "init":
      return cmdInit(rest);
    case "scan":
      return cmdScan(rest);
    case "watch":
      return cmdWatch(rest);
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

/**
 * Throws a clear, actionable error if `dir` isn't a real directory, instead
 * of letting downstream fs calls either silently no-op (readdir on a missing
 * path returning "0 files" as if the scan succeeded) or, worse, silently
 * create it (mkdirSync({recursive: true}) on a typo'd path).
 */
function assertDirExists(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error(`"${dir}" is not a directory. Check the path and try again.`);
  }
}

async function cmdInit(rest) {
  const dir = resolveDir(rest);
  assertDirExists(dir);

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
  const ignoreBlock = `\n# Rune understanding graph (regenerate with \`rune scan\`)\n${runeIgnoreLine}\n`;
  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, "utf8");
    if (!content.includes(runeIgnoreLine)) {
      fs.appendFileSync(gitignorePath, ignoreBlock);
    }
  } else {
    fs.writeFileSync(gitignorePath, ignoreBlock.trimStart() + "\n");
  }

  console.log(`[rune] initialized at ${runeDir}`);
  console.log(`[rune] edit ${configPath} to add ignore patterns (e.g. "legacy", "vendor").`);
  console.log(`[rune] run \`rune scan\` to build the understanding graph.`);
}

async function cmdScan(rest) {
  const dir = resolveDir(rest);
  assertDirExists(dir);

  const start = Date.now();
  const graph = buildGraph(dir);
  const filePath = writeGraph(dir, graph);
  const ms = Date.now() - start;

  console.log(`[rune] scanned ${graph.meta.fileCount} file(s) in ${ms}ms`);
  console.log(`[rune] facts: ${graph.facts.length}, derived conclusions: ${graph.derived.length}`);
  console.log(`[rune] graph written to ${filePath}`);
}

async function cmdWatch(rest) {
  const dir = resolveDir(rest);
  assertDirExists(dir);

  const { startWatch } = await import("../watch/index.js");

  console.log(`[rune] watching ${dir} for changes (Ctrl+C to stop)...`);
  const handle = startWatch(dir, {
    onRebuild: ({ ok, graph, error, reason }) => {
      if (ok) {
        console.log(`[rune] rescanned (${reason}) — ${graph.facts.length} facts, ${graph.derived.length} derived`);
      } else {
        console.error(`[rune] rescan failed (${reason}): ${error.message}`);
      }
    },
  });

  process.on("SIGINT", () => {
    console.log("\n[rune] stopping watch mode.");
    handle.stop();
    process.exit(0);
  });

  // Keep the process alive until Ctrl+C.
  await new Promise(() => {});
}

async function cmdServe(rest) {
  const dir = resolveDir(rest);
  assertDirExists(dir);

  const existing = readGraph(dir);
  if (!existing) {
    console.log(`[rune] no graph found — scanning ${dir} first...`);
    writeGraph(dir, buildGraph(dir));
  }

  try {
    const { startServer } = await import("../mcp/server.js");
    await startServer(dir);
  } catch (err) {
    // Covers @modelcontextprotocol/sdk, zod, or any other dependency that
    // hasn't been installed yet — one clear message instead of whichever
    // raw "Cannot find module" stack trace happened to surface first.
    if (err?.code === "ERR_MODULE_NOT_FOUND" || /Cannot find (package|module)/i.test(err?.message || "")) {
      console.error("[rune] a required dependency is missing. Run `npm install` in this project, then try `rune serve` again.");
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}

async function cmdExplain(rest) {
  const [id] = rest;
  if (!id) {
    console.log("Usage: rune explain <id>");
    process.exitCode = 1;
    return;
  }
  const dir = resolveDir(rest.slice(1));
  assertDirExists(dir);

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
    const evidenceChain = (derivedNode.basedOn || [])
      .map((factId) => graph.facts.find((f) => f.id === factId))
      .filter(Boolean);
    console.log(
      JSON.stringify(
        {
          kind: "derived",
          ...derivedNode,
          evidenceChain,
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
