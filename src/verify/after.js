import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildGraph } from '../graph/build.js';
import { computeDelta } from '../graph/delta.js';
import { evaluateAll } from './predicates.js';

const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const ent = (f) => f.entity ?? f.name ?? f.target ?? f.callee ?? f.routePath;

function changedFilesOf(dir, base) {
  const tracked = git(dir, 'diff', '--name-only', base).split('\n');
  const untracked = git(dir, 'ls-files', '--others', '--exclude-standard').split('\n');
  return new Set([...tracked, ...untracked].filter(Boolean));
}

// Best-effort: files the scanner flagged as failed. Shape of scanWarnings is
// verified in Cell 9; entries without a file are ignored here.
function unparsedFilesOf(graph) {
  const out = new Set();
  for (const w of graph.scanWarnings ?? []) if (w && typeof w === 'object' && w.file) out.add(w.file);
  return out;
}

function unclaimedOf(delta, preds) {
  const claimedEnts = new Set(preds.flatMap((p) => [p.entity, p.target].filter(Boolean)));
  const claimedFiles = new Set(preds.map((p) => p.file).filter(Boolean));
  const unclaimed = (f) => !claimedEnts.has(ent(f)) && !claimedFiles.has(f.file);
  return { added: delta.added.filter(unclaimed), removed: delta.removed.filter(unclaimed) };
}

export async function runAfter(dir, { base = 'HEAD', predicates = [] } = {}) {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'rune-base-'));
  fs.rmSync(wt, { recursive: true, force: true });
  git(dir, 'worktree', 'add', '--detach', wt, base);
  try {
    const before = await buildGraph(wt);
    const after = await buildGraph(dir);
    const changedFiles = changedFilesOf(dir, base);
    const unparsedFiles = unparsedFilesOf(after);
    const results = evaluateAll(predicates, { before: before.facts, after: after.facts, changedFiles, unparsedFiles });
    const delta = computeDelta(before.facts, after.facts);
    const unclaimed = unclaimedOf(delta, predicates);
    const contradicted = results.filter((r) => r.verdict === 'contradicted').length;
    return { base, changedFiles: [...changedFiles], results, unclaimed, unparsedFiles: [...unparsedFiles], exitCode: contradicted ? 1 : 0 };
  } finally {
    try { git(dir, 'worktree', 'remove', '--force', wt); } catch {}
  }
}

const loc = (f) => `${f.file}:${f.line ?? '?'}`;
const label = (f) => `${f.type} ${ent(f)} (${loc(f)})`;

export function formatReport(r) {
  const L = [`rune after — base ${r.base}, ${r.changedFiles.length} file(s) changed`, ''];
  for (const x of r.results) {
    L.push(`[${x.verdict.toUpperCase()}] ${x.claim}`, `    ${x.reason}`);
    for (const e of x.evidence.slice(0, 3)) L.push(`    at ${loc(e)}`);
  }
  const { added, removed } = r.unclaimed;
  if (added.length + removed.length) {
    L.push('', 'Changes no claim covers:');
    for (const f of removed.slice(0, 10)) L.push(`  - removed ${label(f)}`);
    for (const f of added.slice(0, 10)) L.push(`  + added   ${label(f)}`);
  }
  if (r.unparsedFiles.length) L.push('', `Coverage caveat: failed to fully parse: ${r.unparsedFiles.join(', ')}`);
  return L.join('\n');
}
