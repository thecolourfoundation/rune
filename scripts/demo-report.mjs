#!/usr/bin/env node
/**
 * Prints a demo-friendly report from an already-scanned project: the
 * architecture summary, every Express route found (with file/line/evidence),
 * and a source-code excerpt around the first route so the claim can be
 * checked against the real file live, on camera.
 *
 * Usage: node scripts/demo-report.mjs <path-to-scanned-repo>
 */
import fs from "node:fs";
import path from "node:path";

const targetDir = process.argv[2];
if (!targetDir) {
  console.error("Usage: node scripts/demo-report.mjs <path-to-repo>");
  process.exit(1);
}

const graphPath = path.join(targetDir, ".rune", "graph.json");
if (!fs.existsSync(graphPath)) {
  console.error(`No graph found at ${graphPath}. Run \`rune scan ${targetDir}\` first.`);
  process.exit(1);
}
const graph = JSON.parse(fs.readFileSync(graphPath, "utf8"));

function section(title) {
  console.log("\n" + "=".repeat(60));
  console.log(` ${title}`);
  console.log("=".repeat(60));
}

section("Architecture summary");
const summary = graph.derived.find((d) => d.type === "architecture_summary");
console.log(summary ? summary.description : "(no summary produced)");

const routes = graph.facts.filter((f) => f.type === "express_route");
section(`Express routes found (${routes.length})`);
if (routes.length === 0) {
  console.log("(none found in this project)");
} else {
  for (const r of routes) {
    console.log(`${r.method} ${r.routePath}  ->  ${r.file}:${r.line}`);
    console.log(`   ${r.evidence}`);
    console.log();
  }
}

if (routes.length > 0) {
  const first = routes[0];
  const filePath = path.join(targetDir, first.file);
  const lines = fs.readFileSync(filePath, "utf8").split("\n");
  const start = Math.max(0, first.line - 4);
  const end = Math.min(lines.length, first.line + 3);

  section(`Verify it yourself: ${first.file}, line ${first.line}`);
  for (let i = start; i < end; i++) {
    const marker = i === first.line - 1 ? ">>" : "  ";
    console.log(`${marker} ${String(i + 1).padStart(4)} | ${lines[i]}`);
  }
  console.log();
}
