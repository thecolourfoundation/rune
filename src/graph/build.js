import fs from "node:fs";
import path from "node:path";
import { walkSourceFiles, readFileSafe, detectProjectKind } from "../scanner/walk.js";
import { extractFileFacts } from "../scanner/facts.js";
import { extractExpressRoutes } from "../scanner/express.js";
import { extractNextRoutes } from "../scanner/nextjs.js";
import { deriveUnderstanding } from "./derive.js";
import { createIdGenerator } from "../scanner/id.js";
import { getVersion } from "../version.js";

export const RUNE_DIR = ".rune";
export const GRAPH_FILENAME = "graph.json";
export const CONFIG_FILENAME = "config.json";

/**
 * Reads .rune/config.json if present (written by `rune init`). Missing or
 * malformed config is not an error — it just means default (empty) ignores.
 */
function readConfig(rootDir) {
  const configPath = path.join(rootDir, RUNE_DIR, CONFIG_FILENAME);
  if (!fs.existsSync(configPath)) return { ignore: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return { ignore: Array.isArray(parsed.ignore) ? parsed.ignore : [] };
  } catch (err) {
    console.error(`[rune] warning: ${configPath} is malformed (${err.message}). Ignoring it for this scan.`);
    return { ignore: [] };
  }
}

export function buildGraph(rootDir) {
  if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
    throw new Error(`"${rootDir}" is not a directory. Check the path and try again.`);
  }

  const config = readConfig(rootDir);
  const projectInfo = detectProjectKind(rootDir);
  const files = walkSourceFiles(rootDir, { ignore: config.ignore });
  const nextId = createIdGenerator();

  // Route extraction always runs, regardless of what package.json declares.
  // A package.json-only gate here would silently suppress real route facts
  // whenever a codebase uses a framework without declaring it as a direct
  // dependency (e.g. a monorepo where the dependency lives in a different
  // package.json, or code that imports something ahead of updating the
  // manifest) -- exactly the kind of gap real-world code has and a curated
  // fixture doesn't. package.json is still read (detectProjectKind) as one
  // signal among several; deriveUnderstanding decides what to report based
  // on the actual facts found, not just the manifest.
  const facts = [];
  for (const filePath of files) {
    const content = readFileSafe(filePath);
    if (content == null) continue;
    facts.push(...extractFileFacts(filePath, content, rootDir, nextId));
    facts.push(...extractExpressRoutes(filePath, content, rootDir, nextId));
  }
  facts.push(...extractNextRoutes(rootDir, nextId));

  const derived = deriveUnderstanding(facts, projectInfo);

  const graph = {
    meta: {
      rune: getVersion(),
      generatedAt: new Date().toISOString(),
      rootDir,
      fileCount: files.length,
      stack: {
        react: projectInfo.hasReact,
        next: projectInfo.hasNext,
        express: projectInfo.hasExpress,
      },
      note: "Facts are extracted via heuristic regex-based scanning, not a full AST parser. Every fact carries file/line/evidence. Every derived node lists the fact ids it is based on.",
    },
    facts,
    derived,
  };

  return graph;
}

export function writeGraph(rootDir, graph) {
  const dir = path.join(rootDir, RUNE_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, GRAPH_FILENAME);
  fs.writeFileSync(filePath, JSON.stringify(graph, null, 2));
  return filePath;
}

export function readGraph(rootDir) {
  const filePath = path.join(rootDir, RUNE_DIR, GRAPH_FILENAME);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    console.error(`[rune] warning: ${filePath} is corrupted or unreadable (${err.message}). Run \`rune scan\` to rebuild it.`);
    return null;
  }
}

/**
 * Returns a getGraph() function that automatically reloads from disk when
 * the graph file's mtime changes, instead of caching forever. This is what
 * lets a long-running `rune serve` process stay current when a separate
 * `rune watch` process (or a manual `rune scan`) updates the graph in the
 * background -- without needing an explicit rescan call in between.
 */
export function createLiveGraphReader(rootDir) {
  let cached = null;
  let cachedMtimeMs = null;

  function currentMtime() {
    try {
      return fs.statSync(path.join(rootDir, RUNE_DIR, GRAPH_FILENAME)).mtimeMs;
    } catch {
      return null;
    }
  }

  return function getGraph() {
    const mtime = currentMtime();
    const staleOrMissing = !cached || (mtime !== null && mtime !== cachedMtimeMs);

    if (staleOrMissing) {
      const reread = readGraph(rootDir);
      if (reread) {
        cached = reread;
        cachedMtimeMs = mtime;
      } else if (!cached) {
        cached = buildGraph(rootDir);
        writeGraph(rootDir, cached);
        cachedMtimeMs = currentMtime();
      }
    }

    return cached;
  };
}
