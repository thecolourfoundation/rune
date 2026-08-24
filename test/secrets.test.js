import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractSecretFindings } from "../src/scanner/secrets.js";
import { createIdGenerator } from "../src/scanner/id.js";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "rune-secrets-test-"));
}

test("detects an AWS access key id with file/line evidence", () => {
  const dir = tmpDir();
  const filePath = path.join(dir, "config.js");
  fs.writeFileSync(filePath, `const awsKey = "AKIAIOSFODNN7EXAMPLE";\n`);

  const nextId = createIdGenerator();
  const findings = extractSecretFindings(filePath, fs.readFileSync(filePath, "utf8"), dir, nextId);

  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, "AWS Access Key ID");
  assert.equal(findings[0].severity, "high");
  assert.equal(findings[0].line, 1);
  assert.match(findings[0].evidence, /awsKey/);
});

test("detects a Stripe live secret key", () => {
  const dir = tmpDir();
  const filePath = path.join(dir, "billing.js");
  const fakeKey = "sk_live_" + "51H8xyzABCDEFGHIJKLMNOPQRSTUVWXYZ" + "12345";
  fs.writeFileSync(filePath, `const stripeKey = "${fakeKey}";\n`);

  const nextId = createIdGenerator();
  const findings = extractSecretFindings(filePath, fs.readFileSync(filePath, "utf8"), dir, nextId);

  const stripeFindings = findings.filter((f) => f.rule === "Stripe live secret key");
  assert.equal(stripeFindings.length, 1);
  assert.equal(stripeFindings[0].severity, "critical");
});

test("redacts the matched secret value, never returns it in full", () => {
  const dir = tmpDir();
  const filePath = path.join(dir, "config.js");
  fs.writeFileSync(filePath, `const awsKey = "AKIAIOSFODNN7EXAMPLE";\n`);

  const nextId = createIdGenerator();
  const findings = extractSecretFindings(filePath, fs.readFileSync(filePath, "utf8"), dir, nextId);

  assert.equal(findings.length, 1);
  assert.notEqual(findings[0].redactedMatch, "AKIAIOSFODNN7EXAMPLE");
  assert.match(findings[0].redactedMatch, /\*/);
});

test("does not flag known placeholder values as real secrets", () => {
  const dir = tmpDir();
  const filePath = path.join(dir, "config.example.js");
  fs.writeFileSync(filePath, `const apiKey = "your-api-key-here";\n`);

  const nextId = createIdGenerator();
  const findings = extractSecretFindings(filePath, fs.readFileSync(filePath, "utf8"), dir, nextId);

  assert.equal(findings.length, 0);
});

test("does not flag ordinary code with no secret-shaped strings", () => {
  const dir = tmpDir();
  const filePath = path.join(dir, "app.js");
  fs.writeFileSync(
    filePath,
    `export function greet(name) {\n  return "Hello, " + name;\n}\n`
  );

  const nextId = createIdGenerator();
  const findings = extractSecretFindings(filePath, fs.readFileSync(filePath, "utf8"), dir, nextId);

  assert.equal(findings.length, 0);
});

test("detects a private key block", () => {
  const dir = tmpDir();
  const filePath = path.join(dir, "id_rsa.js");
  fs.writeFileSync(
    filePath,
    `const key = \`-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----\`;\n`
  );

  const nextId = createIdGenerator();
  const findings = extractSecretFindings(filePath, fs.readFileSync(filePath, "utf8"), dir, nextId);

  const keyFindings = findings.filter((f) => f.rule === "Private key block");
  assert.equal(keyFindings.length, 1);
  assert.equal(keyFindings[0].severity, "critical");
});

test("fact ids from the shared generator do not collide with other extractors", () => {
  const dir = tmpDir();
  const filePath = path.join(dir, "config.js");
  fs.writeFileSync(filePath, `const awsKey = "AKIAIOSFODNN7EXAMPLE";\n`);

  const nextId = createIdGenerator();
  const findings = extractSecretFindings(filePath, fs.readFileSync(filePath, "utf8"), dir, nextId);

  assert.ok(findings[0].id.startsWith("secret_"));
});
