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

  const facts = [];
  for (const filePath of files) {
    const content = readFileSafe(filePath);
    if (content == null) continue;
    facts.push(...extractFileFacts(filePath, content, rootDir, nextId));
    if (projectInfo.hasExpress) {
      facts.push(...extractExpressRoutes(filePath, content, rootDir, nextId));
    }
  }

  if (projectInfo.hasNext) {
    facts.push(...extractNextRoutes(rootDir, nextId));
  }

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
