import test from 'node:test';
import assert from 'node:assert/strict';
import { translateClaims, validatePredicate } from '../src/verify/translate.js';
import { evaluate } from '../src/verify/predicates.js';

const env = { ANTHROPIC_API_KEY: 'test-key' };
const reply = (text) => async () => text;
const ctx = (before, after) => ({ before, after, changedFiles: new Set(), unparsedFiles: new Set() });

test('maps valid claims and turns null into unmapped', async () => {
  const out = await translateClaims(['removed lodash from a.js', 'fixed the login bug'], {
    env,
    call: reply(JSON.stringify([
      { i: 0, predicate: { type: 'import_removed', target: 'lodash', file: 'a.js' } },
      { i: 1, predicate: null },
    ])),
  });
  assert.equal(out.predicates[0].type, 'import_removed');
  assert.equal(out.predicates[0].claim, 'removed lodash from a.js');
  assert.equal(out.predicates[1].type, 'unmapped');
});

test('validatePredicate rejects unknown types and missing fields, strips extras', () => {
  assert.equal(validatePredicate({ type: 'delete_everything' }), null);
  assert.equal(validatePredicate({ type: 'import_removed' }), null);
  assert.deepEqual(validatePredicate({ type: 'file_changed', file: 'a.js', evil: 'x' }), { type: 'file_changed', file: 'a.js' });
});

test('no model configured is a setup error, not a pass', async () => {
  const out = await translateClaims(['x'], { env: {} });
  assert.equal(out.needsSetup, true);
  assert.equal(out.predicates, undefined);
});

test('fenced JSON reply is parsed', async () => {
  const fence = '`'.repeat(3);
  const body = fence + 'json\n' + JSON.stringify([{ i: 0, predicate: { type: 'file_changed', file: 'a.js' } }]) + '\n' + fence;
  const out = await translateClaims(['touched a.js'], { env, call: reply(body) });
  assert.equal(out.predicates[0].type, 'file_changed');
});

test('garbage reply twice is reported, not guessed', async () => {
  const out = await translateClaims(['x'], { env, call: reply('sorry, cannot do that') });
  assert.equal(out.skipped, 'model reply was not valid JSON');
});

test('hallucinated entity cannot produce a pass', () => {
  const r = evaluate({ type: 'no_remaining_references', entity: 'ghostFn' }, ctx([], []));
  assert.equal(r.verdict, 'unverifiable');
});

test('unmapped predicate is unverifiable', () => {
  assert.equal(evaluate({ type: 'unmapped', claim: 'fixed it' }, ctx([], [])).verdict, 'unverifiable');
});
