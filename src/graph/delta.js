// Content-keyed fact delta. Never matches by id (ids are per-scan)
// or by line (lines shift on any edit above the fact).
export function factKey(f) {
  return [
    f.type,
    f.file,
    f.entity ?? f.name ?? f.target ?? f.callee ?? f.routePath ?? '',
    f.caller ?? '',
  ].join('|');
}

// Adds an occurrence index so duplicates (e.g. two identical calls
// in one file) are counted, not collapsed.
function keyed(facts) {
  const sorted = [...facts].sort(
    (x, y) => (x.file || '').localeCompare(y.file || '') || (x.line ?? 0) - (y.line ?? 0)
  );
  const seen = new Map();
  const out = new Map();
  for (const f of sorted) {
    const base = factKey(f);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.set(`${base}#${n}`, f);
  }
  return out;
}

export function computeDelta(beforeFacts, afterFacts) {
  const b = keyed(beforeFacts);
  const a = keyed(afterFacts);
  const added = [], removed = [];
  for (const [k, f] of a) if (!b.has(k)) added.push(f);
  for (const [k, f] of b) if (!a.has(k)) removed.push(f);
  return { added, removed };
}
