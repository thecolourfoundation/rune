import fs from 'node:fs';
import path from 'node:path';
import { buildGraph } from '../graph/build.js';
import { computeImpact } from '../graph/impact.js';
import { isTestFile, findDynamicRefs } from './after.js';

const CAP = 10;
const more = (n) => (n > CAP ? [`  ... and ${n - CAP} more`] : []);

export async function runBefore(dir, file) {
  if (typeof file !== 'string' || !file || path.isAbsolute(file) || file.split(/[\\/]/).includes('..')) {
    throw new Error('file must be a relative path inside the project');
  }
  const rel = path.normalize(file).split(path.sep).join('/');
  const g = await buildGraph(dir);
  const facts = g.facts.filter((f) => f.file === rel);
  if (!facts.length && !fs.existsSync(path.join(dir, rel))) throw new Error(`file not found in project: ${rel}`);

  const byType = {};
  for (const f of facts) byType[f.type] = (byType[f.type] ?? 0) + 1;
  const imports = [...new Set(facts.filter((f) => f.type === 'import').map((f) => f.target))].sort();

  let dependents = [], impactError = null;
  try {
    dependents = (computeImpact(g, rel)?.dependents ?? []).map((d) => ({ file: d.file, isTest: isTestFile(d.file) }));
  } catch (e) { impactError = e.message; }

  const security = (g.securityFindings ?? [])
    .filter((x) => x && x.file === rel)
    .map((x) => ({ rule: x.rule ?? x.type ?? x.id ?? 'finding', severity: x.severity ?? null, line: x.line ?? null }));

  const notes = [];
  if (!facts.length) notes.push('no facts were extracted for this file (unsupported type, empty, or not scanned)');
  if ((g.scanWarnings ?? []).some((w) => w?.file === rel)) notes.push('this file failed to fully parse; facts above may be incomplete');
  const dynamicRefs = findDynamicRefs(dir, new Set([rel]));
  if (dynamicRefs.length) notes.push(`dynamic import/require at ${dynamicRefs.join(', ')}; those references are not tracked`);
  if (impactError) notes.push(`impact could not be computed: ${impactError}`);
  notes.push('dependents come from static imports only; runtime, string-built and cross-package usage is not visible');

  return { file: rel, factCount: facts.length, byType, imports, dependents, security, dynamicRefs, notes };
}

export function formatBefore(b) {
  const src = b.dependents.filter((d) => !d.isTest), tst = b.dependents.filter((d) => d.isTest);
  const L = [`RUNE BEFORE: ${b.file}`, '',
    `Known: ${b.factCount} fact(s)` + (b.factCount ? ` (${Object.entries(b.byType).map(([t, n]) => `${n} ${t}`).join(', ')})` : '')];
  if (b.imports.length) L.push('', `Imports (${b.imports.length}):`, ...b.imports.slice(0, CAP).map((t) => `  ${t}`), ...more(b.imports.length));
  L.push('', `Source files that depend on it (${src.length}) - review if you change behavior:`,
    ...src.slice(0, CAP).map((d) => `  ? ${d.file}`), ...more(src.length));
  L.push('', `Tests that import it (${tst.length}) - run these after:`,
    ...tst.slice(0, CAP).map((d) => `  > ${d.file}`), ...more(tst.length));
  if (b.security.length) L.push('', `Security findings (${b.security.length}):`,
    ...b.security.slice(0, CAP).map((s) => `  ! ${s.rule}${s.severity ? ` [${s.severity}]` : ''}${s.line ? ` line ${s.line}` : ''}`), ...more(b.security.length));
  L.push('', 'What Rune cannot tell you:', ...b.notes.map((n) => `  - ${n}`));
  return L.join('\n');
}
