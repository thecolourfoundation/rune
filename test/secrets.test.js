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

function runAt(relFilePath, content) {
  const dir = tmpDir();
  const filePath = path.join(dir, relFilePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  const nextId = createIdGenerator();
  return extractSecretFindings(filePath, content, dir, nextId);
}

// --- Production-context findings: full severity ---

test("detects an AWS access key id in production code at full severity", () => {
  const findings = runAt("src/config.js", `const awsKey = "AKIAIOSFODNN7EXAMPLE";\n`);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, "AWS Access Key ID");
  assert.equal(findings[0].severity, "high");
  assert.equal(findings[0].context, "production");
  assert.equal(findings[0].line, 1);
});

test("detects a Stripe live secret key in production code at full (critical) severity", () => {
  const dir_fake_key = "sk_live_" + "51H8xyzABCDEFGHIJKLMNOPQRSTUVWXYZ" + "12345";
  const findings = runAt("src/billing.js", `const stripeKey = "${dir_fake_key}";\n`);
  const stripeFindings = findings.filter((f) => f.rule === "Stripe live secret key");
  assert.equal(stripeFindings.length, 1);
  assert.equal(stripeFindings[0].severity, "critical");
  assert.equal(stripeFindings[0].context, "production");
});

test("redacts the matched secret value, never returns it in full", () => {
  const findings = runAt("src/config.js", `const awsKey = "AKIAIOSFODNN7EXAMPLE";\n`);
  assert.equal(findings.length, 1);
  assert.notEqual(findings[0].redactedMatch, "AKIAIOSFODNN7EXAMPLE");
  assert.match(findings[0].redactedMatch, /\*/);
});

test("does not flag known placeholder values as real secrets", () => {
  const findings = runAt("src/config.js", `const apiKey = "your-api-key-here";\n`);
  assert.equal(findings.length, 0);
});

test("does not flag ordinary code with no secret-shaped strings", () => {
  const findings = runAt("src/app.js", `export function greet(name) {\n  return "Hello, " + name;\n}\n`);
  assert.equal(findings.length, 0);
});

test("detects a private key block in production code at critical severity", () => {
  const findings = runAt(
    "src/id_rsa.js",
    `const key = \`-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----\`;\n`
  );
  const keyFindings = findings.filter((f) => f.rule === "Private key block");
  assert.equal(keyFindings.length, 1);
  assert.equal(keyFindings[0].severity, "critical");
});

test("fact ids from the shared generator use the secret prefix", () => {
  const findings = runAt("src/config.js", `const awsKey = "AKIAIOSFODNN7EXAMPLE";\n`);
  assert.ok(findings[0].id.startsWith("secret_"));
});

// --- Context-awareness: test/fixture/example files get downgraded, not silenced ---

test("REGRESSION: a secret-shaped string inside test/ is downgraded, not full severity", () => {
  const findings = runAt("test/secrets.test.js", `const awsKey = "AKIAIOSFODNN7EXAMPLE";\n`);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].context, "test_or_fixture");
  assert.equal(findings[0].severity, "low"); // "high" downgrades to "low"
  assert.equal(findings[0].confidence, "low");
});

test("REGRESSION: a private key in a fixtures/ directory is downgraded from critical to medium, not silenced", () => {
  const findings = runAt(
    "fixtures/sample-key.js",
    `const key = \`-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----\`;\n`
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].context, "test_or_fixture");
  assert.equal(findings[0].severity, "medium"); // "critical" downgrades to "medium", never fully silenced
});

test("REGRESSION: a file matching *.example.js is treated as test context", () => {
  const findings = runAt("config.example.js", `const awsKey = "AKIAIOSFODNN7EXAMPLE";\n`);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].context, "test_or_fixture");
});

test("REGRESSION: a file under __tests__/ is treated as test context", () => {
  const findings = runAt("__tests__/config.js", `const awsKey = "AKIAIOSFODNN7EXAMPLE";\n`);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].context, "test_or_fixture");
});

test("a file whose path merely contains 'test' as a substring of an unrelated word is NOT treated as test context", () => {
  // "testimonials" contains "test" as a substring but is not a test directory --
  // path-segment matching (not substring matching) should not flag this.
  const findings = runAt("src/testimonials/config.js", `const awsKey = "AKIAIOSFODNN7EXAMPLE";\n`);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].context, "production");
  assert.equal(findings[0].severity, "high");
});

test("downgraded severity never drops below 'low' -- a secret is never fully silenced by context", () => {
  const findings = runAt("test/fixtures/config.js", `const apiKey = "some-generic-key-shape-12345678901234";\n`);
  assert.equal(findings.length, 1);
  assert.notEqual(findings[0].severity, undefined);
  assert.ok(["low"].includes(findings[0].severity));
});
