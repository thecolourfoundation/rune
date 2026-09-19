import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseIntent } from "../src/agent/intent.js";
import { buildGraph } from "../src/graph/build.js";

test("parseIntent extracts insight counts (digit, word, exactly)", () => {
  assert.equal(parseIntent("give me 3 architectural insights").outputConstraints.exactCount, 3);
  assert.equal(parseIntent("top five insights").outputConstraints.exactCount, 5);
  assert.equal(parseIntent("give me exactly 2 insights").outputConstraints.exactCount, 2);
  assert.equal(parseIntent("why does memory fail to load").outputConstraints.exactCount, undefined);
});

test("TOML table headers get real line numbers and evidence", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rune-toml-test-"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "toml-fixture", version: "1.0.0" }));
  fs.writeFileSync(
    path.join(dir, "pyproject.toml"),
    '[build-system]\nrequires = ["setuptools>=68"]\nbuild-backend = "setuptools.build_meta"\n\n[project]\nname = "fixture"\nversion = "0.1.0"\n\n[project.scripts]\nrune = "rune.cli:main"\n\n[tool.setuptools.packages.find]\nwhere = ["src"]\n'
  );
  const facts = buildGraph(dir).facts.filter((f) => f.type === "config_key" && f.file.endsWith("pyproject.toml"));
  assert.ok(facts.length > 0, "expected config_key facts from pyproject.toml");
  for (const f of facts) {
    assert.ok(Number.isInteger(f.line) && f.line > 0, `${f.id} has no line`);
    assert.ok(f.evidence && f.evidence.length > 0, `${f.id} has no evidence`);
  }
});
