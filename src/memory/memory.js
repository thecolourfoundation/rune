import fs from "node:fs";
import path from "node:path";
import { RUNE_DIR } from "../graph/build.js";

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

export function addProjectMemory(rootDir, { rule, category, evidenceNote }) {
  if (!rule || typeof rule !== "string") {
    throw new Error("addProjectMemory requires a non-empty 'rule' string.");
  }

  const memory = readMemory(rootDir);
  const entry = {
    id: nextMemoryId("mem"),
    rule,
    category: category || "convention",
    confidence: evidenceNote ? 0.5 : 0.3,
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
