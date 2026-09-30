import path from 'node:path';
import { buildBrief } from './brief.js';
import { findContradictions, formatContradictions } from './contradictions.js';

export async function cmdBrief(rest) {
  const files = [];
  let task = null, dir = '.', json = false;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--task') task = rest[++i];
    else if (a === '--dir') dir = rest[++i];
    else if (a === '--json') json = true;
    else if (!a.startsWith('--')) files.push(a);
  }
  if (!files.length) { console.error('usage: rune brief <file...> [--task "..."] [--dir d] [--json]'); process.exitCode = 2; return; }
  try {
    const b = await buildBrief(path.resolve(dir), files, { task });
    console.log(json ? JSON.stringify(b, null, 2) : b.text);
  } catch (e) { console.error(`[rune] ${e.message}`); process.exitCode = 2; }
}

export async function cmdContradictions(rest) {
  const dir = path.resolve(rest.find((a) => !a.startsWith('--')) ?? '.');
  const found = findContradictions(dir);
  console.log(rest.includes('--json') ? JSON.stringify(found, null, 2) : formatContradictions(found));
  process.exitCode = rest.includes('--strict') && found.length ? 1 : 0;
}
