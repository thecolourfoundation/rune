import fs from "node:fs";
import path from "node:path";
import { RUNE_DIR } from "../graph/build.js";

/**
 * Memory storage layer -- deliberately separate from graph.json. The graph
 * is regenerated fresh on every `rune scan` (disposable, derived from
 * current code). Memory is durable, accumulated over time, and must
 * survive scans -- so it lives in its own file and nothing in build.js
 * ever overwrites it.
 */

export const MEMORY_FILENAME = "memory.json";

function memoryPath(rootDir) {
  return path.join(rootDir, RUNE_DIR, MEMORY_FILENAME);
}

function emptyMemory() {
  return {
    version: 1,
    projectMemory: [],
    experience: [],
  };
}

export function readMemory(rootDir) {
  const filePath = memoryPath(rootDir);
  if (!fs.existsSync(filePath)) return emptyMemory();
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    // Defensive defaults -- an older/partial file shouldn't crash reads.
    return {
      version: parsed.version ?? 1,
      projectMemory: Array.isArray(parsed.projectMemory) ? parsed.projectMemory : [],
      experience: Array.isArray(parsed.experience) ? parsed.experience : [],
    };
  } catch (err) {
    console.error(`[rune] warning: ${filePath} is corrupted or unreadable (${err.message}). Starting from empty memory.`);
    return emptyMemory();
  }
}

export function writeMemory(rootDir, memory) {
  const dir = path.join(rootDir, RUNE_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = memoryPath(rootDir);
  fs.writeFileSync(filePath, JSON.stringify(memory, null, 2));
  return filePath;
}

let idCounter = 0;
function nextMemoryId(prefix) {
  idCounter += 1;
  return `${prefix}_${idCounter}_${Date.now()}`;
}

/**
 * Adds a new project memory entry with status "proposed" -- never
 * auto-approved. A human (via `rune memory approve <id>`, built later)
 * must explicitly promote it before it's surfaced as trusted to an AI
 * client. This is the mechanical enforcement of "controlled evolution,"
 * not just a policy comment.
 */
export function addProjectMemory(rootDir, { rule, category, evidenceNote }) {
  if (!rule || typeof rule !== "string") {
    throw new Error("addProjectMemory requires a non-empty 'rule' string.");
  }

  const memory = readMemory(rootDir);
  const entry = {
    id: nextMemoryId("mem"),
    rule,
    category: category || "convention",
    confidence: evidenceNote ? 0.5 : 0.3, // starting confidence, deliberately modest
    evidence: evidenceNote ? [{ note: evidenceNote, timestamp: new Date().toISOString() }] : [],
    successCount: 0,
    failureCount: 0,
    lastVerified: new Date().toISOString(),
    status: "proposed",
  };

  memory.projectMemory.push(entry);
  writeMemory(rootDir, memory);
  return entry;
}

export function approveProjectMemory(rootDir, id) {
  const memory = readMemory(rootDir);
  const entry = memory.projectMemory.find((e) => e.id === id);
  if (!entry) throw new Error(`No project memory entry found with id "${id}".`);
  entry.status = "approved";
  writeMemory(rootDir, memory);
  return entry;
}

export function rejectProjectMemory(rootDir, id) {
  const memory = readMemory(rootDir);
  const entry = memory.projectMemory.find((e) => e.id === id);
  if (!entry) throw new Error(`No project memory entry found with id "${id}".`);
  entry.status = "rejected";
  writeMemory(rootDir, memory);
  return entry;
}

export function listProjectMemory(rootDir, { statusFilter } = {}) {
  const memory = readMemory(rootDir);
  if (!statusFilter) return memory.projectMemory;
  return memory.projectMemory.filter((e) => e.status === statusFilter);
}

/**
 * Experience Memory -- a log of what was tried and what happened. Distinct
 * from Project Memory: this is raw history, not a trusted rule. Nothing
 * here is surfaced to an AI client as "true" -- it's the evidence trail
 * that a future automatic-pattern-detection pass (deferred, not built yet)
 * would draw on to *propose* new Project Memory entries. Recording an
 * experience never modifies Project Memory by itself.
 */
export function addExperience(rootDir, { taskDescription, strategyUsed, outcome, evidenceSource, relatedMemoryIds }) {
  if (!taskDescription || typeof taskDescription !== "string") {
    throw new Error("addExperience requires a non-empty 'taskDescription' string.");
  }
  if (outcome !== "success" && outcome !== "failure") {
    throw new Error('addExperience requires outcome to be "success" or "failure".');
  }

  const memory = readMemory(rootDir);
  const entry = {
    id: nextMemoryId("exp"),
    taskDescription,
    strategyUsed: strategyUsed || null,
    outcome,
    evidenceSource: evidenceSource || null,
    timestamp: new Date().toISOString(),
    relatedProjectMemoryIds: Array.isArray(relatedMemoryIds) ? relatedMemoryIds : [],
  };

  memory.experience.push(entry);
  writeMemory(rootDir, memory);
  return entry;
}

export function listExperience(rootDir, { outcomeFilter } = {}) {
  const memory = readMemory(rootDir);
  if (!outcomeFilter) return memory.experience;
  return memory.experience.filter((e) => e.outcome === outcomeFilter);
}
