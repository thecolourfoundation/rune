import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractDependencyFindings } from "../src/scanner/depcheck.js";
import { createIdGenerator } from "../src/scanner/id.js";

function run(pkgObj) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rune-depcheck-test-"));
  const filePath = path.join(dir, "package.json");
  const content = JSON.stringify(pkgObj, null, 2);
  fs.writeFileSync(filePath, content);
  const nextId = createIdGenerator();
  return extractDependencyFindings(filePath, content, dir, nextId);
}

test("flags a 1-edit-distance typosquat of a well-known package", () => {
  const findings = run({ dependencies: { "expres": "^4.0.0" } });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].category, "dependency_risk");
  assert.match(findings[0].rule, /express/);
  assert.equal(findings[0].confidence, "low");
});

test("does NOT flag the real, correctly-spelled package name", () => {
  const findings = run({ dependencies: { "express": "^4.0.0" } });
  assert.equal(findings.length, 0);
});

test("does NOT flag an unrelated, normal dependency name", () => {
  const findings = run({ dependencies: { "my-internal-utils": "^1.0.0" } });
  assert.equal(findings.length, 0);
});

test("checks devDependencies as well as dependencies", () => {
  const findings = run({ devDependencies: { "chalkk": "^5.0.0" } });
  assert.equal(findings.length, 1);
  assert.match(findings[0].rule, /chalk/);
});

test("ignores files that are not package.json", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rune-depcheck-test-"));
  const filePath = path.join(dir, "config.json");
  const content = JSON.stringify({ dependencies: { expres: "1.0.0" } });
  fs.writeFileSync(filePath, content);
  const nextId = createIdGenerator();
  const findings = extractDependencyFindings(filePath, content, dir, nextId);
  assert.equal(findings.length, 0);
});

test("does not crash on malformed package.json", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rune-depcheck-test-"));
  const filePath = path.join(dir, "package.json");
  const content = "{ this is not valid json";
  fs.writeFileSync(filePath, content);
  const nextId = createIdGenerator();
  const findings = extractDependencyFindings(filePath, content, dir, nextId);
  assert.equal(findings.length, 0);
});

test("severity is capped at medium, never critical, given static-only confidence", () => {
  const findings = run({ dependencies: { "reeact": "^18.0.0" } });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "medium");
});
