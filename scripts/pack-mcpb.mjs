// Usage: node scripts/pack-mcpb.mjs <darwin|linux|win32> <path-to-rune-binary> <out.mcpb>
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

const [platform, binary, out] = process.argv.slice(2);
if (!platform || !binary || !out) {
  console.error("usage: pack-mcpb.mjs <platform> <binary> <out.mcpb>");
  process.exit(1);
}
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const exe = platform === "win32" ? "rune.exe" : "rune";
const stage = fs.mkdtempSync(path.join(os.tmpdir(), "rune-mcpb-"));
fs.mkdirSync(path.join(stage, "server"));
fs.copyFileSync(binary, path.join(stage, "server", exe));
fs.chmodSync(path.join(stage, "server", exe), 0o755);

const manifest = {
  manifest_version: "0.4",
  name: "rune",
  display_name: "Rune",
  version: pkg.version,
  description: "Evidence-backed understanding of a codebase, with file:line citations, for AI clients.",
  author: { name: "Colour Foundation" },
  license: "MIT",
  repository: { type: "git", url: "https://github.com/thecolourfoundation/rune" },
  server: {
    type: "binary",
    entry_point: "server/" + exe,
    mcp_config: { command: "${__dirname}/server/" + exe, args: ["serve", "${user_config.project_dir}"] },
  },
  user_config: {
    project_dir: { type: "directory", title: "Project folder", description: "The project Rune should understand.", required: true },
  },
  compatibility: { platforms: [platform] },
};
fs.writeFileSync(path.join(stage, "manifest.json"), JSON.stringify(manifest, null, 2));

const q = (p) => '"' + p + '"';
execSync("npx -y @anthropic-ai/mcpb validate " + q(path.join(stage, "manifest.json")), { stdio: "inherit" });
execSync("npx -y @anthropic-ai/mcpb pack " + q(stage) + " " + q(path.resolve(out)), { stdio: "inherit" });
console.log("packed", path.resolve(out));
