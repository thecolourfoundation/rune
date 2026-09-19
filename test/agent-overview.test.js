
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runAgentLoop } from "../src/agent/loop.js";

test("overview does not rank test scripts above real code", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rune-overview-"));
  fs.mkdirSync(path.join(dir, "test"));
  fs.mkdirSync(path.join(dir, "install"));
  const many = Array.from({ length: 25 }, (_, i) => `check_${i}() { echo ${i}; }`).join("\n");
  fs.writeFileSync(path.join(dir, "test", "run.sh"), many + "\n");
  fs.writeFileSync(path.join(dir, "install", "setup.sh"), "setup_one() { echo one; }\nsetup_two() { echo two; }\nsudo pacman -S git\n");
  const report = runAgentLoop("give me 3 architectural insights", dir);
  const names = report.synthesis.insights.map((i) => i.insight);
  assert.ok(names.length > 0);
  assert.ok(!names.includes("Test coverage"), "got: " + names.join(", "));
});
