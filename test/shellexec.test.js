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

test("flags exec() with a template literal containing interpolation", () => {
  const findings = run('exec(`rm -rf ${userInput}`);\n');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].category, "dangerous_shell_exec");
  assert.equal(findings[0].severity, "high");
  assert.equal(findings[0].line, 1);
});

test("flags exec() with string concatenation", () => {
  const findings = run('exec("ls " + userInput);\n');
  assert.equal(findings.length, 1);
});

test("flags exec() with a bare identifier passed directly", () => {
  const findings = run('exec(userCommand);\n');
  assert.equal(findings.length, 1);
});

test("does NOT flag exec() with a plain string literal", () => {
  const findings = run('exec("ls -la");\n');
  assert.equal(findings.length, 0);
});

test("does NOT flag exec() with a template literal containing no interpolation", () => {
  const findings = run('exec(`ls -la`);\n');
  assert.equal(findings.length, 0);
});

test("flags execSync the same way as exec", () => {
  const findings = run('execSync(`rm ${target}`);\n');
  assert.equal(findings.length, 1);
  assert.match(findings[0].rule, /execSync/);
});

test("flags child_process.exec (member expression callee)", () => {
  const findings = run('child_process.exec(`rm ${target}`);\n');
  assert.equal(findings.length, 1);
});

test("flags spawn() with shell:true even for a static-looking command", () => {
  const findings = run('spawn("ls", [], { shell: true });\n');
  assert.equal(findings.length, 1);
});

test("does NOT flag spawn() with an argument array and no shell:true", () => {
  const findings = run('spawn("ls", ["-la", userDir]);\n');
  assert.equal(findings.length, 0);
});

test("does not crash on a file with a syntax error", () => {
  const findings = run("this is not valid javascript {{{\n");
  assert.equal(findings.length, 0);
});

test("fact ids from the shared generator use the shellexec prefix", () => {
  const findings = run('exec(`rm ${x}`);\n');
  assert.ok(findings[0].id.startsWith("shellexec_"));
});
