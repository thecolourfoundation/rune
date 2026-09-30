// Deterministic claim predicates over before/after fact lists.
// ctx = { before: Fact[], after: Fact[], changedFiles: Set, unparsedFiles: Set }
const ent = (f) => f.entity ?? f.name ?? f.target ?? f.callee ?? f.routePath;
const V = (verdict, reason, evidence = []) => ({ verdict, reason, evidence });

function isRef(f, e) {
  const t = f.target;
  return ent(f) === e || f.callee === e ||
    (typeof t === 'string' && (t === e || t.endsWith('/' + e)));
}

function factRemoved(p, ctx) {
  const m = (f) => (!p.type || f.type === p.type) && ent(f) === p.entity && (!p.file || f.file === p.file);
  if (p.file && ctx.unparsedFiles?.has(p.file)) return V('unverifiable', `${p.file} failed to fully parse`);
  const was = ctx.before.filter(m), is = ctx.after.filter(m);
  if (!was.length) return V('unverifiable', 'fact not present in the before-graph; cannot show it was removed');
  if (is.length) return V('contradicted', 'still present after the change', is);
  return V('supported', 'present before, absent after', was);
}

function importAdded(p, ctx) {
  const m = (f) => f.type === 'import' && f.target === p.target && (!p.file || f.file === p.file);
  if (p.file && ctx.unparsedFiles?.has(p.file)) return V('unverifiable', `${p.file} failed to fully parse`);
  const was = ctx.before.filter(m), is = ctx.after.filter(m);
  if (is.length && !was.length) return V('supported', 'absent before, present after', is);
  if (was.length) return V('contradicted', 'import already existed before the change', was);
  return V('contradicted', 'import not present after the change');
}

function routeExists(p, ctx) {
  const hit = ctx.after.filter((f) => f.routePath === p.routePath);
  if (hit.length) return V('supported', 'route found in graph', hit);
  return V('unverifiable', 'route not found; extractor may not cover this route style');
}

function noRemainingRefs(p, ctx) {
  if (!ctx.before.some((f) => isRef(f, p.entity)))
    return V('unverifiable', 'entity never appeared in the before-graph; cannot show references were removed');
  const refs = ctx.after.filter((f) => isRef(f, p.entity));
  if (refs.length) return V('contradicted', `${refs.length} reference(s) remain`, refs);
  const text = ctx.textSearch ? ctx.textSearch(p.entity) : [];
  if (text === null) return V('unverifiable', 'text search failed; cannot rule out string or dynamic references');
  if (text.length) {
    return V('unverifiable',
      `no structural references remain, but ${text.length} textual mention(s) exist in non-doc files (possible string or dynamic reference)`, text);
  }
  return V('supported', 'no structural or textual references remain outside docs');
}

function fileChanged(p, ctx) {
  return ctx.changedFiles?.has(p.file)
    ? V('supported', 'file appears in the diff')
    : V('contradicted', 'file not in the diff');
}

function testFixed(p, ctx) {
  if (!ctx.runTest) return V('unverifiable', 'test execution is not enabled (CLI: --run-tests; MCP server: set RUNE_ALLOW_TEST_EXEC=1)');
  const after = ctx.runTest(p.file, 'after');
  if (!after.ran) return V('unverifiable', `test could not be run: ${after.note ?? 'unknown'}`);
  if (!after.passed) return V('contradicted', 'test fails after the change');
  const before = ctx.runTest(p.file, 'before');
  if (!before.ran) return V('unverifiable', `test could not be run at the base: ${before.note ?? 'unknown'}`);
  if (before.passed) return V('unverifiable', 'test also passes at the base, so it does not demonstrate a fix');
  return V('supported', 'test fails at the base and passes after the change');
}

const EVAL = {
  fact_removed: factRemoved,
  import_removed: (p, c) => factRemoved({ type: 'import', entity: p.target, file: p.file }, c),
  import_added: importAdded,
  route_exists: routeExists,
  no_remaining_references: noRemainingRefs,
  file_changed: fileChanged,
  test_fixed: testFixed,
  unmapped: () => V('unverifiable', 'claim cannot be expressed as a structural check (behavior and intent are not verified)'),
};

export function evaluate(pred, ctx) {
  const fn = EVAL[pred.type];
  const r = fn ? fn(pred, ctx) : V('unverifiable', `no evaluator for predicate type "${pred.type}"`);
  return { claim: pred.claim ?? pred.type, predicate: pred, ...r };
}

export function evaluateAll(preds, ctx) {
  return preds.map((p) => evaluate(p, ctx));
}
