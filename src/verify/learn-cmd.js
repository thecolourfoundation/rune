import path from 'node:path';
import { proposeAttempt, readAttempts, setStatus, suggestFromLedger } from './attempts.js';
import { generateHypotheses, formatHypotheses } from './hypotheses.js';

const fail = (msg) => { console.error(`[rune] ${msg}`); process.exitCode = 2; };

export async function cmdTried(rest) {
  const pos = rest.filter((a) => !a.startsWith('--'));
  if (pos.length < 2) return fail('usage: rune tried "<task>" "<strategy that failed>"');
  try {
    const { item, created } = proposeAttempt(path.resolve('.'), { task: pos[0], strategy: pos[1] });
    console.log(created ? `recorded ${item.id} as proposed. Approve with: rune attempts --approve ${item.id}` : `already recorded: ${item.id} (${item.status})`);
  } catch (e) { fail(e.message); }
}

export async function cmdAttempts(rest) {
  const dir = path.resolve('.');
  const val = (n) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : null; };
  try {
    if (rest.includes('--suggest')) console.log(`${suggestFromLedger(dir)} new suggestion(s) from the ledger`);
    if (val('--approve')) console.log(`approved ${setStatus(dir, val('--approve'), 'approved').id}`);
    if (val('--dismiss')) console.log(`dismissed ${setStatus(dir, val('--dismiss'), 'dismissed').id}`);
  } catch (e) { return fail(e.message); }
  for (const x of readAttempts(dir)) console.log(`${x.id} [${x.status}] ${x.task} -> ${x.strategy}${x.evidence ? ` (${x.evidence})` : ''}`);
}

export async function cmdHypothesize(rest) {
  const problem = rest.filter((a) => !a.startsWith('--')).join(' ');
  const h = await generateHypotheses(path.resolve('.'), problem);
  if (h.skipped) return fail(h.skipped);
  console.log(rest.includes('--json') ? JSON.stringify(h, null, 2) : formatHypotheses(h));
}
