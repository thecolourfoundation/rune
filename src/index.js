/**
 * Programmatic entry point for using Rune as a library instead of the CLI —
 * e.g. building the understanding graph yourself and doing something custom
 * with it, rather than going through `rune scan` / `rune serve`.
 *
 * The CLI (bin/rune.js) is the primary supported interface in v0.1; this
 * export surface covers the pieces most likely to be useful standalone.
 */
export { buildGraph, writeGraph, readGraph, RUNE_DIR, GRAPH_FILENAME, CONFIG_FILENAME } from "./graph/build.js";
export { getVersion } from "./version.js";
