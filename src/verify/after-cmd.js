import fs from 'node:fs';
import path from 'node:path';
import { runAfter, formatReport } from './after.js';
import { translateClaims } from './translate.js';

export async function cmdAfter(rest) {
  let base = 'HEAD', claimsFile = null, dir = '.', json = false;
  const texts = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--base') base = rest[++i];
    else if (a === '--claims') claimsFile = rest[++i];
    else if (a === '--claim') texts.push(rest[++i]);
    else if (a === '--claims-text') {
      const f = rest[++i];
      texts.push(...fs.readFileSync(f === '-' ? 0 : f, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean));
    } else if (a === '--json') json = true;
    else if (!a.startsWith('--')) dir = a;
  }
  const predicates = claimsFile ? JSON.parse(fs.readFileSync(claimsFile === '-' ? 0 : claimsFile, 'utf8')) : [];
  if (texts.length) {
    const t = await translateClaims(texts, { env: process.env });
    if (t.skipped) {
      console.error(`[rune] cannot check claims: ${t.skipped}`);
      process.exitCode = 2;
      return;
    }
    predicates.push(...t.predicates);
  }
  const r = await runAfter(path.resolve(dir), { base, predicates });
  console.log(json ? JSON.stringify(r, null, 2) : formatReport(r));
  process.exitCode = r.exitCode;
}
