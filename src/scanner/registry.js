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

const BUILTIN_BUCKETS = new Set(["files", "shellFiles", "configFiles", "markdownFiles", "luaFiles", "envFiles"]);

const EXTRACTORS = [
  { name: "file-facts", bucket: "files", kind: "facts", extract: extractFileFacts },
  { name: "express-routes", bucket: "files", kind: "facts", extract: extractExpressRoutes },
  { name: "shell-exec", bucket: "files", kind: "findings", extract: extractShellExecFindings },
  { name: "secrets-files", bucket: "files", kind: "findings", extract: extractSecretFindings },
  { name: "secrets-shell", bucket: "shellFiles", kind: "findings", extract: extractSecretFindings },
  { name: "secrets-config", bucket: "configFiles", kind: "findings", extract: extractSecretFindings },
  { name: "secrets-markdown", bucket: "markdownFiles", kind: "findings", extract: extractSecretFindings },
  { name: "secrets-env", bucket: "envFiles", kind: "findings", extract: extractSecretFindings },
  { name: "workflow", bucket: "configFiles", kind: "findings", extract: extractWorkflowFindings },
  { name: "shell", bucket: "shellFiles", kind: "facts", extract: extractShellFacts },
  { name: "config", bucket: "configFiles", kind: "facts", extract: extractConfigFacts },
  { name: "markdown", bucket: "markdownFiles", kind: "facts", extract: extractMarkdownFacts },
  { name: "lua", bucket: "luaFiles", kind: "facts", extract: extractLuaFacts },
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

export const PROJECT_EXTRACTORS = [
  { name: "next-routes", kind: "facts", extract: (rootDir, nextId) => extractNextRoutes(rootDir, nextId) },
  { name: "vue-components", kind: "facts", extract: (rootDir, nextId) => extractVueComponents(rootDir, nextId) },
  { name: "dependencies", kind: "findings", extract: extractDependencyFindingsProjectLevel },
];

export function extractorsForBucket(bucket) {
  return EXTRACTORS.filter((e) => e.bucket === bucket);
}

export function listExtractors() {
  return EXTRACTORS.map(({ name, bucket, kind }) => ({ name, bucket, kind }));
}

export function listBuckets() {
  return [...new Set(EXTRACTORS.map((e) => e.bucket))];
}

function normalizeExtensions(e) {
  return (e.extensions || []).map((x) => String(x).toLowerCase());
}

export function validateExtractor(e) {
  if (!e || typeof e !== "object") throw new Error("extractor must be an object");
  if (!e.name || typeof e.name !== "string") throw new Error("extractor requires a string 'name'");
  if (!e.bucket || typeof e.bucket !== "string") throw new Error("extractor requires a string 'bucket'");
  if (e.kind !== "facts" && e.kind !== "findings") throw new Error(`extractor "${e.name}" kind must be "facts" or "findings"`);
  if (typeof e.extract !== "function") throw new Error(`extractor "${e.name}" requires an 'extract' function`);

  const exts = normalizeExtensions(e);
  if (exts.length > 0 && BUILTIN_BUCKETS.has(e.bucket)) {
    throw new Error(`extractor "${e.name}" claims extensions but bucket "${e.bucket}" is a built-in bucket -- extensions require a new bucket`);
  }
  for (const x of exts) {
    if (BUILTIN_EXTENSIONS.has(x)) throw new Error(`extractor "${e.name}" cannot claim built-in extension "${x}"`);
  }
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
