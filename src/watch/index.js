import fs from "node:fs";
import path from "node:path";
import { buildGraph, writeGraph } from "../graph/build.js";
import { verifyFacts } from "../graph/verify.js";
import { buildIgnoreMatcher, readIgnorePatterns } from "../scanner/walk.js";

const DEFAULT_IGNORES = new Set([
  "node_modules", ".git", ".rune", "dist", "build", ".next", "coverage", ".turbo", ".cache",
]);

// FIXED (#37): previously only skipped this hardcoded default set, never
// the user's .rune/config.json ignore list -- so `rune watch` kept
// fs.watch handlers on directories the user explicitly told Rune to
// ignore via rune init's own instructions, causing unnecessary rebuild
// churn on every edit inside them.
function listWatchableDirs(rootDir) {
  const isIgnored = buildIgnoreMatcher([...DEFAULT_IGNORES, ...readIgnorePatterns(rootDir)]);
  const dirs = [rootDir];

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const name = entry.name;
      if (name.startsWith(".")) continue;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        const full = path.join(dir, name);
        const relPath = path.relative(rootDir, full).split(path.sep).join("/");
        if (isIgnored(name, relPath)) continue;
        dirs.push(full);
        walk(full);
      }
    }
  }

  walk(rootDir);
  return dirs;
}

export function startWatch(rootDir, opts = {}) {
  const { debounceMs = 300, verifyIntervalMs = 30000, onRebuild } = opts;

  let watchers = [];
  let debounceTimer = null;
  let verifyTimer = null;
  let stopped = false;
  let lastGraph = null;

  function teardownWatchers() {
    for (const w of watchers) {
      try {
        w.close();
      } catch {}
    }
    watchers = [];
  }

  function rebuild(reason) {
    if (stopped) return;
    try {
      const graph = buildGraph(rootDir);
      writeGraph(rootDir, graph);
      lastGraph = graph;
      if (onRebuild) onRebuild({ ok: true, graph, reason });
    } catch (err) {
      if (onRebuild) onRebuild({ ok: false, error: err, reason });
    }
  }

  function setupWatchers() {
    if (stopped) return;
    const dirs = listWatchableDirs(rootDir);
    for (const dir of dirs) {
      try {
        const watcher = fs.watch(dir, { persistent: true }, (eventType, filename) => {
          scheduleRebuild(`${eventType}:${filename ?? "?"}`);
        });
        watchers.push(watcher);
      } catch {}
    }
  }

  function scheduleRebuild(reason) {
    if (stopped) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      rebuild(reason);
      teardownWatchers();
      setupWatchers();
    }, debounceMs);
  }

  function runHeartbeat() {
    if (stopped || !lastGraph) return;
    const report = verifyFacts(lastGraph.facts, rootDir);
    if (report.drifted.length > 0) rebuild("watcher-missed-change");
  }

  rebuild("initial");
  setupWatchers();
  if (verifyIntervalMs > 0) verifyTimer = setInterval(runHeartbeat, verifyIntervalMs);

  return {
    stop() {
      stopped = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      if (verifyTimer) clearInterval(verifyTimer);
      teardownWatchers();
    },
  };
}
