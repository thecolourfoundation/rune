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
  const refs = ctx.after.filter((f) => isRef(f, p.entity));
  if (refs.length) return V('contradicted', `${refs.length} reference(s) remain`, refs);
  return V('supported', 'no structural references remain (string/dynamic references are not tracked)');
}

function fileChanged(p, ctx) {
  return ctx.changedFiles?.has(p.file)
    ? V('supported', 'file appears in the diff')
    : V('contradicted', 'file not in the diff');
}

const EVAL = {
  fact_removed: factRemoved,
  import_removed: (p, c) => factRemoved({ type: 'import', entity: p.target, file: p.file }, c),
  import_added: importAdded,
  route_exists: routeExists,
  no_remaining_references: noRemainingRefs,
  file_changed: fileChanged,
};

export function evaluate(pred, ctx) {
  const fn = EVAL[pred.type];
  const r = fn ? fn(pred, ctx) : V('unverifiable', `no evaluator for predicate type "${pred.type}"`);
  return { claim: pred.claim ?? pred.type, predicate: pred, ...r };
}

export function evaluateAll(preds, ctx) {
  return preds.map((p) => evaluate(p, ctx));
}
