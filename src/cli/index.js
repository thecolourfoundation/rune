import path from "node:path";
import fs from "node:fs";
import { buildGraph, writeGraph, readGraph, RUNE_DIR, GRAPH_FILENAME } from "../graph/build.js";
import { getVersion } from "../version.js";
import {
  addProjectMemory,
  listProjectMemory,
  approveProjectMemory,
  rejectProjectMemory,
  addExperience,
  listExperience,
} from "../memory/memory.js";

const HELP = `
Rune — the Software Intelligence Runtime

Usage:
  rune init [dir]     Set up Rune in the current (or given) project
  rune scan [dir]     Build (or rebuild) the understanding graph, once
  rune watch [dir]    Keep the understanding graph current as files change
  rune serve [dir]    Start the MCP server so AI clients can query it
  rune explain <id>   Show the evidence trail behind a fact or conclusion
  rune memory <cmd>   Manage project memory (add/list/approve/reject)
  rune experience <cmd>  Log and review past task outcomes (add/list)
  rune --version      Print the installed Rune version
  rune --help         Show this help

Memory commands:
  rune memory add "<rule>" [--category=<cat>] [--evidence="<note>"] [dir]
  rune memory list [--status=proposed|approved|rejected] [dir]
  rune memory approve <id> [dir]
  rune memory reject <id> [dir]

Experience commands:
  rune experience add "<task>" --outcome=success|failure [--strategy="<note>"] [--evidence="<note>"] [dir]
  rune experience list [--outcome=success|failure] [dir]
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
    case "memory":
      return cmdMemory(rest);
    case "experience":
      return cmdExperience(rest);
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

  if (graph.meta.status === "no_supported_files") {
    console.log(`[rune] scanned 0 supported source files in ${ms}ms`);
    console.log(`[rune] security analysis skipped: no supported source files found (unsupported language, or nothing scannable in this project)`);
    console.log(`[rune] status: NO_SUPPORTED_FILES`);
    console.log(`[rune] graph written to ${filePath}`);
    return;
  }

  console.log(`[rune] scanned ${graph.meta.fileCount} file(s) in ${ms}ms`);
  console.log(`[rune] facts: ${graph.facts.length}, derived conclusions: ${graph.derived.length}`);

  if (graph.scanWarnings && graph.scanWarnings.length > 0) {
    console.log(`[rune] warning: ${graph.scanWarnings.length} file(s) failed to fully parse and were skipped (scan continued)`);
  }

  printSecurityVerdict(graph.securityFindings || []);

  console.log(`[rune] graph written to ${filePath}`);
  console.log(`[rune] run \`rune explain <id>\` on any fact/finding above for the full evidence trail.`);
}

/**
 * Prints a one-line verdict plus a short breakdown by severity BEFORE any
 * raw finding details -- the goal is "what did Rune learn, is there
 * anything to act on" answered in the first few lines a user sees, not
 * buried under a wall of individual finding objects. Full detail is still
 * available via `rune explain <id>`; this is the summary layer on top.
 *
 * IMPORTANT: this function is the single source of truth for the counts it
 * prints. It must derive every number directly from the `findings` array
 * passed in (which is graph.securityFindings) via plain filter().length --
 * no caching, no separate running tally, no reliance on any other function
 * having counted correctly first. A benchmark run against React previously
 * showed this summary printing "6 high, 6 medium" against a graph that
 * actually contained 7 high / 5 medium findings -- a real discrepancy
 * between what's on disk and what the CLI reports. Recomputing everything
 * fresh, in one place, from one array, is the fix -- and countSeverities
 * below is exported specifically so a test can assert exact numbers
 * against a known fixture instead of only checking the code "looks right."
 */
export function countSeverities(findings) {
  return {
    total: findings.length,
    critical: findings.filter((f) => f.severity === "critical").length,
    high: findings.filter((f) => f.severity === "high").length,
    medium: findings.filter((f) => f.severity === "medium").length,
    low: findings.filter((f) => f.severity === "low").length,
  };
}

