import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const ledgerPath = (dir) => path.join(dir, '.rune', 'ledger.jsonl');

function readRaw(dir) {
  const p = ledgerPath(dir);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
}

export function readLedger(dir) {
  return readRaw(dir).map((l) => { try { return JSON.parse(l); } catch { return null; } });
}

export function appendReview(dir, r, overall) {
  const entries = readLedger(dir);
  if (entries.some((e) => e === null)) throw new Error('ledger is corrupt; run `rune ledger --verify`');
  let head = null;
  try { head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim(); } catch {}
  const body = {
    v: 1, ts: new Date().toISOString(), base: r.base, head,
    overall: overall.level, reasons: overall.reasons, changedFiles: r.changedFiles.length,
    results: r.results.map((x) => ({
      claim: x.claim, verdict: x.verdict, reason: x.reason,
      evidence: x.evidence.slice(0, 5).map((e) => ({ file: e.file, line: e.line })),
    })),
    prev: entries.at(-1)?.hash ?? 'genesis',
  };
  const entry = { ...body, hash: sha(JSON.stringify(body)) };
  fs.mkdirSync(path.dirname(ledgerPath(dir)), { recursive: true });
  fs.appendFileSync(ledgerPath(dir), JSON.stringify(entry) + '\n');
  return entry;
}

// Detects edited or reordered entries. Does NOT detect removal of the newest entries.
export function verifyLedger(dir) {
  const entries = readLedger(dir);
  let prev = 'genesis';
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e || typeof e.hash !== 'string') return { ok: false, index: i, reason: 'unreadable entry' };
    const { hash, ...body } = e;
    if (e.prev !== prev) return { ok: false, index: i, reason: 'chain broken' };
    if (sha(JSON.stringify(body)) !== hash) return { ok: false, index: i, reason: 'entry altered' };
    prev = hash;
  }
  return { ok: true, count: entries.length };
}
