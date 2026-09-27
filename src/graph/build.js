import fs from "node:fs";
import path from "node:path";
import { walkSourceFiles, readFileSafe, detectProjectKind } from "../scanner/walk.js";
import { listBuckets, extractorsForBucket, extensionBuckets, PROJECT_EXTRACTORS } from "../scanner/registry.js";
import { deriveUnderstanding } from "./derive.js";
import { createIdGenerator } from "../scanner/id.js";
import { normalizeFacts } from "../scanner/fact-schema.js";
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
    if (!seen.has(key)) seen.set(key, finding);
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
  const walked = walkSourceFiles(rootDir, { ignore: config.ignore, extraExtensions: extensionBuckets() });
  const walkStats = walked.stats;
  const nextId = createIdGenerator();

  const facts = [];
  const rawSecurityFindings = [];
  const scanWarnings = [];
  const scanStart = Date.now();
  let timedOut = false;
  let filesActuallyScanned = 0;
  let filesProcessedThisRun = 0;

  const outputs = { facts, findings: rawSecurityFindings };

  for (const bucket of listBuckets()) {
    if (timedOut) break;
    const bucketFiles = walked[bucket] || [];
    const extractors = extractorsForBucket(bucket);
    for (const filePath of bucketFiles) {
      if (maxScanMs !== null && Date.now() - scanStart > maxScanMs) {
        timedOut = true;
        break;
      }
      const relPath = path.relative(rootDir, filePath);
      const content = readFileSafe(filePath);
      if (content == null) {
        scanWarnings.push({ file: relPath, error: "file could not be read" });
        filesActuallyScanned += 1;
        filesProcessedThisRun += 1;
        continue;
      }

      for (const extractor of extractors) {
        try {
          outputs[extractor.kind].push(...extractor.extract(filePath, content, rootDir, nextId));
        } catch (err) {
          scanWarnings.push({ file: relPath, extractor: extractor.name, error: err.message });
        }
      }

      filesActuallyScanned += 1;
      filesProcessedThisRun += 1;
      if (onProgress && filesProcessedThisRun % 200 === 0) {
        onProgress({ scanned: filesProcessedThisRun, total: walkStats.filesSupported });
      }
    }
  }

  if (!timedOut) {
    for (const extractor of PROJECT_EXTRACTORS) {
      try {
        outputs[extractor.kind].push(...extractor.extract(rootDir, nextId));
      } catch (err) {
        scanWarnings.push({ file: "(project-level)", extractor: extractor.name, error: err.message });
      }
    }
  }

  const normalizedFacts = normalizeFacts(facts);
  const securityFindings = deduplicateFindings(rawSecurityFindings);

  let status;
  if (timedOut) {
    status = "timeout";
  } else if (walkStats.filesSupported === 0) {
    status = "no_supported_files";
  } else {
    status = "success";
  }

  const derived = status === "no_supported_files"
    ? []
    : deriveUnderstanding(normalizedFacts, projectInfo, { scanIncomplete: status === "timeout" });

  const scanDurationMs = Date.now() - scanStart;
  const coveragePercent = walkStats.filesSupported > 0
    ? Math.round((filesActuallyScanned / walkStats.filesSupported) * 1000) / 10
    : null;

  const filesFailedToParse = new Set(scanWarnings.map((w) => w.file)).size;

  const graph = {
    meta: {
      rune: getVersion(),
      generatedAt: new Date().toISOString(),
      rootDir,
      fileCount: filesActuallyScanned,
      status,
      filesFailedToParse,
      coverage: {
        filesDiscovered: walkStats.filesDiscovered,
        filesSupported: walkStats.filesSupported,
        filesScanned: filesActuallyScanned,
        filesSkippedUnsupportedExtension: walkStats.filesSkippedUnsupportedExtension,
        filesFailedToParse,
        coveragePercent,
        scanDurationMs,
      },
      stack: {
        react: projectInfo.hasReact,
        next: projectInfo.hasNext,
        express: projectInfo.hasExpress,
      },
      note: "Facts are extracted via AST-based parsing (Babel parser/traverse), not regex heuristics. Every fact carries file/line/evidence and a confidence level. Every derived node lists the fact ids it is based on.",
    },
    facts: normalizedFacts,
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
    const staleOrMissing = !cached || mtime !== cachedMtimeMs;

    if (staleOrMissing) {
      const reread = readGraph(rootDir);
      if (reread) {
        cached = reread;
        cachedMtimeMs = mtime;
      } else {
        cached = buildGraph(rootDir);
        writeGraph(rootDir, cached);
        cachedMtimeMs = currentMtime();
      }
    }

    return cached;
  };
}
