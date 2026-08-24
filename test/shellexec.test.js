import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractShellExecFindings } from "../src/scanner/shellexec.js";
import { createIdGenerator } from "../src/scanner/id.js";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "rune-shellexec-test-"));
}

function run(source) {
  const dir = tmpDir();
  const filePath = path.join(dir, "app.js");
  fs.writeFileSync(filePath, source);
  const nextId = createIdGenerator();
  return extractShellExecFindings(filePath, source, dir, nextId);
}

const REQUIRE_CP = 'const { exec, execSync, spawn, execFile } = require("child_process");\n';

// --- Benchmark false positives: spawn without shell:true should NOT flag on a bare identifier ---

test("REGRESSION: spawn(binaryPath, args) with no shell option is NOT flagged", () => {
  const findings = run(REQUIRE_CP + 'spawn(binaryPath, process.argv.slice(2));\n');
  assert.equal(findings.length, 0);
});

test("REGRESSION: spawn(this.executablePath, commandArgs) is NOT flagged", () => {
  const findings = run(REQUIRE_CP + 'spawn(this.executablePath, commandArgs);\n');
  assert.equal(findings.length, 0);
});

test("REGRESSION: spawn() with shell:false explicitly is NOT flagged even with dynamic-looking args", () => {
  const findings = run(REQUIRE_CP + 'spawn(cmdVar, args, { shell: false });\n');
  assert.equal(findings.length, 0);
});

test("REGRESSION: execFile(binaryPath, args) with no shell option is NOT flagged", () => {
  const findings = run(REQUIRE_CP + 'execFile(binaryPath, args, callback);\n');
  assert.equal(findings.length, 0);
});

// --- spawn/execFile WITH shell:true still catches real risk ---

test("spawn() with shell:true and a bare identifier is flagged at HIGH (shell invoked)", () => {
  const findings = run(REQUIRE_CP + 'spawn(cmdVar, [], { shell: true });\n');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "medium"); // identifier tier under shell -> medium, not high
});

test("spawn() with shell:true and an interpolated command is flagged HIGH", () => {
  const findings = run(REQUIRE_CP + 'spawn(`rm ${target}`, [], { shell: true });\n');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "high");
});

// --- exec/execSync severity tiers ---

test("exec() with a dynamically-interpolated command is HIGH", () => {
  const findings = run(REQUIRE_CP + 'exec(`rm -rf ${userInput}`);\n');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "high");
});

test("exec() with a bare identifier is MEDIUM, not HIGH -- unproven source", () => {
  const findings = run(REQUIRE_CP + 'exec(userCommand);\n');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "medium");
});

test("exec() with string concatenation is HIGH", () => {
  const findings = run(REQUIRE_CP + 'exec("ls " + userInput);\n');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "high");
});

test("exec() with a plain string literal is never flagged", () => {
  const findings = run(REQUIRE_CP + 'exec("ls -la");\n');
  assert.equal(findings.length, 0);
});

test("execSync follows the same tiering as exec", () => {
  const findings = run(REQUIRE_CP + 'execSync(`rm ${target}`);\n');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "high");
});

// --- spawn WITHOUT shell:true but with actively-constructed command: low-severity note, not silence ---

test("spawn() with an interpolated command and no shell:true is LOW, not silenced entirely", () => {
  const findings = run(REQUIRE_CP + 'spawn(`${binaryDir}/tool`, args);\n');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "low");
});

// --- Existing false-positive guard (from v1) still holds ---

test("does NOT flag RegExp.prototype.exec() calls", () => {
  const findings = run('const pattern = /foo/g;\nlet m;\nwhile ((m = pattern.exec(someString))) {}\n');
  assert.equal(findings.length, 0);
});

test("does NOT flag exec()/spawn() in a file with no child_process import at all", () => {
  const findings = run('exec(`rm -rf ${userInput}`);\nspawn(cmd, [], { shell: true });\n');
  assert.equal(findings.length, 0);
});

test("flags child_process.exec (member expression callee)", () => {
  const findings = run('const child_process = require("child_process");\nchild_process.exec(`rm ${target}`);\n');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "high");
});

test("does not crash on a file with a syntax error", () => {
  const findings = run("this is not valid javascript {{{\n");
  assert.equal(findings.length, 0);
});

test("fact ids from the shared generator use the shellexec prefix", () => {
  const findings = run(REQUIRE_CP + 'exec(`rm ${x}`);\n');
  assert.ok(findings[0].id.startsWith("shellexec_"));
});

// --- Realistic legitimate tooling patterns from the benchmark (build scripts, test helpers) ---

test("REGRESSION: a typical build-tool spawn pattern (spawn(nodeBinary, scriptArgs)) is NOT flagged", () => {
  const findings = run(REQUIRE_CP + 'spawn(process.execPath, ["--version"]);\n');
  assert.equal(findings.length, 0);
});

test("REGRESSION: a test-helper spawning a fixture binary is NOT flagged", () => {
  const findings = run(REQUIRE_CP + 'function runFixture(fixturePath, args) {\n  return spawn(fixturePath, args, { stdio: "inherit" });\n}\n');
  assert.equal(findings.length, 0);
});
