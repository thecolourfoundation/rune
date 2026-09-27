// The extractor registry. An extractor turns one kind of source into evidence.
//
// Contract:
//   { name, bucket, kind, extract, extensions? }
//   name       unique string
//   bucket     which group of files it handles (a key returned by walkSourceFiles)
//   kind       "facts" (goes into the fact graph) or "findings" (security findings)
//   extract    (filePath, content, rootDir, nextId) => array
//   extensions optional, e.g. [".txt"]: claim file extensions for a NEW bucket. Built-in
//              extensions and built-in buckets cannot be claimed.
//
// Extractors for one bucket run in array order for every file, sharing one id
// generator, so the order below also fixes the ids in the graph. Do not reorder.
import fs from "node:fs";
import path from "node:path";
import { BUILTIN_EXTENSIONS } from "./walk.js";
import { extractFileFacts } from "./facts.js";
import { extractExpressRoutes } from "./express.js";
import { extractSecretFindings } from "./secrets.js";
import { extractShellExecFindings } from "./shellexec.js";
import { extractWorkflowFindings } from "./workflow.js";
import { extractDependencyFindings } from "./depcheck.js";
import { extractShellFacts } from "./shell.js";
import { extractConfigFacts } from "./config.js";
import { extractMarkdownFacts } from "./markdown.js";
import { extractLuaFacts } from "./lua.js";
import { extractNextRoutes } from "./nextjs.js";
import { extractVueComponents } from "./vue.js";
// Science + math extractors
import { extractNotebookFacts } from "./notebook.js";
import { extractPythonFacts } from "./python.js";
import { extractLatexFacts } from "./latex.js";
import { extractLeanFacts } from "./lean.js";
import { extractRFacts } from "./r.js";

const BUILTIN_BUCKETS = new Set(["files", "shellFiles", "configFiles", "markdownFiles", "luaFiles", "envFiles"]);

const EXTRACTORS = [
  // ── SWE (existing) ──
  { name: "file-facts",   bucket: "files",         kind: "facts",    extract: extractFileFacts },
  { name: "express-routes", bucket: "files",        kind: "facts",    extract: extractExpressRoutes },
  { name: "shell-exec",   bucket: "files",          kind: "findings", extract: extractShellExecFindings },
  // FIXED (audit #24/#42/#43): secrets/workflow/dependencies were all
  // previously registered under bucket "files" (JS/TS only). Real secrets,
  // GitHub workflow YAML, and package.json mostly don't live in JS/TS
  // files, so this meant 3 of 4 security detectors could functionally
  // never fire on their real target. Split across the buckets their real
  // target files actually live in; dependencies moved to PROJECT_EXTRACTORS
  // below since package.json is deliberately excluded from every per-file
  // bucket (see walk.js) and could never have been reached as a bucket
  // extractor at all.
  { name: "secrets-files",    bucket: "files",         kind: "findings", extract: extractSecretFindings },
  { name: "secrets-shell",    bucket: "shellFiles",    kind: "findings", extract: extractSecretFindings },
  { name: "secrets-config",   bucket: "configFiles",   kind: "findings", extract: extractSecretFindings },
  { name: "secrets-markdown", bucket: "markdownFiles", kind: "findings", extract: extractSecretFindings },
  { name: "secrets-env",      bucket: "envFiles",      kind: "findings", extract: extractSecretFindings },
  { name: "workflow",     bucket: "configFiles",    kind: "findings", extract: extractWorkflowFindings },
  { name: "shell",        bucket: "shellFiles",     kind: "facts",    extract: extractShellFacts },
  { name: "config",       bucket: "configFiles",    kind: "facts",    extract: extractConfigFacts },
  { name: "markdown",     bucket: "markdownFiles",  kind: "facts",    extract: extractMarkdownFacts },
  { name: "lua",          bucket: "luaFiles",       kind: "facts",    extract: extractLuaFacts },
  // ── Science + math (from origin/main) ──
  { name: "notebook",     bucket: "notebookFiles",  kind: "facts",    extract: extractNotebookFacts, extensions: [".ipynb"] },
  { name: "python",       bucket: "pythonFiles",    kind: "facts",    extract: extractPythonFacts,   extensions: [".py"] },
  { name: "latex",        bucket: "latexFiles",     kind: "facts",    extract: extractLatexFacts,    extensions: [".tex", ".bib"] },
  { name: "lean",         bucket: "leanFiles",      kind: "facts",    extract: extractLeanFacts,     extensions: [".lean"] },
  { name: "r-lang",       bucket: "rFiles",         kind: "facts",    extract: extractRFacts,        extensions: [".r", ".rmd"] },
];

