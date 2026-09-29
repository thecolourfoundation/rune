import test from 'node:test';
import assert from 'node:assert/strict';
import { computeDelta } from '../src/graph/delta.js';

const imp = (file, target, line = 1, id = 0) => ({ type: 'import', file, target, line, id });
const call = (file, caller, callee, line = 1) => ({ type: 'function_call', file, caller, callee, line });

test('detects added and removed, ignores id churn', () => {
  const d = computeDelta([imp('a.js','x',1,1), imp('a.js','y',2,2)],
                         [imp('a.js','y',2,7), imp('a.js','z',3,8)]);
  assert.deepEqual(d.added.map(f => f.target), ['z']);
  assert.deepEqual(d.removed.map(f => f.target), ['x']);
});

test('line shifts alone produce no delta', () => {
  const d = computeDelta([imp('a.js','x',5)], [imp('a.js','x',12)]);
  assert.equal(d.added.length + d.removed.length, 0);
});

test('duplicate facts are counted, not collapsed', () => {
  const d = computeDelta([call('a.js','f','g',3), call('a.js','f','g',9)],
                         [call('a.js','f','g',3)]);
  assert.equal(d.removed.length, 1);
  assert.equal(d.added.length, 0);
});

test('same callee from a different caller is a distinct fact', () => {
  const d = computeDelta([call('a.js','f','g')], [call('a.js','h','g')]);
  assert.equal(d.added.length, 1);
  assert.equal(d.removed.length, 1);
});
