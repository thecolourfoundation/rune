import fs from "node:fs";
import path from "node:path";
import { buildGraph, writeGraph } from "../graph/build.js";
import { verifyFacts } from "../graph/verify.js";

const DEFAULT_IGNORES = new Set([
  "node_modules",
  ".git",
  ".rune",
  "dist",
  "build",
  ".next",
  "coverage",
  ".turbo",
  ".cache",
]);

/**
 * Walks the directory tree to find every directory worth watching, applying
 * the same dotfile/ignore/symlink rules as the main scanner so watch mode
 * doesn't sit there watching node_modules or .git for changes.
 */
function listWatchableDirs(rootDir) {
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
      if (DEFAULT_IGNORES.has(name)) continue;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        const full = path.join(dir, name);
        dirs.push(full);
        walk(full);
      }
    }
  }

  walk(rootDir);
  return dirs;
}

/**
 * Starts continuous watch mode: rebuilds the understanding graph whenever
 * source files change, instead of requiring a manual `rune scan` after
 * every edit. Rapid successive changes (e.g. an editor's autosave, or a
 * multi-file find-and-replace) are coalesced via debouncing into a single
 * rebuild rather than one per file event.
 *
 * Since directory structure itself can change (new folders, deleted ones),
 * watchers are torn down and re-established after every rebuild rather than
 * trying to incrementally track added/removed directories -- simpler and
 * still correct, at the cost of a brief re-registration window bounded by
 * the debounce interval.
 *
 * A second, independent timer runs a periodic drift check (via
 * graph/verify.js) against the *last-built* graph, entirely apart from the
 * fs.watch event path. Full rebuilds always produce a fresh, accurate graph
 * -- the graph itself never goes stale between rebuilds. What can go wrong
 * instead is the watcher silently missing filesystem events (a known
 * failure mode of fs.watch on Docker volumes, network filesystems, and
 * inotify-limited Linux hosts with large repos), which would leave the
 * graph looking fine while quietly not reflecting recent edits. The
 * heartbeat re-checks a handful of already-scanned facts against disk on a
 * fixed cadence; if any have drifted despite no rebuild having fired, that
 * is direct evidence the watcher missed something, and it forces a
 * catch-up rebuild automatically instead of leaving the graph wrong until
 * someone notices.
 *
 * @param {string} rootDir
 * @param {{ debounceMs?: number, verifyIntervalMs?: number, onRebuild?: (result: object) => void }} opts
 * @returns {{ stop: () => void }}
 */
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
      } catch {
        // already closed
      }
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
      } catch {
        // Directory may have been removed between listing and watching; skip it.
      }
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

  // Independent heartbeat: checks whether the last-built graph still
  // matches disk, entirely apart from whatever fs.watch has (or hasn't)
  // reported. A positive finding here means the watcher missed real
  // changes, not that the graph is stale by design -- so it triggers an
  // immediate catch-up rebuild rather than just logging a warning.
  function runHeartbeat() {
    if (stopped || !lastGraph) return;
    const report = verifyFacts(lastGraph.facts, rootDir);
    if (report.drifted.length > 0) {
      rebuild("watcher-missed-change");
    }
  }

  // Scan immediately so the graph is current the moment watch mode starts,
  // not just after the first detected change.
  rebuild("initial");
  setupWatchers();
  if (verifyIntervalMs > 0) {
    verifyTimer = setInterval(runHeartbeat, verifyIntervalMs);
  }

  return {
    stop() {
      stopped = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      if (verifyTimer) clearInterval(verifyTimer);
      teardownWatchers();
    },
  };
}
