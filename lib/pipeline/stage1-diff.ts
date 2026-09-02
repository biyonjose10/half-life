/**
 * Stage 1 - change extraction.
 *
 * THIS FILE MUST NOT IMPORT AN LLM CLIENT.
 *
 * Everything Half-Life later claims about a piece of published content bottoms
 * out in a fact produced here, and every fact carries a verbatim quote and a
 * line number from a real source-of-truth file. Because this stage is pure
 * string processing, the engine cannot invent a change that did not happen -
 * the worst it can do is miss one. That boundary is the whole credibility of
 * the project, so it is enforced structurally (no import) rather than by
 * prompt discipline.
 *
 * Determinism: the output is sorted by id and derives no value from iteration
 * order, wall-clock time, or randomness. Two runs over the same inputs produce
 * byte-identical JSON. `npm run verify:determinism` proves it.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChangedFact, Evidence, FactSource, Severity } from './types';

const GUIDE = 'corpus/truth/upgrade-guide.mdx';
const V4_UTILITIES = 'corpus/truth/v4/utilities.ts';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Strip the JSX noise the docs wrap table cells in. */
function cellText(cell: string): string {
  return cell
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstCode(cell: string): string | null {
  const m = cell.match(/<code[^>]*>([\s\S]*?)<\/code>/);
  return m ? m[1].replace(/<[^>]+>/g, '').trim() : null;
}

/** Section body between a `### Heading` and the next `###`. */
function section(text: string, heading: string): { body: string; offset: number } | null {
  const start = text.indexOf(`### ${heading}`);
  if (start === -1) return null;
  const after = text.indexOf('\n### ', start + 1);
  const end = after === -1 ? text.length : after;
  return { body: text.slice(start, end), offset: start };
}

// ---------------------------------------------------------------------------
// v4 utility surface - the "did this token survive?" oracle
// ---------------------------------------------------------------------------

/**
 * Utility names declared in the v4 source. Derived from the framework itself,
 * not from the upgrade guide, so it can contradict the guide's prose.
 *
 * Only declaration sites count. A bare substring search would report
 * `flex-shrink` as surviving because the string appears in a CSS declaration
 * and a doc comment, which is exactly the false positive this avoids.
 */
export function v4UtilitySurface(root: string): Set<string> {
  const src = readFileSync(join(root, V4_UTILITIES), 'utf8');
  const re =
    /(?:staticUtility|functionalUtility|utilities\.static|utilities\.functional)\(\s*'([^']+)'/g;
  const names = new Set<string>();
  for (const m of src.matchAll(re)) names.add(m[1]);
  return names;
}

// ---------------------------------------------------------------------------
// extractors
// ---------------------------------------------------------------------------

interface RawPair {
  old: string;
  replacement: string | null;
  detail: string;
  evidence: Evidence;
  source: FactSource;
  kind: 'renamed' | 'removed' | 'behaviour-changed';
  /** Set when the source text itself states the old form still works. */
  silentHint?: string;
}

