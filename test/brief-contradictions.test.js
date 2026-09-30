import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { findContradictions } from '../src/verify/contradictions.js';
import { buildBrief } from '../src/verify/brief.js';

const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (cwd, ...a) => execFileSync('git', a, { cwd, env, encoding: 'utf8' });
const put = (dir, f, c) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), c); };
const FENCE = '`'.repeat(3);

function repo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rune-bc-'));
  git(dir, 'init', '-q');
  for (const [f, c] of Object.entries(files)) put(dir, f, c);
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'base');
  return dir;
}

test('contradictions: finds stale links, scripts and paths; ignores fences and external links', () => {
  const readme = [
    'See [guide](docs/guide.md), [license](LICENSE), [site](https://example.com) and [top](#top).',
    'Run `npm run build` then `npm run lint`.',
    'See `src/missing.js` and `src/real.js`.',
    FENCE,
    '[not a real link](nope.md)',
    FENCE,
  ].join('\n');
  const dir = repo({ 'README.md': readme, LICENSE: 'x', 'package.json': '{"scripts":{"build":"x"}}', 'src/real.js': 'export {};\n' });
  const f = findContradictions(dir);
  const kinds = f.map((x) => `${x.kind}:${x.detail}`);
  assert.ok(kinds.some((k) => k.startsWith('broken_link') && k.includes('docs/guide.md')));
  assert.ok(kinds.some((k) => k.startsWith('missing_npm_script') && k.includes('lint')));
  assert.ok(kinds.some((k) => k.startsWith('missing_path') && k.includes('src/missing.js')));
  assert.equal(f.length, 3, JSON.stringify(f));
});

test('contradictions: a consistent README produces none', () => {
  const readme = 'See [license](LICENSE). Run `npm run build`. Code lives in `src/real.js`.\n';
  const dir = repo({ 'README.md': readme, LICENSE: 'x', 'package.json': '{"scripts":{"build":"x"}}', 'src/real.js': 'export {};\n' });
  assert.deepEqual(findContradictions(dir), []);
});

const briefRepo = () => repo({ 'a.js': 'export const x = 1;\n', 'b.js': 'import { x } from "./a.js";\nexport const y = x;\n' });

test('brief: approved rules and failed approaches only, limits always present', async () => {
  const memory = {
    ok: true,
    rules: [{ rule: 'no default exports', status: 'approved', category: 'style' }, { rule: 'secret pending rule', status: 'pending' }],
    experience: [
      { taskDescription: 'speed up x', strategyUsed: 'memoize everything', outcome: 'failed: broke y' },
      { taskDescription: 'rename z', strategyUsed: 'sed replace', outcome: 'succeeded' },
    ],
  };
  const b = await buildBrief(briefRepo(), ['a.js'], { task: 'change x', memory });
  assert.match(b.text, /no default exports/);
  assert.doesNotMatch(b.text, /secret pending rule/);
  assert.match(b.text, /1 unapproved rule\(s\) not included/);
  assert.match(b.text, /memoize everything/);
  assert.doesNotMatch(b.text, /sed replace/);
  assert.match(b.text, /Limits:/);
  assert.match(b.text, /b\.js/);
});

test('brief: truncation is visible and never cuts the limits section', async () => {
  const rules = Array.from({ length: 30 }, (_, i) => ({ rule: 'long rule '.repeat(15) + i, status: 'approved' }));
  const b = await buildBrief(briefRepo(), ['a.js'], { maxChars: 500, memory: { ok: true, rules, experience: [] } });
  assert.equal(b.truncated, true);
  assert.match(b.text, /Limits:/);
  assert.match(b.text, /brief truncated/);
});

test('brief: an unknown file is reported, not thrown', async () => {
  const b = await buildBrief(briefRepo(), ['nope.js'], { memory: { ok: true, rules: [], experience: [] } });
  assert.match(b.text, /nope\.js: unavailable/);
});
