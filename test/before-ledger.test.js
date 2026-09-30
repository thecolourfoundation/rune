import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runBefore, formatBefore } from '../src/verify/before.js';
import { runAfter } from '../src/verify/after.js';
import { appendReview, verifyLedger, ledgerPath } from '../src/verify/ledger.js';

const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (cwd, ...a) => execFileSync('git', a, { cwd, env, encoding: 'utf8' });
function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rune-bl-'));
  git(dir, 'init', '-q');
  fs.mkdirSync(path.join(dir, 'test'));
  fs.writeFileSync(path.join(dir, 'a.js'), 'export const x = 1;\n');
  fs.writeFileSync(path.join(dir, 'b.js'), 'import { x } from "./a.js";\nexport const y = x + 1;\n');
  fs.writeFileSync(path.join(dir, 'test', 'a.test.js'), 'import { x } from "../a.js";\nexport const t = x;\n');
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'base');
  return dir;
}
const fakeReview = (verdict = 'supported') => ({
  base: 'HEAD', changedFiles: ['a.js'],
  results: [{ claim: 'c', verdict, reason: 'r', evidence: [{ file: 'a.js', line: 1 }] }],
});
const ov = { level: 'REVIEW', reasons: ['x'] };

test('before: lists source dependents and tests separately, with limits', async () => {
  const b = await runBefore(repo(), 'a.js');
  assert.equal(b.dependents.find((d) => d.file === 'b.js')?.isTest, false);
  assert.equal(b.dependents.find((d) => d.file === 'test/a.test.js')?.isTest, true);
  const out = formatBefore(b);
  assert.match(out, /RUNE BEFORE: a\.js/);
  assert.match(out, /What Rune cannot tell you/);
});

test('before: unknown file and path escapes are errors', async () => {
  const dir = repo();
  await assert.rejects(runBefore(dir, 'nope.js'), /not found/);
  await assert.rejects(runBefore(dir, '../etc/passwd'), /relative path/);
});

test('ledger: chained entries verify', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rune-led-'));
  appendReview(dir, fakeReview(), ov);
  appendReview(dir, fakeReview('contradicted'), { level: 'REJECT', reasons: ['y'] });
  assert.deepEqual(verifyLedger(dir), { ok: true, count: 2 });
});

test('ledger: an edited entry is detected', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rune-led-'));
  appendReview(dir, fakeReview('contradicted'), { level: 'REJECT', reasons: ['y'] });
  appendReview(dir, fakeReview(), ov);
  const p = ledgerPath(dir);
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('contradicted', 'supported'));
  const v = verifyLedger(dir);
  assert.equal(v.ok, false);
  assert.equal(v.index, 0);
});

test('after ignores the ledger directory', async () => {
  const dir = repo();
  fs.writeFileSync(path.join(dir, 'a.js'), 'export const x = 2;\n');
  appendReview(dir, fakeReview(), ov);
  const r = await runAfter(dir, { base: 'HEAD', predicates: [{ claim: 'x', type: 'no_remaining_references', entity: 'legacyThing' }] });
  assert.ok(r.changedFiles.every((f) => !f.startsWith('.rune/')));
});
