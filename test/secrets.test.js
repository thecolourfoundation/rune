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

test("detects an AWS access key id in production code at full severity, medium confidence", () => {
  const findings = runAt("src/config.js", `const awsKey = "AKIAIOSFODNN7EXAMPLE";\n`);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "high");
  assert.equal(findings[0].confidence, "medium");
  assert.equal(findings[0].context, "production");
});

test("detects a Stripe live secret key in production code at critical severity", () => {
  const fakeKey = "sk_live_" + "51H8xyzABCDEFGHIJKLMNOPQRSTUVWXYZ" + "12345";
  const findings = runAt("src/billing.js", `const stripeKey = "${fakeKey}";\n`);
  const stripeFindings = findings.filter((f) => f.rule === "Stripe live secret key");
  assert.equal(stripeFindings.length, 1);
  assert.equal(stripeFindings[0].severity, "critical");
});

test("redacts the matched secret value, never returns it in full", () => {
  const findings = runAt("src/config.js", `const awsKey = "AKIAIOSFODNN7EXAMPLE";\n`);
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

// --- Test/fixture context ---

test("a secret-shaped string inside test/ is downgraded, not full severity", () => {
  const findings = runAt("test/secrets.test.js", `const awsKey = "AKIAIOSFODNN7EXAMPLE";\n`);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].context, "test_or_fixture");
  assert.equal(findings[0].severity, "low");
});

test("a file whose path merely contains 'test' as a substring of an unrelated word is NOT treated as test context", () => {
  const findings = runAt("src/testimonials/config.js", `const awsKey = "AKIAIOSFODNN7EXAMPLE";\n`);
  assert.equal(findings[0].context, "production");
});

// --- Pattern-definition context (NEW in v3) ---

test("REGRESSION: a private-key marker inside a regex literal is classified as pattern_definition, severity low", () => {
  const findings = runAt(
    "src/redaction/patterns.ts",
    `export const PRIVATE_KEY_PATTERN = /-----BEGIN OPENSSH PRIVATE KEY-----/g;\n`
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].context, "pattern_definition_or_docs");
  assert.equal(findings[0].severity, "low");
  assert.equal(findings[0].confidence, "low");
});

test("REGRESSION: a file under a redaction/ or patterns/ directory is treated as pattern-definition context", () => {
  const findings = runAt(
    "packages/mcp-browser/src/redaction/patterns.ts",
    `const key = "AKIAIOSFODNN7EXAMPLE";\n`
  );
  assert.equal(findings[0].context, "pattern_definition_or_docs");
});

test("REGRESSION: documentation prose describing a PEM key format is downgraded, not flagged at full severity", () => {
  const findings = runAt(
    "docs/auth.md",
    `The Private Key field must contain a PEM private key beginning with -----BEGIN RSA PRIVATE KEY----- for this to work.\n`
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "low");
});

test("a real private key NOT in a pattern/redaction/docs path and NOT inside a regex literal stays critical", () => {
  const findings = runAt(
    "src/config/secrets.js",
    `module.exports.key = "-----BEGIN RSA PRIVATE KEY-----\\nMIIEow==\\n-----END RSA PRIVATE KEY-----";\n`
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].context, "production");
  assert.equal(findings[0].severity, "critical");
});

test("downgraded severity never silences a finding entirely -- it always still returns an entry", () => {
  const findings = runAt(
    "src/redaction/patterns.ts",
    `// Example match for testing: AKIAIOSFODNN7EXAMPLE\n`
  );
  assert.equal(findings.length, 1);
  assert.notEqual(findings[0].severity, undefined);
});
