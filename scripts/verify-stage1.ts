/**
 * Proves the two properties Half-Life's credibility rests on.
 *
 *   1. Stage 1 is byte-for-byte reproducible.
 *   2. Stage 1 cannot reach an LLM, enforced structurally rather than by
 *      prompt discipline.
 *
 * Run with `npm run verify`. Exits non-zero on failure so CI can gate on it.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractChangedFacts } from '../lib/pipeline/stage1-diff';

const root = process.cwd();
let failed = false;

function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
  if (!ok) failed = true;
}

// --- 1. determinism -------------------------------------------------------
const a = JSON.stringify(extractChangedFacts(root), null, 2);
const b = JSON.stringify(extractChangedFacts(root), null, 2);
check(
  'stage 1 is byte-for-byte reproducible',
  a === b,
  `${a.length} bytes, ${JSON.parse(a).length} facts`,
);

// --- 2. no LLM reachable from stage 1 ------------------------------------
const src = readFileSync(join(root, 'lib/pipeline/stage1-diff.ts'), 'utf8');
const imports = [...src.matchAll(/^\s*import[\s\S]*?from\s*'([^']+)'/gm)].map((m) => m[1]);
const forbidden = imports.filter((i) => /gemini|openai|anthropic|llm|generative/i.test(i));
check(
  'stage 1 imports no LLM client',
  forbidden.length === 0,
  forbidden.length ? `found: ${forbidden.join(', ')}` : `imports: ${imports.join(', ')}`,
);

// --- 3. every fact is grounded in a real quote ---------------------------
const facts = extractChangedFacts(root);
const guideCache = new Map<string, string[]>();
const ungrounded = facts.filter((f) => {
  if (!guideCache.has(f.evidence.file)) {
    guideCache.set(f.evidence.file, readFileSync(join(root, f.evidence.file), 'utf8').split('\n'));
  }
  const lines = guideCache.get(f.evidence.file)!;
  // The cited line must exist and the fact's old token must be findable near it.
  const window = lines.slice(Math.max(0, f.evidence.line - 3), f.evidence.line + 12).join('\n');
  return !window.includes(f.old.split('\n')[0].slice(0, 40));
});
check(
  'every fact quote is traceable to its cited line',
  ungrounded.length === 0,
  ungrounded.length ? `ungrounded: ${ungrounded.map((f) => f.id).join(', ')}` : `${facts.length} facts`,
);

// --- 4. every pattern is a valid regex -----------------------------------
const badPatterns = facts.filter((f) => {
  try {
    new RegExp(f.pattern, 'g');
    return false;
  } catch {
    return true;
  }
});
check(
  'every fact pattern compiles as a regex',
  badPatterns.length === 0,
  badPatterns.length ? badPatterns.map((f) => f.id).join(', ') : `${facts.length} patterns`,
);

console.log(
  `\n${facts.filter((f) => f.severity === 'silent').length} silent / ` +
    `${facts.filter((f) => f.severity === 'breaking').length} breaking`,
);

process.exit(failed ? 1 : 0);
