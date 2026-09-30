import path from 'node:path';
import { runBefore, formatBefore } from './before.js';
import { readLedger, verifyLedger } from './ledger.js';

export async function cmdBefore(rest) {
  const pos = rest.filter((a) => !a.startsWith('--'));
  const json = rest.includes('--json');
  if (!pos[0]) { console.error('usage: rune before <file> [dir] [--json]'); process.exitCode = 2; return; }
  try {
    const b = await runBefore(path.resolve(pos[1] ?? '.'), pos[0]);
    console.log(json ? JSON.stringify(b, null, 2) : formatBefore(b));
  } catch (e) { console.error(`[rune] ${e.message}`); process.exitCode = 2; }
}

export async function cmdLedger(rest) {
  const dir = path.resolve(rest.find((a) => !a.startsWith('--')) ?? '.');
  if (rest.includes('--verify')) {
    const v = verifyLedger(dir);
    console.log(v.ok ? `ledger OK (${v.count} entr${v.count === 1 ? 'y' : 'ies'})` : `ledger BROKEN at entry ${v.index}: ${v.reason}`);
    process.exitCode = v.ok ? 0 : 1;
    return;
  }
  for (const e of readLedger(dir).slice(-10)) {
    if (!e) { console.log('(unreadable entry)'); continue; }
    const c = { supported: 0, contradicted: 0, unverifiable: 0 };
    for (const r of e.results) c[r.verdict]++;
    console.log(`${e.ts}  ${e.overall}  base=${e.base}  head=${(e.head ?? '-').slice(0, 7)}  ${c.supported} ok / ${c.contradicted} contradicted / ${c.unverifiable} unverifiable`);
  }
}