function extractDependencyFindingsProjectLevel(rootDir, nextId) {
  const pkgPath = path.join(rootDir, "package.json");
  let content;
  try {
    content = fs.readFileSync(pkgPath, "utf8");
  } catch {
    return [];
  }
  return extractDependencyFindings(pkgPath, content, rootDir, nextId);
}

// Project-level extractors look at the whole project, not one file: extract(rootDir, nextId).
export const PROJECT_EXTRACTORS = [
  { name: "next-routes",    kind: "facts",    extract: (rootDir, nextId) => extractNextRoutes(rootDir, nextId) },
  { name: "vue-components", kind: "facts",    extract: (rootDir, nextId) => extractVueComponents(rootDir, nextId) },
  { name: "dependencies",   kind: "findings", extract: extractDependencyFindingsProjectLevel },
];

function normalizeExtensions(e) {
  return (e.extensions || []).map((x) => x.toLowerCase());
}

export function validateExtractor(e) {
  if (!e || typeof e !== "object") throw new Error("extractor must be an object");
  if (typeof e.name !== "string" || !e.name) throw new Error("extractor needs a name");
  if (typeof e.bucket !== "string" || !e.bucket) throw new Error(`extractor "${e.name}" needs a bucket`);
  if (e.kind !== "facts" && e.kind !== "findings") throw new Error(`extractor "${e.name}": kind must be "facts" or "findings"`);
  if (typeof e.extract !== "function") throw new Error(`extractor "${e.name}" needs an extract function`);
  if (e.extensions !== undefined) {
    if (!Array.isArray(e.extensions) || e.extensions.length === 0) {
      throw new Error(`extractor "${e.name}": extensions must be a non-empty array`);
    }
    if (BUILTIN_BUCKETS.has(e.bucket) || e.bucket === "stats") {
      throw new Error(`extractor "${e.name}": extensions need a new bucket name, not "${e.bucket}"`);
    }
    for (const x of e.extensions) {
      if (typeof x !== "string" || !/^\.[A-Za-z0-9]+$/.test(x)) {
        throw new Error(`extractor "${e.name}": bad extension "${x}" (expected something like ".txt")`);
      }
      if (BUILTIN_EXTENSIONS.has(x.toLowerCase())) {
        throw new Error(`extractor "${e.name}": "${x}" is already handled by a built-in extractor`);
      }
    }
  }
}

export function listBuckets() {
  return [...new Set(EXTRACTORS.map((e) => e.bucket))];
}

export function extractorsForBucket(bucket) {
  return EXTRACTORS.filter((e) => e.bucket === bucket);
}

export function listExtractors() {
  return EXTRACTORS.map(({ name, bucket, kind }) => ({ name, bucket, kind }));
}

export function extensionBuckets() {
  const map = {};
  for (const e of EXTRACTORS) for (const x of normalizeExtensions(e)) map[x] = e.bucket;
  return map;
}

export function registerExtractor(e) {
  validateExtractor(e);
  if (EXTRACTORS.some((x) => x.name === e.name)) throw new Error(`extractor "${e.name}" is already registered`);
  for (const x of normalizeExtensions(e)) {
    const other = EXTRACTORS.find((o) => o.bucket !== e.bucket && normalizeExtensions(o).includes(x));
    if (other) throw new Error(`extension "${x}" is already claimed by "${other.name}" for bucket "${other.bucket}"`);
  }
  EXTRACTORS.push(e);
  return () => {
    const i = EXTRACTORS.indexOf(e);
    if (i >= 0) EXTRACTORS.splice(i, 1);
  };
}
