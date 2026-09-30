import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildGraph } from '../graph/build.js';
import { computeDelta } from '../graph/delta.js';
import { computeImpact } from '../graph/impact.js';
import { evaluateAll } from './predicates.js';

const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const ent = (f) => f.entity ?? f.name ?? f.target ?? f.callee ?? f.routePath;
const PROJECT = '(project-level)';

function changedFilesOf(dir, base) {
  const tracked = git(dir, 'diff', '--name-only', base).split('\n');
  const untracked = git(dir, 'ls-files', '--others', '--exclude-standard').split('\n');
  return new Set([...tracked, ...untracked].filter((f) => f && !f.startsWith('.rune/')));
}

function warningsOf(graph) {
  const ws = (graph.scanWarnings ?? []).filter((w) => w && typeof w === 'object');
  return {
    unparsedFiles: new Set(ws.filter((w) => w.file && w.file !== PROJECT).map((w) => w.file)),
    projectWarnings: ws.filter((w) => w.file === PROJECT),
  };
}

function unclaimedOf(delta, preds) {
  const claimedEnts = new Set(preds.flatMap((p) => [p.entity, p.target].filter(Boolean)));
  const claimedFiles = new Set(preds.map((p) => p.file).filter(Boolean));
  const unclaimed = (f) => !claimedEnts.has(ent(f)) && !claimedFiles.has(f.file);
  return { added: delta.added.filter(unclaimed), removed: delta.removed.filter(unclaimed) };
}

export const isTestFile = (f) => /(^|\/)(tests?|__tests__)\//.test(f) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(f);

// Dependents of changed files that were NOT themselves changed. Deleted files
// use the before-graph so anything still importing them is surfaced.
function dependentsOf(changedFiles, dir, beforeG, afterG) {
  const by = new Map();
  const errors = [];
  for (const f of changedFiles) {
    const g = fs.existsSync(path.join(dir, f)) ? afterG : beforeG;
    let imp;
    try { imp = computeImpact(g, f); } catch (e) { errors.push(`${f}: ${e.message}`); continue; }
    for (const d of imp?.dependents ?? []) {
      if (changedFiles.has(d.file)) continue;
      if (!by.has(d.file)) by.set(d.file, new Set());
      by.get(d.file).add(f);
    }
  }
  return {
    unreviewedDependents: [...by].map(([file, s]) => ({ file, dependsOn: [...s].sort(), isTest: isTestFile(file) })),
    impactErrors: errors,
  };
}

const CODE_EXT = /\.(?:[cm]?[jt]sx?)$/;
const DOC_EXT = /\.(?:md|txt|rst)$/i;

// import(x) / require(x) with a non-literal argument cannot be resolved statically.
export function findDynamicRefs(dir, changedFiles) {
  const out = [];
  const literal = /^\s*(?:'[^']*'|"[^"]*"|`[^`$]*`)\s*$/;
  for (const f of changedFiles) {
    if (!CODE_EXT.test(f)) continue;
    let src;
    try { src = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { continue; }
    const call = /\b(?:require|import)\s*\(\s*([^)]*)\)/g;
    let m;
    while ((m = call.exec(src))) {
      if (!m[1].trim() || literal.test(m[1])) continue;
      out.push(`${f}:${src.slice(0, m.index).split('\n').length}`);
    }
  }
  return out;
}

// Returns matches outside docs, [] for none, null if the search itself failed.
function makeTextSearch(dir) {
  return (needle) => {
    if (typeof needle !== 'string' || !needle.trim()) return [];
    let out;
    try {
      out = execFileSync('git', ['grep', '-n', '-I', '-F', '-w', '--untracked', '-e', needle, '--', ':(exclude).rune'],
        { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    } catch (e) {
      if (e.status === 1) return [];
      return null;
    }
    return out.split('\n').filter(Boolean).map((line) => {
      const m = /^(.*?):(\d+):/.exec(line);
      return m ? { file: m[1], line: Number(m[2]), type: 'text_match' } : null;
    }).filter((x) => x && !DOC_EXT.test(x.file));
  };
}

// Runs `node --test <file>` in the base worktree ('before') or the working tree ('after').
// The file is copied into the base worktree so a test added by the agent can fail there.
function makeRunTest(dir, wt) {
  return (file, where) => {
    if (typeof file !== 'string' || !file || file.startsWith('-') || path.isAbsolute(file) || file.split(/[\\/]/).includes('..')) {
      return { ran: false, passed: false, note: 'invalid test path' };
    }
    const src = path.join(dir, file);
    if (!fs.existsSync(src)) return { ran: false, passed: false, note: 'test file does not exist' };
    let cwd = dir;
    if (where === 'before') {
      cwd = wt;
      const dst = path.join(wt, file);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      const nm = path.join(wt, 'node_modules');
      if (fs.existsSync(path.join(dir, 'node_modules')) && !fs.existsSync(nm)) {
        fs.symlinkSync(path.join(dir, 'node_modules'), nm, 'dir');
      }
    }
    // An outer `node --test` sets NODE_TEST_CONTEXT; inheriting it makes a nested run
    // report success even when the test fails.
    const { NODE_TEST_CONTEXT, ...cleanEnv } = process.env;
    const r = spawnSync(process.execPath, ['--test', file], { cwd, encoding: 'utf8', timeout: 120000, env: cleanEnv });
    if (r.error || r.status === null) return { ran: false, passed: false, note: r.error ? r.error.message : 'timed out' };
    return { ran: true, passed: r.status === 0 };
  };
}

export async function runAfter(dir, { base = 'HEAD', predicates = [], runTests = false } = {}) {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'rune-base-'));
  fs.rmSync(wt, { recursive: true, force: true });
  git(dir, 'worktree', 'add', '--detach', wt, base);
  try {
    const beforeG = await buildGraph(wt);
    const afterG = await buildGraph(dir);
    const changedFiles = changedFilesOf(dir, base);
    const { unparsedFiles, projectWarnings } = warningsOf(afterG);
    const dynamicRefs = findDynamicRefs(dir, changedFiles);
    const results = evaluateAll(predicates, {
      before: beforeG.facts, after: afterG.facts, changedFiles, unparsedFiles,
      textSearch: makeTextSearch(dir),
      runTest: runTests ? makeRunTest(dir, wt) : null,
    });
    const unclaimed = unclaimedOf(computeDelta(beforeG.facts, afterG.facts), predicates);
    const { unreviewedDependents, impactErrors } = dependentsOf(changedFiles, dir, beforeG, afterG);
    const contradicted = results.filter((r) => r.verdict === 'contradicted').length;
    return {
      base, changedFiles: [...changedFiles], results, unclaimed,
      unreviewedDependents, impactErrors, dynamicRefs,
      unparsedFiles: [...unparsedFiles],
      projectWarnings: projectWarnings.map((w) => `${w.extractor ?? '?'}: ${w.error}`),
      exitCode: contradicted ? 1 : 0,
    };
  } finally {
    try { git(dir, 'worktree', 'remove', '--force', wt); } catch {}
  }
}

