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

const REQUIRE_CP = 'const { exec, execSync, spawn } = require("child_process");\n';

test("flags exec() with a template literal containing interpolation", () => {
  const findings = run(REQUIRE_CP + 'exec(`rm -rf ${userInput}`);\n');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].category, "dangerous_shell_exec");
  assert.equal(findings[0].severity, "high");
});

test("flags exec() with string concatenation", () => {
  const findings = run(REQUIRE_CP + 'exec("ls " + userInput);\n');
  assert.equal(findings.length, 1);
});

test("flags exec() with a bare identifier passed directly", () => {
  const findings = run(REQUIRE_CP + 'exec(userCommand);\n');
  assert.equal(findings.length, 1);
});

test("does NOT flag exec() with a plain string literal", () => {
  const findings = run(REQUIRE_CP + 'exec("ls -la");\n');
  assert.equal(findings.length, 0);
});

test("does NOT flag exec() with a template literal containing no interpolation", () => {
  const findings = run(REQUIRE_CP + 'exec(`ls -la`);\n');
  assert.equal(findings.length, 0);
});

test("flags execSync the same way as exec", () => {
  const findings = run(REQUIRE_CP + 'execSync(`rm ${target}`);\n');
  assert.equal(findings.length, 1);
  assert.match(findings[0].rule, /execSync/);
});

test("flags child_process.exec (member expression callee)", () => {
  const findings = run(
    'const child_process = require("child_process");\nchild_process.exec(`rm ${target}`);\n'
  );
  assert.equal(findings.length, 1);
});

test("flags spawn() with shell:true even for a static-looking command", () => {
  const findings = run(REQUIRE_CP + 'spawn("ls", [], { shell: true });\n');
  assert.equal(findings.length, 1);
});

test("does NOT flag spawn() with an argument array and no shell:true", () => {
  const findings = run(REQUIRE_CP + 'spawn("ls", ["-la", userDir]);\n');
  assert.equal(findings.length, 0);
});

test("does not crash on a file with a syntax error", () => {
  const findings = run("this is not valid javascript {{{\n");
  assert.equal(findings.length, 0);
});

test("fact ids from the shared generator use the shellexec prefix", () => {
  const findings = run(REQUIRE_CP + 'exec(`rm ${x}`);\n');
  assert.ok(findings[0].id.startsWith("shellexec_"));
});

test("does NOT flag RegExp.prototype.exec() calls (false-positive regression)", () => {
  const findings = run(
    'const pattern = /foo/g;\nlet m;\nwhile ((m = pattern.exec(someString))) {}\n'
  );
  assert.equal(findings.length, 0);
});

test("does NOT flag exec()/execSync() in a file with no child_process import at all", () => {
  const findings = run('exec(`rm -rf ${userInput}`);\n');
  assert.equal(findings.length, 0);
});

test("DOES flag exec() when child_process is imported via ESM import", () => {
  const findings = run('import { exec } from "node:child_process";\nexec(`rm ${x}`);\n');
  assert.equal(findings.length, 1);
});

test("DOES flag exec() when child_process is imported via node: prefix require", () => {
  const findings = run(
    'const { exec } = require("node:child_process");\nexec(`rm ${x}`);\n'
  );
  assert.equal(findings.length, 1);
});
