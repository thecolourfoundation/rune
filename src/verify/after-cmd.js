import fs from 'node:fs';
import path from 'node:path';
import { runAfter, formatReport } from './after.js';

export async function cmdAfter(rest) {
  let base = 'HEAD', claims = null, dir = '.', json = false;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--base') base = rest[++i];
    else if (a === '--claims') claims = rest[++i];
    else if (a === '--json') json = true;
    else if (!a.startsWith('--')) dir = a;
  }
  const predicates = claims ? JSON.parse(fs.readFileSync(claims === '-' ? 0 : claims, 'utf8')) : [];
  const r = await runAfter(path.resolve(dir), { base, predicates });
  console.log(json ? JSON.stringify(r, null, 2) : formatReport(r));
  process.exitCode = r.exitCode;
}
