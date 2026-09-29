import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../src/verify/predicates.js';

const imp = (file, target) => ({ type: 'import', file, target, line: 1 });
const call = (file, caller, callee) => ({ type: 'function_call', file, caller, callee, line: 1 });
const ctx = (before, after, extra = {}) =>
  ({ before, after, changedFiles: new Set(), unparsedFiles: new Set(), ...extra });

test('true claim: import removed', () => {
  const r = evaluate({ type: 'import_removed', target: 'lodash', file: 'a.js' },
    ctx([imp('a.js', 'lodash')], []));
  assert.equal(r.verdict, 'supported');
});

test('false claim: says removed but a reference remains', () => {
  const r = evaluate({ type: 'no_remaining_references', entity: 'legacyFn' },
    ctx([call('a.js', 'f', 'legacyFn')], [call('b.js', 'g', 'legacyFn')]));
  assert.equal(r.verdict, 'contradicted');
  assert.equal(r.evidence[0].file, 'b.js');
});

test('claim about something never in the before-graph is unverifiable', () => {
  const r = evaluate({ type: 'import_removed', target: 'ghost', file: 'a.js' }, ctx([], []));
  assert.equal(r.verdict, 'unverifiable');
});

test('unparsed file downgrades to unverifiable, never a pass', () => {
  const r = evaluate({ type: 'import_removed', target: 'x', file: 'a.js' },
    ctx([imp('a.js', 'x')], [], { unparsedFiles: new Set(['a.js']) }));
  assert.equal(r.verdict, 'unverifiable');
});

test('unknown predicate type is unverifiable', () => {
  assert.equal(evaluate({ type: 'made_it_faster' }, ctx([], [])).verdict, 'unverifiable');
});
