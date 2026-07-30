import fs from "node:fs";
import path from "node:path";
import { buildGraph, writeGraph } from "../graph/build.js";

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
 * @param {string} rootDir
 * @param {{ debounceMs?: number, onRebuild?: (result: object) => void }} opts
 * @returns {{ stop: () => void }}
 */
export function startWatch(rootDir, opts = {}) {
  const { debounceMs = 300, onRebuild } = opts;

  let watchers = [];
  let debounceTimer = null;
  let stopped = false;

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

  // Scan immediately so the graph is current the moment watch mode starts,
  // not just after the first detected change.
  rebuild("initial");
  setupWatchers();

  return {
    stop() {
      stopped = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      teardownWatchers();
    },
  };
}
