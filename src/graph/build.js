import fs from "node:fs";
import path from "node:path";
import { walkSourceFiles, readFileSafe, detectProjectKind } from "../scanner/walk.js";
import { extractFileFacts } from "../scanner/facts.js";
import { extractExpressRoutes } from "../scanner/express.js";
import { extractNextRoutes } from "../scanner/nextjs.js";
import { extractSecretFindings } from "../scanner/secrets.js";
import { extractShellExecFindings } from "../scanner/shellexec.js";
import { extractWorkflowFindings } from "../scanner/workflow.js";
import { extractDependencyFindings } from "../scanner/depcheck.js";
import { deriveUnderstanding } from "./derive.js";
import { createIdGenerator } from "../scanner/id.js";
import { getVersion } from "../version.js";

export const RUNE_DIR = ".rune";
export const GRAPH_FILENAME = "graph.json";
export const CONFIG_FILENAME = "config.json";

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

/**
 * Deduplicates security findings that describe the same underlying
 * evidence -- same category, rule, file, and line. This surfaced as a real
 * bug in benchmark data: the same finding appeared twice for the same
 * file/line (e.g. two identical "redaction pattern" findings at the exact
 * same location), inflating finding counts and undermining the benchmark's
 * credibility. Dedup keeps the first occurrence (earliest id) and drops
 * exact repeats; it does NOT merge near-duplicates with different rules or
 * lines, since those may be genuinely distinct findings that happen to be
 * close together.
 */
function deduplicateFindings(findings) {
  const seen = new Map();
  for (const finding of findings) {
    const key = `${finding.category}|${finding.rule}|${finding.file}|${finding.line}`;
    if (!seen.has(key)) {
      seen.set(key, finding);
    }
  }
  return Array.from(seen.values());
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
  const rawSecurityFindings = [];
  const scanWarnings = [];
  for (const filePath of files) {
    const content = readFileSafe(filePath);
    if (content == null) continue;

    // Every extractor call for this file is wrapped in one try/catch --
    // this is the top-level safety net. A benchmark run against large
    // real-world repos (VS Code, Next.js) showed a single file's parser/
    // traversal failure could throw uncaught and kill the ENTIRE
    // repository scan, discarding everything already collected. One bad
    // file must cost that file's own facts/findings, never the whole scan.
    const relPath = path.relative(rootDir, filePath);
    try {
      facts.push(...extractFileFacts(filePath, content, rootDir, nextId));
      facts.push(...extractExpressRoutes(filePath, content, rootDir, nextId));
      rawSecurityFindings.push(...extractSecretFindings(filePath, content, rootDir, nextId));
      rawSecurityFindings.push(...extractShellExecFindings(filePath, content, rootDir, nextId));
      rawSecurityFindings.push(...extractWorkflowFindings(filePath, content, rootDir, nextId));
      rawSecurityFindings.push(...extractDependencyFindings(filePath, content, rootDir, nextId));
    } catch (err) {
      scanWarnings.push({ file: relPath, error: err.message });
    }
  }
  facts.push(...extractNextRoutes(rootDir, nextId));

  const securityFindings = deduplicateFindings(rawSecurityFindings);

  const derived = facts.length > 0 ? deriveUnderstanding(facts, projectInfo) : [];

  const graph = {
    meta: {
      rune: getVersion(),
      generatedAt: new Date().toISOString(),
      rootDir,
      fileCount: files.length,
      // "success" is misleading when zero files were actually scannable --
      // a benchmark run against kubernetes/kubernetes and torvalds/linux
      // showed Rune printing "no security findings" for repos it had not
      // meaningfully analyzed at all (0 files discovered as scannable
      // JS/TS). This status makes that distinction explicit instead of
      // letting a clean-looking zero imply a real, completed analysis.
      status: files.length === 0 ? "no_supported_files" : "success",
      filesFailedToParse: scanWarnings.length,
      stack: {
        react: projectInfo.hasReact,
        next: projectInfo.hasNext,
        express: projectInfo.hasExpress,
      },
      note: "Facts are extracted via AST-based parsing (Babel parser/traverse), not regex heuristics. Every fact carries file/line/evidence. Every derived node lists the fact ids it is based on.",
    },
    facts,
    derived,
    securityFindings,
    scanWarnings,
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