function printSecurityVerdict(findings) {
  if (findings.length === 0) {
    console.log(`[rune] security: no findings.`);
    return;
  }

  const counts = countSeverities(findings);
  const criticalOrHigh = counts.critical + counts.high;

  console.log(`[rune] security findings: ${counts.total}`);
  console.log(`[rune]   critical: ${counts.critical}  high: ${counts.high}  medium: ${counts.medium}  low: ${counts.low}`);

  if (criticalOrHigh === 0) {
    console.log(`[rune]   none critical/high -- nothing urgent, but see .rune/graph.json for the full list.`);
    return;
  }

  console.log(`[rune] showing ${Math.min(criticalOrHigh, 5)} of ${criticalOrHigh} critical/high finding(s):`);

  // Show the top few critical/high findings inline -- enough to act on
  // without needing a separate command, capped so a large finding set
  // doesn't turn `rune scan` output into a wall of text. This slice is
  // ONLY for which findings get individually printed below -- it must
  // never feed back into the counts above, which is what a slice-before-
  // count bug would look like.
  const priority = findings
    .filter((f) => f.severity === "critical" || f.severity === "high")
    .slice(0, 5);
  for (const f of priority) {
    console.log(`[rune]   [${f.severity}] ${f.rule} — ${f.file}:${f.line} (${f.id})`);
  }
  if (criticalOrHigh > priority.length) {
    console.log(`[rune]   ...and ${criticalOrHigh - priority.length} more. See .rune/graph.json or rune_search via MCP.`);
  }
}

/**
 * A brief animated startup banner for the two long-running commands
 * (watch, serve) -- this is the one moment a human actually watches the
 * terminal rather than reading a one-shot result, so it's the natural
 * place for a bit of visual identity. Plain ANSI codes, no color library
 * dependency, consistent with the project staying dependency-light.
 * Plays once (a few hundred ms), then gets out of the way -- deliberately
 * NOT a continuous/idle animation, since a spinner that never stops reads
 * as broken rather than polished, and burns cycles in a background daemon
 * for no reason.
 */
async function printStartupBanner(label) {
  const frames = ["◐", "◓", "◑", "◒"];
  const dim = "\x1b[2m";
  const bold = "\x1b[1m";
  const reset = "\x1b[0m";

  for (let i = 0; i < frames.length * 2; i++) {
    process.stdout.write(`\r${dim}${frames[i % frames.length]}${reset} ${bold}RUNE${reset} ${dim}${label}${reset}`);
    await new Promise((resolve) => setTimeout(resolve, 90));
  }
  process.stdout.write(`\r${bold}RUNE${reset}  ${label}\n`);
}

