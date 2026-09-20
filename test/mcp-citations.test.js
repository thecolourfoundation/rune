
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "rune.js");

test("rune_agent over MCP returns resolved citations (file, line, snippet)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rune-cite-"));
  fs.mkdirSync(path.join(dir, "lib"));
  fs.writeFileSync(path.join(dir, "lib", "app.js"), "const Router = require('router');\nmodule.exports = Router;\n");
  const child = spawn(process.execPath, [BIN, "serve", dir], { stdio: ["pipe", "pipe", "ignore"] });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  const send = (o) => child.stdin.write(JSON.stringify(o) + "\n");
  const find = (id) => out.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((m) => m && m.id === id);
  const wait = async (id, ms = 20000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { const m = find(id); if (m) return m; await new Promise((r) => setTimeout(r, 50)); }
    throw new Error("timed out waiting for response " + id);
  };
  try {
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } } });
    await wait(1);
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "rune_agent", arguments: { objective: "how does routing work" } } });
    const res = await wait(2);
    const report = JSON.parse(res.result.content.map((c) => c.text || "").join(""));
    const insights = report.synthesis.insights;
    assert.ok(insights.length > 0, "no insights returned");
    for (const i of insights) {
      assert.ok(Array.isArray(i.evidence) && i.evidence.length > 0, "insight has no resolved evidence");
      for (const e of i.evidence) {
        assert.equal(typeof e.file, "string");
        assert.equal(typeof e.line, "number");
      }
    }
    console.log("CITATION: " + JSON.stringify(insights[0].evidence[0]));
  } finally {
    child.kill();
  }
});
