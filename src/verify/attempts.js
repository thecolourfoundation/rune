import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readLedger } from './ledger.js';

const file = (dir) => path.join(dir, '.rune', 'attempts.json');
const clean = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const idOf = (t, s) => crypto.createHash('sha256').update(`${t}\n${s}`).digest('hex').slice(0, 8);

export function readAttempts(dir) {
  try { const j = JSON.parse(fs.readFileSync(file(dir), 'utf8')); return Array.isArray(j.items) ? j.items : []; } catch { return []; }
}
function save(dir, items) {
  fs.mkdirSync(path.dirname(file(dir)), { recursive: true });
  fs.writeFileSync(file(dir), JSON.stringify({ version: 1, items }, null, 2));
}

// Anything recorded starts as "proposed". Only an explicit approval makes it visible in briefs.
export function proposeAttempt(dir, { task, strategy, source = 'manual', evidence = null }) {
  const t = clean(task, 200), s = clean(strategy, 300);
  if (!t || !s) throw new Error('task and strategy are required');
  const items = readAttempts(dir);
  const id = idOf(t, s);
  const existing = items.find((x) => x.id === id);
  if (existing) return { item: existing, created: false };
  const item = { id, ts: new Date().toISOString(), task: t, strategy: s, outcome: 'failed', status: 'proposed', source, evidence };
  save(dir, [...items, item]);
  return { item, created: true };
}

export function setStatus(dir, id, status) {
  const items = readAttempts(dir);
  const it = items.find((x) => x.id === id);
  if (!it) throw new Error(`no attempt with id ${id}`);
  it.status = status;
  save(dir, items);
  return it;
}

export const approvedFailures = (dir) => readAttempts(dir).filter((x) => x.status === 'approved');

export function suggestFromLedger(dir) {
  let added = 0;
  for (const e of readLedger(dir)) {
    if (!e || e.overall !== 'REJECT') continue;
    const bad = (e.results ?? []).filter((r) => r.verdict === 'contradicted').map((r) => r.claim);
    if (!bad.length) continue;
    const { created } = proposeAttempt(dir, {
      task: `agent change reviewed against ${e.base}`,
      strategy: `claimed: ${bad.join('; ')} (contradicted by the code)`,
      source: 'ledger',
      evidence: `ledger:${String(e.hash).slice(0, 12)}`,
    });
    if (created) added++;
  }
  return added;
}
