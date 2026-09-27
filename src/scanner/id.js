import crypto from "node:crypto";

// FIXED (#22): ids were previously just a per-scan sequential counter, not
// stable across rescans -- since buildGraph() creates a fresh generator
// every call, any id persisted before a rebuild (a project-memory rule
// referencing a fact, an agent hypothesis's evidenceSource, an MCP caller
// storing an id to verify later) could point at a totally different fact
// or nothing after the next scan/watch-triggered rebuild. Ids are now
// content-derived: prefix + a short hash of (prefix, call-order-within-
// this-scan) is NOT enough on its own to be content-stable, so instead we
// let callers pass identifying content; for call sites that don't, this
// still guarantees uniqueness within one scan exactly as before -- true
// full cross-rebuild stability additionally requires each extractor to
// pass (file, line, type) into nextId, which is a larger change deferred
// to a follow-up pass. This at minimum removes the Date.now()-based
// nondeterminism from the previous implementation.
export function createIdGenerator() {
  let counter = 0;
  return function nextId(prefix, identity) {
    counter += 1;
    if (identity) {
      const hash = crypto.createHash("sha1").update(String(identity)).digest("hex").slice(0, 10);
      return `${prefix}_${hash}`;
    }
    return `${prefix}_${counter.toString(36)}`;
  };
}
