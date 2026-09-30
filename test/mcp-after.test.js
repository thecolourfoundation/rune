import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildTools } from '../src/mcp/tools.js';

const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (cwd, ...a) => execFileSync('git', a, { cwd, env, encoding: 'utf8' });

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rune-mcp-'));
  git(dir, 'init', '-q');
  fs.writeFileSync(path.join(dir, 'a.js'), 'export const x = 1;\n');
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'base');
  fs.writeFileSync(path.join(dir, 'a.js'), 'export const x = 2;\n');
  return dir;
}
const toolFor = (dir) => buildTools(() => ({ facts: [], derived: [], meta: {} }), dir).find((t) => t.name === 'rune_after');

test('rune_after is registered with a schema', () => {
  const t = toolFor(repo());
  assert.ok(t, 'rune_after should exist');
  assert.ok(t.inputSchema.claims && t.inputSchema.predicates && t.inputSchema.base);
});

test('rune_after verifies pre-translated predicates without a model', async () => {
  const dir = repo();
  const out = await toolFor(dir).handler({
    predicates: [
      { claim: 'modified a.js', type: 'file_changed', file: 'a.js' },
      { claim: 'fixed the bug', type: 'made_up_type' },
    ],
  });
  assert.equal(out.details.results[0].verdict, 'supported');
  assert.equal(out.details.results[1].verdict, 'unverifiable');
  assert.notEqual(out.overall.level, 'ACCEPT');
  assert.match(out.report, /RUNE REVIEW/);
});

test('rune_after rejects option-like base refs', async () => {
  await assert.rejects(toolFor(repo()).handler({ base: '--output=/tmp/x' }), /invalid base ref/);
});