async function cmdWatch(rest) {
  const dir = resolveDir(rest);
  assertDirExists(dir);

  const { startWatch } = await import("../watch/index.js");

  await printStartupBanner(`watching ${dir}`);
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

  await printStartupBanner(`serving ${dir}`);

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
    console.log(`[rune] no graph found here yet. Run \`rune scan\` first to build one, then try again.`);
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

/**
 * Parses simple --flag=value arguments out of the remaining args, returning
 * both the flags found and the leftover positional args. Kept intentionally
 * minimal (no external arg-parsing dependency) since memory's CLI surface
 * is small.
 */
function parseFlags(args) {
  const flags = {};
  const positional = [];
  for (const arg of args) {
    const match = /^--([\w-]+)=(.*)$/.exec(arg);
    if (match) {
      flags[match[1]] = match[2];
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

async function cmdMemory(rest) {
  const [subcommand, ...subRest] = rest;

  switch (subcommand) {
    case "add":
      return cmdMemoryAdd(subRest);
    case "list":
      return cmdMemoryList(subRest);
    case "approve":
      return cmdMemoryApprove(subRest);
    case "reject":
      return cmdMemoryReject(subRest);
    default:
      console.log(`Unknown memory command: ${subcommand}\n${HELP}`);
      process.exitCode = 1;
  }
}

async function cmdMemoryAdd(rest) {
  const { flags, positional } = parseFlags(rest);
  const [rule, ...dirArgs] = positional;

  if (!rule) {
    console.log('Usage: rune memory add "<rule>" [--category=<cat>] [--evidence="<note>"] [dir]');
    process.exitCode = 1;
    return;
  }

  const dir = resolveDir(dirArgs);
  assertDirExists(dir);

  const entry = addProjectMemory(dir, {
    rule,
    category: flags.category,
    evidenceNote: flags.evidence,
  });

  console.log(`[rune] memory entry added (status: proposed, confidence: ${entry.confidence})`);
  console.log(`[rune] id: ${entry.id}`);
  console.log(`[rune] run \`rune memory approve ${entry.id}\` to trust this before it's surfaced to AI clients.`);
}

async function cmdMemoryList(rest) {
  const { flags, positional } = parseFlags(rest);
  const dir = resolveDir(positional);
  assertDirExists(dir);

  const entries = listProjectMemory(dir, { statusFilter: flags.status });

  if (entries.length === 0) {
    console.log(flags.status
      ? `[rune] no memory entries with status "${flags.status}".`
      : "[rune] no memory entries yet. Add one with `rune memory add`.");
    return;
  }

  for (const e of entries) {
    console.log(`${e.id}  [${e.status}]  (confidence: ${e.confidence})  ${e.rule}`);
  }
}

async function cmdMemoryApprove(rest) {
  const [id, ...dirArgs] = rest;
  if (!id) {
    console.log("Usage: rune memory approve <id> [dir]");
    process.exitCode = 1;
    return;
  }
  const dir = resolveDir(dirArgs);
  assertDirExists(dir);

  try {
    const entry = approveProjectMemory(dir, id);
    console.log(`[rune] approved: ${entry.rule}`);
  } catch (err) {
    console.error(`[rune] ${err.message}`);
    process.exitCode = 1;
  }
}

async function cmdMemoryReject(rest) {
  const [id, ...dirArgs] = rest;
  if (!id) {
    console.log("Usage: rune memory reject <id> [dir]");
    process.exitCode = 1;
    return;
  }
  const dir = resolveDir(dirArgs);
  assertDirExists(dir);

  try {
    const entry = rejectProjectMemory(dir, id);
    console.log(`[rune] rejected: ${entry.rule}`);
  } catch (err) {
    console.error(`[rune] ${err.message}`);
    process.exitCode = 1;
  }
}

async function cmdExperience(rest) {
  const [subcommand, ...subRest] = rest;

  switch (subcommand) {
    case "add":
      return cmdExperienceAdd(subRest);
    case "list":
      return cmdExperienceList(subRest);
    default:
      console.log(`Unknown experience command: ${subcommand}\n${HELP}`);
      process.exitCode = 1;
  }
}

async function cmdExperienceAdd(rest) {
  const { flags, positional } = parseFlags(rest);
  const [taskDescription, ...dirArgs] = positional;

  if (!taskDescription || !flags.outcome) {
    console.log('Usage: rune experience add "<task>" --outcome=success|failure [--strategy="<note>"] [--evidence="<note>"] [dir]');
    process.exitCode = 1;
    return;
  }

  const dir = resolveDir(dirArgs);
  assertDirExists(dir);

  try {
    const entry = addExperience(dir, {
      taskDescription,
      outcome: flags.outcome,
      strategyUsed: flags.strategy,
      evidenceSource: flags.evidence,
    });
    console.log(`[rune] experience recorded (${entry.outcome})`);
    console.log(`[rune] id: ${entry.id}`);
  } catch (err) {
    console.error(`[rune] ${err.message}`);
    process.exitCode = 1;
  }
}

async function cmdExperienceList(rest) {
  const { flags, positional } = parseFlags(rest);
  const dir = resolveDir(positional);
  assertDirExists(dir);

  const entries = listExperience(dir, { outcomeFilter: flags.outcome });

  if (entries.length === 0) {
    console.log(flags.outcome
      ? `[rune] no experience entries with outcome "${flags.outcome}".`
      : "[rune] no experience entries yet. Add one with `rune experience add`.");
    return;
  }

  for (const e of entries) {
    console.log(`${e.id}  [${e.outcome}]  ${e.taskDescription}`);
  }
}
