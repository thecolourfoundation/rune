// The extractor registry. An extractor turns one kind of source into evidence.
//
// Contract:
//   { name, bucket, kind, extract }
//   name    unique string
//   bucket  which group of files it handles (a key returned by walkSourceFiles)
//   kind    "facts" (goes into the fact graph) or "findings" (security findings)
//   extract (filePath, content, rootDir, nextId) => array
//
// Extractors for one bucket run in array order for every file, sharing one id
// generator, so the order below also fixes the ids in the graph. Do not reorder.
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

const EXTRACTORS = [
  { name: "file-facts", bucket: "files", kind: "facts", extract: extractFileFacts },
  { name: "express-routes", bucket: "files", kind: "facts", extract: extractExpressRoutes },
  { name: "secrets", bucket: "files", kind: "findings", extract: extractSecretFindings },
  { name: "shell-exec", bucket: "files", kind: "findings", extract: extractShellExecFindings },
  { name: "workflow", bucket: "files", kind: "findings", extract: extractWorkflowFindings },
  { name: "dependencies", bucket: "files", kind: "findings", extract: extractDependencyFindings },
  { name: "shell", bucket: "shellFiles", kind: "facts", extract: extractShellFacts },
  { name: "config", bucket: "configFiles", kind: "facts", extract: extractConfigFacts },
  { name: "markdown", bucket: "markdownFiles", kind: "facts", extract: extractMarkdownFacts },
  { name: "lua", bucket: "luaFiles", kind: "facts", extract: extractLuaFacts },
];

// Project-level extractors look at the whole project, not one file: extract(rootDir, nextId).
export const PROJECT_EXTRACTORS = [
  { name: "next-routes", kind: "facts", extract: (rootDir, nextId) => extractNextRoutes(rootDir, nextId) },
  { name: "vue-components", kind: "facts", extract: (rootDir, nextId) => extractVueComponents(rootDir, nextId) },
];

export function validateExtractor(e) {
  if (!e || typeof e !== "object") throw new Error("extractor must be an object");
  if (typeof e.name !== "string" || !e.name) throw new Error("extractor needs a name");
  if (typeof e.bucket !== "string" || !e.bucket) throw new Error(`extractor "${e.name}" needs a bucket`);
  if (e.kind !== "facts" && e.kind !== "findings") throw new Error(`extractor "${e.name}": kind must be "facts" or "findings"`);
  if (typeof e.extract !== "function") throw new Error(`extractor "${e.name}" needs an extract function`);
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

// Adds an extractor; returns a function that removes it again.
export function registerExtractor(e) {
  validateExtractor(e);
  if (EXTRACTORS.some((x) => x.name === e.name)) throw new Error(`extractor "${e.name}" is already registered`);
  EXTRACTORS.push(e);
  return () => {
    const i = EXTRACTORS.indexOf(e);
    if (i >= 0) EXTRACTORS.splice(i, 1);
  };
}
