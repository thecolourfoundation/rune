import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readMemory,
  writeMemory,
  addProjectMemory,
  approveProjectMemory,
  rejectProjectMemory,
  listProjectMemory,
  MEMORY_FILENAME,
} from "../src/memory/memory.js";

function tmpProjectDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rune-memory-test-"));
  fs.mkdirSync(path.join(dir, ".rune"), { recursive: true });
  return dir;
}

test("readMemory returns an empty structure when no memory file exists yet", () => {
  const dir = tmpProjectDir();
  const memory = readMemory(dir);
  assert.deepEqual(memory.projectMemory, []);
  assert.deepEqual(memory.experience, []);
});

test("writeMemory then readMemory round-trips correctly", () => {
  const dir = tmpProjectDir();
  const data = { version: 1, projectMemory: [{ id: "x" }], experience: [] };
  writeMemory(dir, data);
  const reread = readMemory(dir);
  assert.equal(reread.projectMemory.length, 1);
  assert.equal(reread.projectMemory[0].id, "x");
});

test("readMemory does not crash on a corrupted memory file, returns empty instead", () => {
  const dir = tmpProjectDir();
  fs.writeFileSync(path.join(dir, ".rune", MEMORY_FILENAME), "{ not valid json");
  const memory = readMemory(dir);
  assert.deepEqual(memory.projectMemory, []);
});

test("addProjectMemory creates an entry with status 'proposed', never auto-approved", () => {
  const dir = tmpProjectDir();
  const entry = addProjectMemory(dir, {
    rule: "After changing src/scanner/**, run npm test -- scanner",
    category: "command",
  });
  assert.equal(entry.status, "proposed");
  assert.ok(entry.id);
});

test("addProjectMemory persists to disk -- a fresh read sees it", () => {
  const dir = tmpProjectDir();
  addProjectMemory(dir, { rule: "Tests live in test/, not __tests__/", category: "convention" });
  const memory = readMemory(dir);
  assert.equal(memory.projectMemory.length, 1);
  assert.equal(memory.projectMemory[0].rule, "Tests live in test/, not __tests__/");
});

test("addProjectMemory throws on an empty rule instead of silently storing garbage", () => {
  const dir = tmpProjectDir();
  assert.throws(() => addProjectMemory(dir, { rule: "" }));
});

test("approveProjectMemory changes status from proposed to approved", () => {
  const dir = tmpProjectDir();
  const entry = addProjectMemory(dir, { rule: "some rule" });
  approveProjectMemory(dir, entry.id);
  const memory = readMemory(dir);
  assert.equal(memory.projectMemory[0].status, "approved");
});

test("rejectProjectMemory changes status from proposed to rejected", () => {
  const dir = tmpProjectDir();
  const entry = addProjectMemory(dir, { rule: "some rule" });
  rejectProjectMemory(dir, entry.id);
  const memory = readMemory(dir);
  assert.equal(memory.projectMemory[0].status, "rejected");
});

test("approveProjectMemory throws a clear error for an unknown id", () => {
  const dir = tmpProjectDir();
  assert.throws(() => approveProjectMemory(dir, "nonexistent_id"));
});

test("listProjectMemory with no filter returns all entries regardless of status", () => {
  const dir = tmpProjectDir();
  const a = addProjectMemory(dir, { rule: "rule A" });
  const b = addProjectMemory(dir, { rule: "rule B" });
  approveProjectMemory(dir, a.id);
  const all = listProjectMemory(dir);
  assert.equal(all.length, 2);
});

test("listProjectMemory filters by status", () => {
  const dir = tmpProjectDir();
  const a = addProjectMemory(dir, { rule: "rule A" });
  const b = addProjectMemory(dir, { rule: "rule B" });
  approveProjectMemory(dir, a.id);
  const approved = listProjectMemory(dir, { statusFilter: "approved" });
  const proposed = listProjectMemory(dir, { statusFilter: "proposed" });
  assert.equal(approved.length, 1);
  assert.equal(proposed.length, 1);
  assert.equal(approved[0].id, a.id);
});

test("a proposed entry starts with modest confidence, not full confidence", () => {
  const dir = tmpProjectDir();
  const entry = addProjectMemory(dir, { rule: "some rule" });
  assert.ok(entry.confidence < 0.6, "new unverified memory should not start highly confident");
});

test("memory.json is a separate file from graph.json -- scanning does not touch it", () => {
  const dir = tmpProjectDir();
  addProjectMemory(dir, { rule: "persistent rule" });
  fs.writeFileSync(path.join(dir, ".rune", "graph.json"), JSON.stringify({ facts: [] }));
  const memory = readMemory(dir);
  assert.equal(memory.projectMemory.length, 1);
});
