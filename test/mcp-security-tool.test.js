import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTools } from "../src/mcp/tools.js";

function fakeGraphReader(securityFindings) {
  return () => ({
    meta: {},
    facts: [],
    derived: [],
    securityFindings,
  });
}

test("rune_get_security_findings returns all findings with no filter", async () => {
  const findings = [
    { id: "a", category: "secret_exposure", severity: "high", confidence: "medium", file: "x.js", line: 1 },
    { id: "b", category: "dangerous_shell_exec", severity: "low", confidence: "low", file: "y.js", line: 2 },
  ];
  const tools = buildTools(fakeGraphReader(findings), "/fake/root");
  const tool = tools.find((t) => t.name === "rune_get_security_findings");
  const result = await tool.handler({});

  assert.equal(result.findings.length, 2);
  assert.equal(result.totalAllFindings, 2);
});

test("rune_get_security_findings filters by severity", async () => {
  const findings = [
    { id: "a", category: "secret_exposure", severity: "high", confidence: "medium", file: "x.js", line: 1 },
    { id: "b", category: "dangerous_shell_exec", severity: "low", confidence: "low", file: "y.js", line: 2 },
  ];
  const tools = buildTools(fakeGraphReader(findings), "/fake/root");
  const tool = tools.find((t) => t.name === "rune_get_security_findings");
  const result = await tool.handler({ severity: "high" });

  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].id, "a");
  assert.equal(result.totalMatchingFilter, 1);
  assert.equal(result.totalAllFindings, 2, "total should reflect all findings, not just the filtered subset");
});

test("rune_get_security_findings filters by category", async () => {
  const findings = [
    { id: "a", category: "secret_exposure", severity: "high", confidence: "medium", file: "x.js", line: 1 },
    { id: "b", category: "dangerous_shell_exec", severity: "low", confidence: "low", file: "y.js", line: 2 },
  ];
  const tools = buildTools(fakeGraphReader(findings), "/fake/root");
  const tool = tools.find((t) => t.name === "rune_get_security_findings");
  const result = await tool.handler({ category: "dangerous_shell_exec" });

  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].id, "b");
});

test("rune_get_security_findings summaryAllFindings reflects severity counts across ALL findings regardless of filter", async () => {
  const findings = [
    { id: "a", category: "secret_exposure", severity: "critical", confidence: "medium", file: "x.js", line: 1 },
    { id: "b", category: "secret_exposure", severity: "critical", confidence: "medium", file: "z.js", line: 5 },
    { id: "c", category: "dangerous_shell_exec", severity: "low", confidence: "low", file: "y.js", line: 2 },
  ];
  const tools = buildTools(fakeGraphReader(findings), "/fake/root");
  const tool = tools.find((t) => t.name === "rune_get_security_findings");
  const result = await tool.handler({ severity: "low" });

  assert.equal(result.summaryAllFindings.critical, 2);
  assert.equal(result.summaryAllFindings.low, 1);
});

test("rune_get_security_findings returns empty array (not an error) when there are no findings", async () => {
  const tools = buildTools(fakeGraphReader([]), "/fake/root");
  const tool = tools.find((t) => t.name === "rune_get_security_findings");
  const result = await tool.handler({});

  assert.deepEqual(result.findings, []);
  assert.equal(result.totalAllFindings, 0);
});

test("the tool is registered with a Zod inputSchema, not JSON Schema (SDK requirement)", () => {
  const tools = buildTools(fakeGraphReader([]), "/fake/root");
  const tool = tools.find((t) => t.name === "rune_get_security_findings");
  assert.ok(tool.inputSchema.severity, "severity should be a Zod schema object");
  assert.equal(typeof tool.inputSchema.severity.parse, "function", "confirms this is a real Zod type, not JSON Schema");
});
