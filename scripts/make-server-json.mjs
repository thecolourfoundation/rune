// Usage: node scripts/make-server-json.mjs <version> <dir-with-mcpb-files>
// Writes ./server.json for the MCP Registry, listing each bundle with its SHA-256.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const [version, dir] = process.argv.slice(2);
if (!version || !dir) { console.error("usage: make-server-json.mjs <version> <dir>"); process.exit(1); }
const base = "https://github.com/thecolourfoundation/rune/releases/download/v" + version;
const packages = [];
for (const p of ["linux-x64", "darwin-arm64", "win32-x64"]) {
  const file = path.join(dir, "rune-mcp-" + p + ".mcpb");
  if (!fs.existsSync(file)) { console.error("skipping missing bundle:", p); continue; }
  const sha = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  packages.push({ registryType: "mcpb", identifier: base + "/rune-mcp-" + p + ".mcpb", fileSha256: sha, transport: { type: "stdio" } });
}
if (packages.length === 0) throw new Error("no .mcpb bundles found in " + dir);
const server = {
  $schema: "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  name: "io.github.thecolourfoundation/rune",
  description: "Evidence-backed codebase understanding with file:line citations, for AI clients over MCP.",
  version,
  repository: { url: "https://github.com/thecolourfoundation/rune", source: "github" },
  packages,
};
fs.writeFileSync("server.json", JSON.stringify(server, null, 2) + "\n");
console.log("wrote server.json with " + packages.length + " package(s)");
