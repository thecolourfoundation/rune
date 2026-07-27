#!/usr/bin/env node
/**
 * Spawns `rune serve` as a real child process and drives it through the
 * actual MCP JSON-RPC handshake over stdio: initialize -> initialized ->
 * tools/list -> tools/call (twice). This is the one thing that can't be
 * verified by the unit test suite alone, since it depends on the real
 * @modelcontextprotocol/sdk + zod packages actually being installed and
 * behaving as documented.
 *
 * Usage:
 *   node scripts/verify-mcp-server.mjs [project-dir]
 *
 * Exits 0 and prints "ALL CHECKS PASSED" if the server completes the full
 * sequence correctly. Exits 1 on any error, unexpected response shape, or
 * a 15s timeout (e.g. the server hung or crashed silently).
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(
  process.argv[2] || path.join(__dirname, "..", "test", "fixtures", "sample-express")
);
const binPath = path.join(__dirname, "..", "bin", "rune.js");
const TIMEOUT_MS = 15000;

console.log(`[verify] spawning: node ${binPath} serve ${projectDir}`);
const child = spawn("node", [binPath, "serve", projectDir], { stdio: ["pipe", "pipe", "pipe"] });

function send(obj) {
  child.stdin.write(JSON.stringify(obj) + "\n");
}

let buffer = "";
child.stderr.on("data", (d) => process.stderr.write(`[server stderr] ${d}`));
child.on("error", (err) => fail(`failed to spawn server process: ${err.message}`));
child.on("exit", (code, signal) => {
  if (!finished) fail(`server process exited early (code=${code}, signal=${signal}) before checks completed`);
});

let finished = false;
function fail(message) {
  if (finished) return;
  finished = true;
  console.error(`\n[verify] FAILED: ${message}`);
  child.kill();
  process.exit(1);
}
function pass() {
  finished = true;
  console.log("\n[verify] ALL CHECKS PASSED — MCP server responds correctly over stdio.");
  child.kill();
  process.exit(0);
}

child.stdout.on("data", (d) => {
  buffer += d.toString();
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      console.log(`[verify] (ignoring non-JSON stdout line: ${line})`);
      continue;
    }
    handleMessage(msg);
  }
});

function handleMessage(msg) {
  console.log(`\n[verify] <-- ${JSON.stringify(msg).slice(0, 500)}`);

  if (msg.error) {
    fail(`server returned a JSON-RPC error: ${JSON.stringify(msg.error)}`);
    return;
  }

  switch (msg.id) {
    case 1: // initialize response
      if (!msg.result?.serverInfo) return fail("initialize response missing serverInfo");
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      console.log("[verify] --> notifications/initialized");
      send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
      console.log("[verify] --> tools/list");
      break;

    case 2: { // tools/list response
      const tools = msg.result?.tools || [];
      const names = tools.map((t) => t.name);
      console.log(`[verify] server exposes ${tools.length} tool(s): ${names.join(", ")}`);
      const expected = ["rune_get_overview", "rune_search", "rune_explain", "rune_rescan"];
      const missing = expected.filter((n) => !names.includes(n));
      if (missing.length > 0) return fail(`expected tools missing from tools/list: ${missing.join(", ")}`);
      send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "rune_get_overview", arguments: {} } });
      console.log("[verify] --> tools/call rune_get_overview");
      break;
    }

    case 3: { // rune_get_overview result
      if (msg.result?.isError) return fail(`rune_get_overview returned isError: ${JSON.stringify(msg.result)}`);
      if (!msg.result?.content?.[0]?.text) return fail("rune_get_overview response missing content");
      console.log("[verify] rune_get_overview OK");
      send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "rune_search", arguments: { query: "UserCard" } } });
      console.log("[verify] --> tools/call rune_search { query: 'UserCard' }");
      break;
    }

    case 4: { // rune_search result
      if (msg.result?.isError) return fail(`rune_search returned isError: ${JSON.stringify(msg.result)}`);
      console.log("[verify] rune_search OK");
      // Also confirm a genuinely invalid call is rejected gracefully (Zod validation),
      // rather than crashing the server.
      send({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "rune_search", arguments: {} } });
      console.log("[verify] --> tools/call rune_search with missing required 'query' (expecting a clean rejection)");
      break;
    }

    case 5: { // rune_search with missing required arg
      const rejectedCleanly = msg.result?.isError === true || Boolean(msg.error);
      if (!rejectedCleanly) return fail("expected rune_search with a missing required argument to be rejected, but it wasn't");
      console.log("[verify] invalid input correctly rejected without crashing the server");
      pass();
      break;
    }
  }
}

send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "rune-verify-script", version: "1.0.0" },
  },
});
console.log("[verify] --> initialize");

setTimeout(() => fail(`did not complete the verification sequence within ${TIMEOUT_MS}ms`), TIMEOUT_MS);
