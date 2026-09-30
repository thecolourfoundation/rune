import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runAfter, overallOf } from '../src/verify/after.js';
import { evaluate } from '../src/verify/predicates.js';

const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (cwd, ...a) => execFileSync('git', a, { cwd, env, encoding: 'utf8' });
const put = (dir, f, c) => fs.writeFileSync(path.join(dir, f), c);
function repo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rune-lim-'));
  git(dir, 'init', '-q');
  for (const [f, c] of Object.entries(files)) put(dir, f, c);
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'base');
  return dir;
}
const legacyRepo = () => {
  const dir = repo({
    'a.js': 'export function legacyFn() { return 1; }\n',
    'b.js': 'import { legacyFn } from "./a.js";\nexport const y = legacyFn();\n',
  });
  put(dir, 'b.js', 'export const y = 2;\n');
  put(dir, 'a.js', 'export const z = 3;\n');
  return dir;
};
const noRefs = [{ claim: 'no more legacyFn', type: 'no_remaining_references', entity: 'legacyFn' }];

test('string-only mention keeps no_remaining_references from passing', async () => {
  const dir = legacyRepo();
  put(dir, 'c.js', 'export const label = "legacyFn";\n');
  const r = await runAfter(dir, { base: 'HEAD', predicates: noRefs });
  assert.equal(r.results[0].verdict, 'unverifiable');
  assert.ok(r.results[0].evidence.some((e) => e.file === 'c.js'));
});

test('no structural or textual references left is supported', async () => {
  const r = await runAfter(legacyRepo(), { base: 'HEAD', predicates: noRefs });
  assert.equal(r.results[0].verdict, 'supported');
});

test('dynamic import in a changed file is flagged and blocks ACCEPT', async () => {
  const dir = repo({ 'a.js': 'export const x = 1;\n' });
  put(dir, 'a.js', 'export const load = (n) => import(n);\n');
  const r = await runAfter(dir, { base: 'HEAD', predicates: [{ claim: 'modified a.js', type: 'file_changed', file: 'a.js' }] });
  assert.ok(r.dynamicRefs.some((x) => x.startsWith('a.js:')));
  assert.ok(overallOf(r).reasons.includes('coverage gaps'));
  assert.notEqual(overallOf(r).level, 'ACCEPT');
});

const TESTSRC = 'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { x } from "./a.js";\ntest("x is 2", () => assert.equal(x, 2));\n';
function testRepo() {
  const dir = repo({ 'package.json': '{"type":"module"}\n', 'a.js': 'export const x = 1;\n' });
  put(dir, 'a.js', 'export const x = 2;\n');
  put(dir, 't.test.js', TESTSRC);
  return dir;
}
const fixedClaim = [{ claim: 'fixed x (t.test.js proves it)', type: 'test_fixed', file: 't.test.js' }];

test('test_fixed: supported when the test fails at base and passes after', async () => {
  const r = await runAfter(testRepo(), { base: 'HEAD', predicates: fixedClaim, runTests: true });
  assert.equal(r.results[0].verdict, 'supported');
});

test('test_fixed: test execution is off by default', async () => {
  const r = await runAfter(testRepo(), { base: 'HEAD', predicates: fixedClaim });
  assert.equal(r.results[0].verdict, 'unverifiable');
});

const ctx = (runTest) => ({ before: [], after: [], changedFiles: new Set(), unparsedFiles: new Set(), runTest });

test('test_fixed: a test that also passes at base proves nothing', () => {
  const r = evaluate({ type: 'test_fixed', file: 't.js' }, ctx(() => ({ ran: true, passed: true })));
  assert.equal(r.verdict, 'unverifiable');
});

test('test_fixed: failing after the change is contradicted', () => {
  const r = evaluate({ type: 'test_fixed', file: 't.js' }, ctx((f, w) => ({ ran: true, passed: w === 'before' })));
  assert.equal(r.verdict, 'contradicted');
});