/** `### Renamed utilities` - a two-column v3 -> v4 table. */
function extractRenames(guide: string): RawPair[] {
  const sec = section(guide, 'Renamed utilities');
  if (!sec) return [];
  const out: RawPair[] = [];
  for (const row of sec.body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const cells = [...row[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
    if (cells.length !== 2) continue;
    const from = firstCode(cells[0]);
    const to = firstCode(cells[1]);
    if (!from || !to) continue;
    const abs = sec.offset + (row.index ?? 0);
    out.push({
      old: from,
      replacement: to,
      detail: `\`${from}\` was renamed to \`${to}\` in v4.`,
      source: 'upgrade-guide-rename-table',
      kind: 'renamed',
      evidence: {
        file: GUIDE,
        line: lineOf(guide, abs),
        quote: `${from} → ${to}`,
      },
    });
  }
  return out;
}

/** `### Removed deprecated utilities` - deprecated -> modern alternative. */
function extractRemovals(guide: string): RawPair[] {
  const sec = section(guide, 'Removed deprecated utilities');
  if (!sec) return [];
  const out: RawPair[] = [];
  for (const row of sec.body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const cells = [...row[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
    if (cells.length !== 2) continue;
    const from = firstCode(cells[0]);
    if (!from) continue;
    const advice = cellText(cells[1]);
    const abs = sec.offset + (row.index ?? 0);
    out.push({
      old: from,
      replacement: firstCode(cells[1]),
      detail: `\`${from}\` was removed in v4. ${advice}`,
      source: 'upgrade-guide-removal-table',
      kind: 'removed',
      evidence: { file: GUIDE, line: lineOf(guide, abs), quote: `${from} — ${advice}` },
    });
  }
  return out;
}

/**
 * Fenced code blocks annotated with `[!code --]` / `[!code ++]`, which mark
 * exactly which lines the docs consider before and after. One fact per fence
 * that has both sides; the match pattern is an alternation over the removed
 * lines so a single fact catches all three `@tailwind` directives.
 */
function extractCodeBlocks(guide: string): RawPair[] {
  const out: RawPair[] = [];
  const fence = /```[a-z]*\n([\s\S]*?)```/g;

  for (const block of guide.matchAll(fence)) {
    const body = block[1];
    const lines = body.split('\n');
    const removed: string[] = [];
    const added: string[] = [];
    let mode: 'none' | 'del' | 'add' = 'none';

    for (const raw of lines) {
      const line = raw.trim();
      if (/\[!code --/.test(line)) { mode = 'del'; continue; }
      if (/\[!code \+\+/.test(line)) { mode = 'add'; continue; }
      if (/\[!code /.test(line)) { mode = 'none'; continue; }
      if (!line) continue;
      if (mode === 'del') removed.push(line);
      else if (mode === 'add') added.push(line);
    }

    const keep = removed.filter((l) => l.length > 2 && !/^[/*<!-]+$/.test(l));
    if (!keep.length || !added.length) continue;

    // Skip blocks that only *illustrate* a rename the tables already cover.
    // The guide demonstrates `shadow-sm` with `<input class="shadow-sm" />`;
    // turning that into a fact would produce a pattern matching only the
    // guide's own example markup, never real published content.
    if (keep.every((l) => /class(?:Name)?\s*=\s*"/.test(l))) continue;

    const abs = block.index ?? 0;
    out.push({
      old: keep.join('\n'),
      replacement: added.join('\n'),
      detail: `v3 wrote:\n${keep.join('\n')}\n\nv4 requires:\n${added.join('\n')}`,
      source: 'upgrade-guide-codeblock',
      kind: 'behaviour-changed',
      evidence: { file: GUIDE, line: lineOf(guide, abs), quote: keep.join(' / ') },
    });
  }
  return out;
}

/**
 * Prose sections under `## Changes from v3`.
 *
 * The tables cover utility renames, but the highest-impact change in this
 * release is described only in prose: v4 no longer auto-detects
 * `tailwind.config.js`. Nearly every v3 tutorial opens by creating that file,
 * so missing it would miss the most common way published content went stale.
 *
 * We take inline-code tokens from prose lines (never from inside fences) and
 * keep only those shaped like a directive, a config filename, or a function -
 * identifiers specific enough that finding one in a tutorial means something.
 */
function extractProseSections(guide: string): RawPair[] {
  const anchor = guide.indexOf('## Changes from v3');
  if (anchor === -1) return [];

  // Phrases in which the docs state the v3 form still resolves. A change the
  // docs describe this way is silent: content keeps working while going wrong.
  const STILL_WORKS =
    /still supported|backward compatibility|no longer detected automatically|are preserved|still works/i;

  const IDENTIFIER = [
    /^@[a-z][a-z-]*$/, // directive:  @config, @apply, @layer
    /^[\w.-]+\.(?:js|cjs|mjs|ts|css)$/, // filename:   tailwind.config.js
    /^[a-z]+\(\)$/, // function:   theme()
  ];

  const out: RawPair[] = [];
  const seen = new Set<string>();

  for (const sec of guide.slice(anchor).split(/\n### /).slice(1)) {
    const heading = sec.split('\n')[0].trim();
    const absSection = anchor + guide.slice(anchor).indexOf(sec);

    // Prose only - track fences so code samples never contribute tokens.
    let inFence = false;
    const prose: string[] = [];
    for (const line of sec.split('\n').slice(1)) {
      if (line.trimStart().startsWith('```')) { inFence = !inFence; continue; }
      if (!inFence && line.trim()) prose.push(line);
    }
    if (!prose.length) continue;

    const proseText = prose.join('\n');
    const silentMatch = proseText.match(STILL_WORKS);

    // Config filenames are unambiguous identifiers, so unlike other tokens we
    // take them from the whole section including code fences. The one that
    // matters here - `tailwind.config.js` - is named only inside a fence, and
    // it is the single most common stale step in v3 tutorials.
    const configFiles = [...sec.matchAll(/[\w.-]*config[\w.-]*\.(?:js|cjs|mjs|ts)\b/gi)]
      .map((m) => m[0])
      .filter((f) => !seen.has(f));

    const tokens: Array<{ token: string; line: string }> = configFiles.map((token) => ({
      token,
      line:
        prose.find((l) => l.includes(token)) ??
        sec.split('\n').find((l) => l.includes(token))?.trim() ??
        token,
    }));

    for (const line of prose) {
      for (const m of line.matchAll(/`([^`\n]+)`/g)) {
        const token = m[1].trim();
        if (!IDENTIFIER.some((rx) => rx.test(token))) continue;
        tokens.push({ token, line });
      }
    }

    for (const { token, line } of tokens) {
      {
        if (seen.has(token)) continue;
        seen.add(token);

        out.push({
          old: token,
          replacement: null,
          detail: `${heading}: ${prose[0].trim()}`,
          source: 'upgrade-guide-prose',
          kind: 'behaviour-changed',
          silentHint: silentMatch
            ? `the upgrade guide states this is "${silentMatch[0]}" in v4`
            : undefined,
          evidence: {
            file: GUIDE,
            line: lineOf(guide, absSection + sec.indexOf(line)),
            quote: line.trim(),
          },
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// severity
// ---------------------------------------------------------------------------

/**
 * A change is `silent` when the old token still resolves in v4 but now means
 * something else. Published content then keeps working while teaching the
 * wrong result - no error, no broken build, just a quietly incorrect tutorial.
 *
 * Two independent deterministic signals, either sufficient:
 *   1. the old name is the *target* of another rename (v3 `shadow` became v4
 *      `shadow-sm`, so v3 `shadow-sm` still resolves - and now means what v3
 *      called `shadow`);
 *   2. the old name is still declared in the v4 utility source.
 */
function severityFor(
  old: string,
  renameTargets: Set<string>,
  surface: Set<string>,
  silentHint?: string,
): { severity: Severity; reason: string } {
  if (silentHint) {
    return {
      severity: 'silent',
      reason:
        `\`${old}\` still resolves in v4 - ${silentHint}. Published content ` +
        `using it keeps working while no longer doing what the tutorial claims.`,
    };
  }
  if (renameTargets.has(old)) {
    return {
      severity: 'silent',
      reason:
        `\`${old}\` is still valid in v4 - it is the new name for a different ` +
        `v3 utility. v3 content using it renders a different result with no error.`,
    };
  }
  if (surface.has(old)) {
    return {
      severity: 'silent',
      reason:
        `\`${old}\` is still declared in the v4 utility source with different ` +
        `behaviour, so v3 content using it fails silently rather than erroring.`,
    };
  }
  return {
    severity: 'breaking',
    reason: `\`${old}\` no longer resolves in v4, so the published step visibly fails.`,
  };
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

function makeId(source: FactSource, old: string, replacement: string | null): string {
  const short = source.replace('upgrade-guide-', '').replace('-table', '');
  const slug = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 60);
  return `${short}:${slug(old)}${replacement ? `->${slug(replacement)}` : ''}`;
}

/** Build the match pattern for finding this fact inside published content. */
function patternFor(pair: RawPair): string {
  if (pair.source === 'upgrade-guide-codeblock') {
    return pair.old
      .split('\n')
      .map((l) => escapeRegex(l.trim()))
      .filter(Boolean)
      .join('|');
  }
  if (pair.source === 'upgrade-guide-prose') {
    // Directives and filenames are literal; `theme()` matches any call.
    if (pair.old.endsWith('()')) return `${escapeRegex(pair.old.slice(0, -2))}\\s*\\(`;
    return `(?<![\\w-])${escapeRegex(pair.old)}(?![\\w-])`;
  }
  // Utility class names: match on a word boundary so `shadow-sm` does not also
  // match `drop-shadow-sm`. Trailing `-*` in the docs means "any suffix".
  const base = pair.old.replace(/-\*$/, '');
  const wildcard = pair.old.endsWith('-*');
  return `(?<![\\w-])${escapeRegex(base)}${wildcard ? '[\\w./]+' : ''}(?![\\w-])`;
}

export function extractChangedFacts(root: string = process.cwd()): ChangedFact[] {
  const guide = readFileSync(join(root, GUIDE), 'utf8');
  const surface = v4UtilitySurface(root);

  const renames = extractRenames(guide);
  const renameTargets = new Set(
    renames.map((r) => r.replacement).filter((x): x is string => Boolean(x)),
  );

  const pairs = [
    ...renames,
    ...extractRemovals(guide),
    ...extractCodeBlocks(guide),
    ...extractProseSections(guide),
  ];

  const seen = new Set<string>();
  const facts: ChangedFact[] = [];

  for (const p of pairs) {
    const id = makeId(p.source, p.old, p.replacement);
    if (seen.has(id)) continue;
    seen.add(id);

    const { severity, reason } = severityFor(p.old, renameTargets, surface, p.silentHint);
    facts.push({
      id,
      kind: p.kind,
      old: p.old,
      new: p.replacement,
      detail: p.detail,
      severity,
      severityReason: reason,
      source: p.source,
      evidence: p.evidence,
      pattern: patternFor(p),
    });
  }

  // Drop prose facts subsumed by a more specific one. The prose scan picks up
  // `@tailwind` from the same section where the code-block extractor already
  // captured `@tailwind base; @tailwind components; ...` -> `@import`. Both are
  // true, but reporting them separately double-counts one stale line.
  const specific = facts.filter((f) => f.source !== 'upgrade-guide-prose').map((f) => f.old);
  const deduped = facts.filter(
    (f) =>
      f.source !== 'upgrade-guide-prose' ||
      !specific.some((other) => other.includes(f.old)),
  );

  // Stable order - determinism is a property we demo, so it is enforced here.
  deduped.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return deduped;
}
