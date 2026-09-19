import path from "node:path";
import { load as yamlLoad } from "js-yaml";
import TOML from "@iarna/toml";

/**
 * Configuration file intelligence — real parsers, not regex.
 *
 * Unlike shell.js, structured config formats (JSON/JSONC/YAML/TOML) have
 * accurate, well-maintained parsers available, so there's no excuse for
 * guessing structure with regex here -- that would risk exactly the kind
 * of confidently-wrong fact the roadmap warns against. Parse fully, then
 * walk the resulting object to emit one fact per top-level key (and one
 * level of nesting) rather than every leaf value, to avoid flooding the
 * graph with noise on large config files.
 */

const EVIDENCE_MAX_CHARS = 160;

function stripJsonComments(content) {
  // Minimal JSONC support: strip // line comments and /* */ block comments
  // outside of strings. Deliberately simple -- good enough for typical
  // JSONC config files (tsconfig.json etc.), not a full tokenizer.
  return content
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function parseConfigContent(content, ext) {
  if (ext === ".json") return JSON.parse(content);
  if (ext === ".jsonc") return JSON.parse(stripJsonComments(content));
  if (ext === ".yaml" || ext === ".yml") return yamlLoad(content);
  if (ext === ".toml") return TOML.parse(content);
  return null;
}

function findKeyLine(lines, key) {
  const basic = findKeyLineBasic(lines, key);
  if (basic) return basic;
  // TOML tables: [key], [key.sub], [[key]], [parent.key.sub]
  const esc = String(key).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("^\\s*\\[\\[?\\s*(?:[\\w-]+\\.)*" + esc + "(?:\\.[\\w-]+)*\\s*\\]\\]?\\s*(?:#.*)?$");
  for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) return i + 1;
  return null;
}

function evidenceFor(lines, ln) {
  if (!ln) return "";
  return lines[ln - 1]?.trim().slice(0, EVIDENCE_MAX_CHARS) || "";
}

// Find the line number of a top-level key by searching for it textually.
// Not perfect (doesn't handle duplicate key names across sections) but
// gives a real, usually-correct location rather than no location at all.
function findKeyLineBasic(lines, key) {
  const re = new RegExp(`^\\s*["']?${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']?\\s*[:=]`);
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) return i + 1;
  }
  return null;
}

export function extractConfigFacts(filePath, content, rootDir, nextId) {
  const relPath = path.relative(rootDir, filePath);
  const ext = path.extname(filePath);
  const facts = [];
  const lines = content.split("\n");

  let parsed;
  try {
    parsed = parseConfigContent(content, ext);
  } catch {
    // Malformed config -- record nothing rather than guess. A fact from
    // a file that failed to parse would be unverifiable noise.
    return facts;
  }

  if (!parsed || typeof parsed !== "object") return facts;

  for (const key of Object.keys(parsed)) {
    const ln = findKeyLine(lines, key);
    const value = parsed[key];
    const valueType = Array.isArray(value) ? "array" : typeof value;

    facts.push({
      id: nextId("config_key"),
      type: "config_key",
      file: relPath,
      line: ln,
      name: key,
      valueType,
      confidence: ln ? "high" : "medium",
      evidence: evidenceFor(lines, ln),
    });

    // One level of nesting for object values -- e.g. a TOML [service]
    // table or a YAML nested map -- without going fully recursive and
    // flooding the graph.
    if (valueType === "object" && value !== null) {
      for (const nestedKey of Object.keys(value)) {
        const nestedLn = findKeyLine(lines, nestedKey);
        facts.push({
          id: nextId("config_key"),
          type: "config_key",
          file: relPath,
          line: nestedLn,
          name: `${key}.${nestedKey}`,
          valueType: Array.isArray(value[nestedKey]) ? "array" : typeof value[nestedKey],
          confidence: nestedLn ? "high" : "medium",
          evidence: evidenceFor(lines, nestedLn),
        });
      }
    }
  }

  return facts;
}
