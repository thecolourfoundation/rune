
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "rune.js");

function rpc(id, method, params) {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
}

async function waitFor(check, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("timed out waiting for server response");
}

test("rune serve writes only JSON-RPC to stdout and lists tools", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rune-mcp-"));
  fs.writeFileSync(path.join(dir, "index.js"), "const express = require('express');\nconst app = express();\napp.get('/x', (req, res) => res.send('ok'));\n");
  const child = spawn(process.execPath, [BIN, "serve", dir], { stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  try {
    child.stdin.write(rpc(1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } }));
    await waitFor(() => out.includes('"id":1'), 20000);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    child.stdin.write(rpc(2, "tools/list", {}));
    await waitFor(() => out.includes('"id":2'), 20000);
  } finally {
    child.kill();
  }
  const lines = out.split("\n").filter((l) => l.trim());
  for (const l of lines) {
    assert.doesNotThrow(() => JSON.parse(l), "non-JSON on stdout: " + l.slice(0, 80));
  }
  const list = JSON.parse(lines.find((l) => l.includes('"id":2')));
  assert.ok(list.result.tools.length > 0);
  console.log("MCP tools: " + list.result.tools.map((t) => t.name).join(", "));
});
