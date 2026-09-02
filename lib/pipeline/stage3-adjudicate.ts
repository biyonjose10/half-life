/**
 * Stage 3 - adjudication.
 *
 * Retrieval is deliberately loose, so most candidates are not actually stale:
 * a tutorial can mention `shadow-sm` in a sentence where the rename changes
 * nothing. This stage decides, per candidate, whether the passage genuinely
 * instructs the reader to do something that is now wrong.
 *
 * The model's output is not trusted on its own. Every STALE verdict must quote
 * the offending sentence *verbatim* from the segment, and that quote is checked
 * against the source text in code below. A verdict whose quote cannot be found
 * is discarded - the model does not get to invent the evidence for its own
 * finding.
 */

import { generateJSON } from '../gemini';
import type { Asset, Candidate, ChangedFact, Finding } from './types';

/** Candidates per model call. Batching cuts calls ~6x with no quality loss. */
const BATCH = 6;
/** Parallel in-flight calls. Keeps a full run in the tens of seconds. */
const CONCURRENCY = 12;
/** Below this, a STALE verdict is treated as too speculative to report. */
const MIN_CONFIDENCE = 0.55;

const SYSTEM = `You audit published software tutorials for factual decay.

You are given ONE documented change to a software library, and several passages
from tutorials published before that change. For each passage decide whether the
change makes the passage WRONG for a reader following it today.

Answer STALE only when following the passage would now produce a different or
broken result. Answer FINE when the passage merely mentions the topic, is
version-agnostic, already describes the new behaviour, or is unaffected prose.

When you answer STALE you MUST set staleSentence to a sentence or line copied
EXACTLY, character for character, from that passage. Never paraphrase it, never
merge two lines, never add or remove punctuation. If you cannot copy an exact
span, answer FINE. When you answer FINE, set staleSentence to an empty string.`;

const SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ref: { type: 'integer' },
          verdict: { type: 'string', enum: ['STALE', 'FINE'] },
          confidence: { type: 'number' },
          staleSentence: { type: 'string' },
          why: { type: 'string' },
        },
        required: ['ref', 'verdict', 'confidence', 'staleSentence', 'why'],
      },
    },
  },
  required: ['results'],
} as const;

interface RawResult {
  ref: number;
  verdict: 'STALE' | 'FINE';
  confidence: number;
  staleSentence: string;
  why: string;
}

/** Whitespace-insensitive containment - models normalise indentation. */
function containsVerbatim(haystack: string, needle: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const n = norm(needle);
  return n.length >= 8 && norm(haystack).includes(n);
}

async function pool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await worker(items[i], i);
      }
    }),
  );
  return out;
}

export interface AdjudicateOptions {
  onFinding?: (finding: Finding) => void;
  onProgress?: (done: number, total: number) => void;
}

export async function adjudicate(
  candidates: Candidate[],
  facts: ChangedFact[],
  assets: Asset[],
  opts: AdjudicateOptions = {},
): Promise<Finding[]> {
  const factById = new Map(facts.map((f) => [f.id, f]));
  const segText = new Map<string, string>();
  const segHeading = new Map<string, string>();
  for (const a of assets) {
    for (const s of a.segments) {
      segText.set(`${a.id}|${s.idx}`, s.text);
      segHeading.set(`${a.id}|${s.idx}`, s.heading);
    }
  }

  // Group by fact so each call carries one change and many passages.
  const groups = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const list = groups.get(c.factId) ?? [];
    list.push(c);
    groups.set(c.factId, list);
  }

  const batches: { fact: ChangedFact; items: Candidate[] }[] = [];
  for (const [factId, list] of groups) {
    const fact = factById.get(factId);
    if (!fact) continue;
    for (let i = 0; i < list.length; i += BATCH) {
      batches.push({ fact, items: list.slice(i, i + BATCH) });
    }
  }

  const findings: Finding[] = [];
  let done = 0;

  // Safety net for the case stage 1's fact dedup cannot see: two genuinely
  // distinct changes landing on the same sentence. Reporting it twice would
  // inflate the count and make the creator fix one line twice.
  const reported = new Set<string>();
  const sentenceKey = (assetId: string, idx: number, sentence: string) =>
    `${assetId}|${idx}|${sentence.replace(/\s+/g, ' ').trim().toLowerCase()}`;

  await pool(batches, CONCURRENCY, async ({ fact, items }) => {
    const passages = items
      .map((c, i) => {
        const key = `${c.assetId}|${c.segmentIdx}`;
        const heading = segHeading.get(key);
        return `--- PASSAGE ${i} ---\n${heading ? `(section: ${heading})\n` : ''}${(
          segText.get(key) ?? c.snippet
        ).slice(0, 2500)}`;
      })
      .join('\n\n');

    const prompt = `# The documented change

Old form: ${fact.old}
New form: ${fact.new ?? '(removed with no direct replacement)'}
Kind: ${fact.kind}
Severity: ${fact.severity} - ${fact.severityReason}
Details: ${fact.detail}
Source of truth: ${fact.evidence.file}:${fact.evidence.line} - "${fact.evidence.quote}"

# Passages to judge

${passages}

Return one result per passage, using \`ref\` for the PASSAGE number.`;

    let results: RawResult[] = [];
    try {
      const res = await generateJSON<{ results: RawResult[] }>(prompt, SCHEMA, {
        system: SYSTEM,
      });
      results = res.results ?? [];
    } catch {
      // One failed batch must not sink the run; the rest of the report stands.
      results = [];
    }

    for (const r of results) {
      const c = items[r.ref];
      if (!c) continue;
      if (r.verdict !== 'STALE') continue;
      if (r.confidence < MIN_CONFIDENCE) continue;

      // The check that stops the model inventing its own evidence.
      const source = segText.get(`${c.assetId}|${c.segmentIdx}`) ?? '';
      if (!containsVerbatim(source, r.staleSentence)) continue;

      const key = sentenceKey(c.assetId, c.segmentIdx, r.staleSentence);
      if (reported.has(key)) continue;
      reported.add(key);

      const finding: Finding = {
        factId: fact.id,
        assetId: c.assetId,
        segmentIdx: c.segmentIdx,
        verdict: 'STALE',
        confidence: r.confidence,
        staleSentence: r.staleSentence.trim(),
        why: r.why,
      };
      findings.push(finding);
      opts.onFinding?.(finding);
    }

    opts.onProgress?.(++done, batches.length);
  });

  findings.sort((a, b) =>
    a.assetId === b.assetId ? a.segmentIdx - b.segmentIdx : a.assetId < b.assetId ? -1 : 1,
  );
  return findings;
}
