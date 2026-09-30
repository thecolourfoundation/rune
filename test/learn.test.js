import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { proposeAttempt, setStatus, approvedFailures, readAttempts, suggestFromLedger } from '../src/verify/attempts.js';
import { appendReview } from '../src/verify/ledger.js';
import { generateHypotheses } from '../src/verify/hypotheses.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rune-learn-'));

test('attempts: proposed by default, deduped, visible only after approval', () => {
  const dir = tmp();
  const a = proposeAttempt(dir, { task: 'speed up x', strategy: 'memoize everything' });
  assert.equal(a.created, true);
  assert.equal(a.item.status, 'proposed');
  assert.equal(proposeAttempt(dir, { task: 'speed up x', strategy: 'memoize everything' }).created, false);
  assert.equal(approvedFailures(dir).length, 0);
  setStatus(dir, a.item.id, 'approved');
  assert.equal(approvedFailures(dir).length, 1);
});

test('attempts: unknown id and empty fields are errors', () => {
  const dir = tmp();
  assert.throws(() => setStatus(dir, 'deadbeef', 'approved'), /no attempt/);
  assert.throws(() => proposeAttempt(dir, { task: '', strategy: 'x' }), /required/);
});

test('attempts: a ledger REJECT becomes one proposed suggestion, once', () => {
  const dir = tmp();
  const review = { base: 'HEAD', changedFiles: ['a.js'], results: [{ claim: 'removed legacyFn', verdict: 'contradicted', reason: 'r', evidence: [] }] };
  appendReview(dir, review, { level: 'REJECT', reasons: ['x'] });
  assert.equal(suggestFromLedger(dir), 1);
  assert.equal(suggestFromLedger(dir), 0);
  const item = readAttempts(dir)[0];
  assert.equal(item.status, 'proposed');
  assert.match(item.evidence, /^ledger:/);
});

const graph = {
  facts: [
    { id: 'f1', type: 'function_call', file: 'src/pay.js', line: 3, entity: 'charge', callee: 'charge', evidence: 'charge(order)' },
    { id: 'f2', type: 'function_call', file: 'src/db.js', line: 9, entity: 'save', callee: 'save', evidence: 'save(order)' },
  ],
  derived: [], meta: {}, scanWarnings: [],
};
const opts = (reply) => ({ graph, env: {}, resolve: () => ({ name: 'fake', model: 'm' }), call: async () => reply });

test('hypotheses: keeps cited explanations, drops uncited and hallucinated ones', async () => {
  const h = await generateHypotheses('.', 'charge fails before save', opts(JSON.stringify([
    { explanation: 'charge runs before order is persisted', factIds: ['f1', 'f2'], confirmWith: 'read pay.js', ruleOutWith: 'check ordering' },
    { explanation: 'made up cause', factIds: ['zzz'] },
    { explanation: 'save swallows errors', factIds: ['f2', 'nope'] },
  ])));
  assert.equal(h.hypotheses.length, 2);
  assert.equal(h.dropped, 1);
  assert.deepEqual(h.hypotheses[1].evidence.map((e) => e.id), ['f2']);
});

test('hypotheses: one supported explanation is flagged as not a competing set', async () => {
  const h = await generateHypotheses('.', 'charge fails', opts(JSON.stringify([{ explanation: 'only one', factIds: ['f1'] }])));
  assert.ok(h.notes.some((n) => /fewer than 2/.test(n)));
});

test('hypotheses: no matching facts means no model call', async () => {
  const h = await generateHypotheses('.', 'zebra unicorn', { ...opts('[]'), call: async () => { throw new Error('should not be called'); } });
  assert.match(h.skipped, /no facts matched/);
});

test('hypotheses: no model configured is a setup error', async () => {
  const h = await generateHypotheses('.', 'charge fails', { graph, env: {}, resolve: () => null });
  assert.equal(h.needsSetup, true);
});

test('hypotheses: garbage reply is reported, not guessed', async () => {
  const h = await generateHypotheses('.', 'charge fails', opts('sorry, no'));
  assert.equal(h.skipped, 'model reply was not valid JSON');
});
