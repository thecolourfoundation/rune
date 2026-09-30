import test from 'node:test';
import assert from 'node:assert/strict';
import { overallOf, formatReport } from '../src/verify/after.js';

const base = () => ({
  base: 'HEAD', changedFiles: ['a.js'], results: [], unclaimed: { added: [], removed: [] },
  unreviewedDependents: [], impactErrors: [], unparsedFiles: [], projectWarnings: [],
});
const sup = { claim: 'c', verdict: 'supported', reason: 'ok', evidence: [] };

test('contradicted claim rejects', () => {
  const r = { ...base(), results: [sup, { ...sup, verdict: 'contradicted' }] };
  assert.equal(overallOf(r).level, 'REJECT');
});

test('accept only when everything is clean; any gap downgrades to review', () => {
  assert.equal(overallOf({ ...base(), results: [sup] }).level, 'ACCEPT');
  assert.equal(overallOf({ ...base(), results: [sup], unparsedFiles: ['x.js'] }).level, 'REVIEW');
  assert.equal(overallOf({ ...base(), results: [{ ...sup, verdict: 'unverifiable' }] }).level, 'REVIEW');
  assert.equal(overallOf(base()).level, 'REVIEW');
});

test('unclaimed changes are grouped per file in the report', () => {
  const f = (file, type) => ({ file, type, line: 1, entity: 'e' });
  const r = { ...base(), results: [sup], unclaimed: { added: [f('x.js', 'import'), f('x.js', 'function_call'), f('x.js', 'function_call')], removed: [] } };
  const out = formatReport(r);
  assert.match(out, /RUNE REVIEW: REVIEW/);
  assert.match(out, /x\.js: \+1 import, \+2 function_call/);
});
