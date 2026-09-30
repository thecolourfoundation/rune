import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runAfter } from '../src/verify/after.js';

const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (cwd, ...a) => execFileSync('git', a, { cwd, env, encoding: 'utf8' });

test('after: true claim, false claim, and an unclaimed change', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rune-e2e-'));
  git(dir, 'init', '-q');
  fs.writeFileSync(path.join(dir, 'a.js'), 'import _ from "lodash";\nimport fs from "node:fs";\nexport const x = 1;\n');
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'base');

  fs.writeFileSync(path.join(dir, 'a.js'), 'import fs from "node:fs";\nexport const x = 1;\n');
  fs.writeFileSync(path.join(dir, 'c.js'), 'import chalk from "chalk";\nexport const y = 2;\n');

  const r = await runAfter(dir, {
    base: 'HEAD',
    predicates: [
      { claim: 'removed lodash from a.js', type: 'import_removed', target: 'lodash', file: 'a.js' },
      { claim: 'nothing references node:fs anymore', type: 'no_remaining_references', entity: 'node:fs' },
    ],
  });

  assert.equal(r.results[0].verdict, 'supported');
  assert.equal(r.results[1].verdict, 'contradicted');
  assert.equal(r.exitCode, 1);
  assert.ok(r.unclaimed.added.some((f) => f.target === 'chalk'), 'chalk import surfaces as unclaimed');
});

test('after: untouched dependent of a changed file is surfaced', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rune-dep-'));
  git(dir, 'init', '-q');
  fs.writeFileSync(path.join(dir, 'a.js'), 'export const x = 1;\n');
  fs.writeFileSync(path.join(dir, 'b.js'), 'import { x } from "./a.js";\nexport const y = x + 1;\n');
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'base');
  fs.writeFileSync(path.join(dir, 'a.js'), 'export const x = 2;\n');

  const r = await runAfter(dir, { base: 'HEAD', predicates: [] });
  const dep = r.unreviewedDependents.find((d) => d.file === 'b.js');
  assert.ok(dep, 'b.js should be listed as an unreviewed dependent');
  assert.deepEqual(dep.dependsOn, ['a.js']);
});

test('after: dependent tests are flagged as tests, not source', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rune-tst-'));
  git(dir, 'init', '-q');
  fs.mkdirSync(path.join(dir, 'test'));
  fs.writeFileSync(path.join(dir, 'a.js'), 'export const x = 1;\n');
  fs.writeFileSync(path.join(dir, 'test', 'a.test.js'), 'import { x } from "../a.js";\nexport const t = x;\n');
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'base');
  fs.writeFileSync(path.join(dir, 'a.js'), 'export const x = 2;\n');
  const r = await runAfter(dir, { base: 'HEAD', predicates: [] });
  assert.equal(r.unreviewedDependents.find((d) => d.file === 'test/a.test.js')?.isTest, true);
});