export function overallOf(r) {
  const c = r.results.filter((x) => x.verdict === 'contradicted').length;
  const u = r.results.filter((x) => x.verdict === 'unverifiable').length;
  if (c) return { level: 'REJECT', reasons: [`${c} claim(s) contradicted by the code`] };
  const reasons = [];
  if (!r.results.length) reasons.push('no claims were checked');
  if (u) reasons.push(`${u} claim(s) cannot be verified structurally`);
  const un = r.unclaimed.added.length + r.unclaimed.removed.length;
  if (un) reasons.push(`${un} change(s) no claim covers`);
  const sd = r.unreviewedDependents.filter((d) => !d.isTest).length;
  if (sd) reasons.push(`${sd} dependent source file(s) not reviewed`);
  if (r.unparsedFiles.length || r.projectWarnings.length || r.impactErrors.length || r.dynamicRefs?.length) reasons.push('coverage gaps');
  return reasons.length
    ? { level: 'REVIEW', reasons }
    : { level: 'ACCEPT', reasons: ['all claims supported; no uncovered changes or gaps'] };
}

function groupLines(list, sign) {
  const by = new Map();
  for (const f of list) {
    if (!by.has(f.file)) by.set(f.file, new Map());
    const m = by.get(f.file);
    m.set(f.type, (m.get(f.type) ?? 0) + 1);
  }
  return [...by].map(([file, m]) => `  ${file}: ` + [...m].map(([t, n]) => `${sign}${n} ${t}`).join(', '));
}

const loc = (f) => `${f.file}:${f.line ?? '?'}`;
const label = (f) => `${f.type} ${ent(f)} (${loc(f)})`;
const CAP = 10;
const more = (total) => (total > CAP ? [`  ... and ${total - CAP} more`] : []);

export function formatReport(r) {
  const o = overallOf(r);
  const L = [`RUNE REVIEW: ${o.level}`, ...o.reasons.map((x) => `  - ${x}`), '',
    `base ${r.base}, ${r.changedFiles.length} file(s) changed`, ''];
  for (const x of r.results) {
    L.push(`[${x.verdict.toUpperCase()}] ${x.claim}`, `    ${x.reason}`);
    for (const e of x.evidence.slice(0, 3)) L.push(`    at ${loc(e)}`);
  }
  const { added, removed } = r.unclaimed;
  if (added.length + removed.length) {
    L.push('', `Changes no claim covers (${added.length + removed.length}):`);
    const rl = groupLines(removed, '-'), al = groupLines(added, '+');
    L.push(...rl.slice(0, CAP), ...more(rl.length), ...al.slice(0, CAP), ...more(al.length));
  }
  const srcDeps = r.unreviewedDependents.filter((d) => !d.isTest);
  const testDeps = r.unreviewedDependents.filter((d) => d.isTest);
  if (srcDeps.length) {
    L.push('', 'Source files that depend on changed files but were not changed (unreviewed):');
    for (const d of srcDeps.slice(0, CAP)) L.push(`  ? ${d.file}  <- ${d.dependsOn.join(', ')}`);
    L.push(...more(srcDeps.length));
  }
  if (testDeps.length) {
    L.push('', 'Tests to run (they import changed files):');
    for (const d of testDeps.slice(0, CAP)) L.push(`  > ${d.file}`);
    L.push(...more(testDeps.length));
  }
  if (r.unparsedFiles.length) L.push('', `Coverage caveat: failed to fully parse: ${r.unparsedFiles.join(', ')}`);
  if (r.projectWarnings.length) L.push('', `Coverage caveat: project-level extractor failure(s): ${r.projectWarnings.join('; ')}`);
  if (r.impactErrors.length) L.push('', `Impact could not be computed for: ${r.impactErrors.join('; ')}`);
  if (r.dynamicRefs?.length) L.push('', `Coverage caveat: dynamic import/require in changed files, references not fully tracked: ${r.dynamicRefs.slice(0, 5).join(', ')}`);
  return L.join('\n');
}
