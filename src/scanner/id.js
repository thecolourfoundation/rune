/**
 * Creates a scoped id generator. Each buildGraph() run creates its own
 * generator (see graph/build.js), so ids reset per scan instead of growing
 * unbounded across repeated scans in a long-lived `rune serve` process, and
 * there's exactly one implementation of "prefix + counter" instead of three
 * near-identical copies scattered across the scanner modules.
 */
export function createIdGenerator() {
  let counter = 0;
  return function nextId(prefix) {
    counter += 1;
    return `${prefix}_${counter.toString(36)}`;
  };
}
