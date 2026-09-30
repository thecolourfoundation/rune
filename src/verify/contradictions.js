import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const PATH_RE = /^[\w.@-]+(?:\/[\w.@-]+)+\.[A-Za-z0-9]{1,5}$/;

function mdFiles(dir) {
  let out = '';
  try {
    out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', '*.md'],
      { cwd: dir, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  } catch { return []; }
  return out.split('\n').filter((f) => f && !f.startsWith('.rune/') && !f.includes('node_modules/'));
}

export function findContradictions(dir) {
  let scripts = null;
  try { scripts = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).scripts ?? {}; } catch {}
  const topDirs = new Set(fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name));
  const found = [];
  const add = (kind, file, line, detail) => found.push({ kind, file, line, detail });

  for (const md of mdFiles(dir)) {
    let text;
    try { text = fs.readFileSync(path.join(dir, md), 'utf8'); } catch { continue; }
    let fence = false;
    text.split('\n').forEach((raw, i) => {
      const line = i + 1;
      if (/^\s*(```|~~~)/.test(raw)) { fence = !fence; return; }
      const spans = fence ? [raw] : [...raw.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

      if (!fence) {
        for (const m of raw.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
          if (/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(m[1])) continue;
          const t = m[1].split('#')[0].split('?')[0];
          if (!t) continue;
          const abs = t.startsWith('/') ? path.join(dir, t) : path.join(dir, path.dirname(md), t);
          if (!fs.existsSync(abs)) add('broken_link', md, line, `link target not found: ${m[1]}`);
        }
      }
      for (const span of spans) {
        if (scripts) {
          for (const m of span.matchAll(/\bnpm run ([\w:.-]+)/g)) {
            if (!(m[1] in scripts)) add('missing_npm_script', md, line, `npm run ${m[1]} is documented but package.json has no such script`);
          }
          if (/\bnpm (?:t|test)\b/.test(span) && !('test' in scripts)) add('missing_npm_script', md, line, 'npm test is documented but package.json has no test script');
        }
        const p = span.trim();
        if (PATH_RE.test(p) && !/[*<>{}]/.test(p)) {
          const first = p.split('/')[0];
          if (topDirs.has(first) && first !== 'node_modules' && first !== '.rune' && !fs.existsSync(path.join(dir, p))) {
            add('missing_path', md, line, `possible: documented path does not exist: ${p}`);
          }
        }
      }
    });
  }
  return found;
}

export function formatContradictions(found) {
  if (!found.length) return 'DOC CONTRADICTIONS: none found (links, npm scripts and documented paths only)';
  const CAP = 30;
  const L = [`DOC CONTRADICTIONS (${found.length}): documentation that disagrees with the repo`, ''];
  for (const f of found.slice(0, CAP)) L.push(`  ${f.file}:${f.line} [${f.kind}] ${f.detail}`);
  if (found.length > CAP) L.push(`  ... and ${found.length - CAP} more`);
  return L.join('\n');
}
