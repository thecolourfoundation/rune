import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractWorkflowFindings } from "../src/scanner/workflow.js";
import { createIdGenerator } from "../src/scanner/id.js";

function tmpWorkflowDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rune-workflow-test-"));
  fs.mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true });
  return dir;
}

function run(yaml, filename = "ci.yml") {
  const dir = tmpWorkflowDir();
  const filePath = path.join(dir, ".github", "workflows", filename);
  fs.writeFileSync(filePath, yaml);
  const nextId = createIdGenerator();
  return extractWorkflowFindings(filePath, yaml, dir, nextId);
}

test("flags permissions: write-all", () => {
  const findings = run(`name: CI\non: push\npermissions: write-all\njobs:\n  build:\n    runs-on: ubuntu-latest\n`);
  assert.ok(findings.some((f) => f.rule.includes("write-all")));
});

test("flags contents: write permission grant", () => {
  const findings = run(`name: CI\non: push\npermissions:\n  contents: write\njobs:\n  build:\n    runs-on: ubuntu-latest\n`);
  assert.ok(findings.some((f) => f.rule.includes("contents:write")));
});

test("flags pull_request_target trigger", () => {
  const findings = run(`name: CI\non:\n  pull_request_target:\njobs:\n  build:\n    runs-on: ubuntu-latest\n`);
  assert.ok(findings.some((f) => f.rule.includes("pull_request_target")));
});

test("flags the pwn-request shape: pull_request_target + head ref checkout", () => {
  const yaml = `name: CI\non:\n  pull_request_target:\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          ref: \${{ github.event.pull_request.head.sha }}\n`;
  const findings = run(yaml);
  assert.ok(findings.some((f) => f.severity === "critical"));
});

test("does NOT flag an ordinary, safe workflow", () => {
  const yaml = `name: CI\non: push\npermissions:\n  contents: read\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm test\n`;
  const findings = run(yaml);
  assert.equal(findings.length, 0);
});

test("does NOT scan files outside .github/workflows/", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rune-workflow-test-"));
  const filePath = path.join(dir, "docker-compose.yml");
  const yaml = "permissions: write-all\n";
  fs.writeFileSync(filePath, yaml);
  const nextId = createIdGenerator();
  const findings = extractWorkflowFindings(filePath, yaml, dir, nextId);
  assert.equal(findings.length, 0);
});

test("handles pull_request (not pull_request_target) without false-flagging the pwn-request rule", () => {
  const yaml = `name: CI\non:\n  pull_request:\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          ref: \${{ github.event.pull_request.head.sha }}\n`;
  const findings = run(yaml);
  assert.equal(findings.filter((f) => f.severity === "critical").length, 0);
});
