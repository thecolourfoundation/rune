import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runAgentLoop } from "../src/agent/loop.js";

test("production code outranks test files when both match", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rune-rank-"));
  fs.mkdirSync(path.join(dir, "lib"));
  fs.mkdirSync(path.join(dir, "test"));
  fs.writeFileSync(path.join(dir, "lib", "app.js"), "const Router = require('router');\nmodule.exports = Router;\n");
  const many = Array.from({ length: 12 }, (_, i) => `const r${i} = require('router');`).join("\n");
  fs.writeFileSync(path.join(dir, "test", "app.test.js"), many + "\n");
  const report = runAgentLoop("how does routing work", dir);
  const insights = report.synthesis.insights;
  assert.ok(insights.length > 0);
  assert.notEqual(insights[0].insight, "Test coverage");
});
