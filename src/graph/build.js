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

const DEFAULT_MAX_SCAN_MS = null;

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

export function buildGraph(rootDir, options = {}) {
  if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
    throw new Error(`"${rootDir}" is not a directory. Check the path and try again.`);
  }

  const maxScanMs = options.maxScanMs ?? DEFAULT_MAX_SCAN_MS;
  const onProgress = options.onProgress;

  const config = readConfig(rootDir);
  const projectInfo = detectProjectKind(rootDir);
  const { files, stats: walkStats } = walkSourceFiles(rootDir, { ignore: config.ignore });
  const nextId = createIdGenerator();

  const facts = [];
  const rawSecurityFindings = [];
  const scanWarnings = [];
  const scanStart = Date.now();
  let timedOut = false;
  let filesActuallyScanned = 0;

  for (const filePath of files) {
    if (maxScanMs !== null && Date.now() - scanStart > maxScanMs) {
      timedOut = true;
      break;
    }

    const relPath = path.relative(rootDir, filePath);
    const content = readFileSafe(filePath);
    if (content == null) {
      // A file readdirSync reported as present but that couldn't actually
      // be read (permissions, race with a delete, etc.) is a real scan
      // gap, not a silent no-op -- record it the same way a parse failure
      // is recorded, so coverage numbers stay honest about what actually
      // got analyzed.
      scanWarnings.push({ file: relPath, error: "file could not be read" });
      continue;
    }

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

    filesActuallyScanned += 1;
    if (onProgress && filesActuallyScanned % 200 === 0) {
      onProgress({ scanned: filesActuallyScanned, total: files.length });
    }
  }

  if (!timedOut) {
    facts.push(...extractNextRoutes(rootDir, nextId));
  }

  const securityFindings = deduplicateFindings(rawSecurityFindings);

  let status;
  if (timedOut) {
    status = "timeout";
  } else if (walkStats.filesSupported === 0) {
    status = "no_supported_files";
  } else {
    status = "success";
  }

  // Only suppress derived understanding when there was genuinely nothing
  // supported to look at (status === "no_supported_files") -- NOT simply
  // whenever fact extraction happened to yield zero facts. A real JS/TS
  // project can legitimately have zero extractable facts (e.g. a file
  // with no imports, components, or routes) while still having real,
  // supported source code; that's a valid "success" scan and still
  // deserves whatever derived summary deriveUnderstanding produces for an
  // empty fact set, rather than being silently treated the same as a
  // repo Rune couldn't analyze at all.
  const derived = status === "no_supported_files" ? [] : deriveUnderstanding(facts, projectInfo);

  const scanDurationMs = Date.now() - scanStart;
  const coveragePercent = walkStats.filesSupported > 0
    ? Math.round((filesActuallyScanned / walkStats.filesSupported) * 1000) / 10
    : null;

  const graph = {
    meta: {
      rune: getVersion(),
      generatedAt: new Date().toISOString(),
      rootDir,
      fileCount: filesActuallyScanned,
      status,
      filesFailedToParse: scanWarnings.length,
      coverage: {
        filesDiscovered: walkStats.filesDiscovered,
        filesSupported: walkStats.filesSupported,
        filesScanned: filesActuallyScanned,
        filesSkippedUnsupportedExtension: walkStats.filesSkippedUnsupportedExtension,
        filesFailedToParse: scanWarnings.length,
        coveragePercent,
        scanDurationMs,
      },
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
