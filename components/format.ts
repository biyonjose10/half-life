import type { ChangedFact } from '@/lib/pipeline/types';

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** `2022-05-24` -> `24 May 2022`. Parsed as UTC so it never shifts a day. */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** How long the content has been sitting there being wrong. */
export function ageSince(iso: string, now: Date = new Date()): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return '';
  let months =
    (now.getUTCFullYear() - y) * 12 + (now.getUTCMonth() + 1 - m) - (now.getUTCDate() < d ? 1 : 0);
  if (months < 1) return 'under a month';
  const years = Math.floor(months / 12);
  months = months % 12;
  if (!years) return `${months} mo`;
  return months ? `${years} yr ${months} mo` : `${years} yr`;
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A display-only regex for lighting up the changed token inside a verbatim
 * quote. Deliberately simpler than `fact.pattern` (no lookbehind, which is
 * still uneven across browsers) because this is decoration, not detection.
 */
export function highlightRegex(fact: ChangedFact): RegExp | null {
  if (fact.source === 'upgrade-guide-codeblock') {
    const alts = fact.old
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)
      .map(escapeRegex);
    if (!alts.length) return null;
    return new RegExp(`(${alts.join('|')})`, 'g');
  }
  const wildcard = fact.old.endsWith('-*');
  const base = escapeRegex(fact.old.replace(/-\*$/, ''));
  return new RegExp(`(${base}${wildcard ? '[\\w./]+' : ''}(?![\\w-]))`, 'g');
}

/** Split `text` into alternating plain / matched runs. */
export function splitOnMatches(text: string, re: RegExp | null): Array<[string, boolean]> {
  if (!re) return [[text, false]];
  const out: Array<[string, boolean]> = [];
  let last = 0;
  re.lastIndex = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) out.push([text.slice(last, at), false]);
    out.push([m[0], true]);
    last = at + m[0].length;
  }
  if (last < text.length) out.push([text.slice(last), false]);
  return out.length ? out : [[text, false]];
}
