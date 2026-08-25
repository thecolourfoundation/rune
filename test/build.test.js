import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildGraph } from "../src/graph/build.js";

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "rune-dedup-test-"));
}

test("REGRESSION: a single real secret is not reported twice even if multiple detector code paths could match it", () => {
  const dir = tmpProject();
  fs.writeFileSync(path.join(dir, "config.js"), `const awsKey = "AKIAIOSFODNN7EXAMPLE";\n`);

  const graph = buildGraph(dir);
  const awsFindings = graph.securityFindings.filter((f) => f.rule === "AWS Access Key ID");
  assert.equal(awsFindings.length, 1);
});

test("two distinct secrets in the same file are both kept -- dedup is per-location, not per-file", () => {
  const dir = tmpProject();
  fs.writeFileSync(
    path.join(dir, "config.js"),
    `const awsKey = "AKIAIOSFODNN7EXAMPLE";\nconst ghToken = "ghp_${"a".repeat(36)}";\n`
  );

  const graph = buildGraph(dir);
  assert.ok(graph.securityFindings.length >= 2);
});

test("the same rule at the same file and line is deduplicated across repeated scans of the same content", () => {
  const dir = tmpProject();
  const filePath = path.join(dir, "config.js");
  fs.writeFileSync(filePath, `const awsKey = "AKIAIOSFODNN7EXAMPLE";\n`);

  const graph1 = buildGraph(dir);
  const graph2 = buildGraph(dir);

  const count1 = graph1.securityFindings.filter((f) => f.file === "config.js" && f.line === 1).length;
  const count2 = graph2.securityFindings.filter((f) => f.file === "config.js" && f.line === 1).length;

  assert.equal(count1, 1);
  assert.equal(count2, 1);
});
