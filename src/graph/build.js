import fs from "node:fs";
import path from "node:path";
import { walkSourceFiles, readFileSafe, detectProjectKind } from "../scanner/walk.js";
import { extractFileFacts } from "../scanner/facts.js";
import { extractExpressRoutes } from "../scanner/express.js";
import { extractNextRoutes } from "../scanner/nextjs.js";
import { deriveUnderstanding } from "./derive.js";

export const RUNE_DIR = ".rune";
export const GRAPH_FILENAME = "graph.json";

export function buildGraph(rootDir) {
  const projectInfo = detectProjectKind(rootDir);
  const files = walkSourceFiles(rootDir);

  const facts = [];
  for (const filePath of files) {
    const content = readFileSafe(filePath);
    if (content == null) continue;
    facts.push(...extractFileFacts(filePath, content, rootDir));
    if (projectInfo.hasExpress) {
      facts.push(...extractExpressRoutes(filePath, content, rootDir));
    }
  }

  if (projectInfo.hasNext) {
    facts.push(...extractNextRoutes(rootDir));
  }

  const derived = deriveUnderstanding(facts, projectInfo);

  const graph = {
    meta: {
      rune: "0.1.0",
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
