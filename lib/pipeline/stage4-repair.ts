/**
 * Stage 4 - repair.
 *
 * Turns each confirmed finding into something the creator can act on today:
 * the corrected line, and a pinned comment they can post under the published
 * piece without re-recording or rewriting it.
 *
 * The model rewrites only the sentence Stage 3 already proved is stale, and is
 * given the new form from the source of truth rather than being asked to recall
 * it. Its job here is phrasing, not facts.
 */

import { generateJSON } from '../gemini';
import type { Asset, ChangedFact, Finding, Repair } from './types';

const BATCH = 6;
const CONCURRENCY = 12;

const SYSTEM = `You repair stale lines in published software tutorials.

For each item you get the exact stale sentence and the documented change that
broke it. Produce:

- corrected: the same sentence rewritten so it is correct under the new version.
  Keep the author's voice, formatting and level of detail. Change only what the
  documented change requires. Do not add commentary or version numbers that were
  not there.
- pinnedComment: one or two sentences the author can post as a pinned comment or
  editor's note, telling readers what changed and what to do instead. Write it
  to the reader, plainly, with no marketing tone and no apology.`;

const SCHEMA = {
  type: 'object',
  properties: {
    repairs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ref: { type: 'integer' },
          corrected: { type: 'string' },
          pinnedComment: { type: 'string' },
        },
        required: ['ref', 'corrected', 'pinnedComment'],
      },
    },
  },
  required: ['repairs'],
} as const;

interface RawRepair {
  ref: number;
  corrected: string;
  pinnedComment: string;
}

async function pool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        await worker(items[i]);
      }
    }),
  );
}

export interface RepairOptions {
  onRepair?: (repair: Repair) => void;
  onProgress?: (done: number, total: number) => void;
  /** Called when a finding is withdrawn because its repair changed nothing. */
  onRetract?: (finding: Finding, reason: string) => void;
}

/**
 * The repairer double-checks the adjudicator.
 *
 * A rewrite identical to the original means nothing about that line needed to
 * change, so the finding was wrong. This catches confident errors a confidence
 * threshold cannot: the false positive that prompted it scored 1.00 and quoted
 * a plain `npm install` line, and the "fix" came back byte-identical.
 */
function isNoOp(corrected: string, original: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  return norm(corrected) === norm(original);
}

export async function repair(
  findings: Finding[],
  facts: ChangedFact[],
  assets: Asset[],
  opts: RepairOptions = {},
): Promise<{ repairs: Repair[]; retracted: Finding[] }> {
  const factById = new Map(facts.map((f) => [f.id, f]));
  const titleById = new Map(assets.map((a) => [a.id, a.title]));

  const groups = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = groups.get(f.factId) ?? [];
    list.push(f);
    groups.set(f.factId, list);
  }

  const batches: { fact: ChangedFact; items: Finding[] }[] = [];
  for (const [factId, list] of groups) {
    const fact = factById.get(factId);
    if (!fact) continue;
    for (let i = 0; i < list.length; i += BATCH) {
      batches.push({ fact, items: list.slice(i, i + BATCH) });
    }
  }

  const repairs: Repair[] = [];
  const retracted: Finding[] = [];
  let done = 0;

  await pool(batches, CONCURRENCY, async ({ fact, items }) => {
    const list = items
      .map(
        (f, i) =>
          `--- ITEM ${i} ---\ntutorial: ${titleById.get(f.assetId) ?? f.assetId}\n` +
          `stale sentence: ${f.staleSentence}\nwhy it is stale: ${f.why}`,
      )
      .join('\n\n');

    const prompt = `# The documented change

Old form: ${fact.old}
New form: ${fact.new ?? '(removed with no direct replacement)'}
Severity: ${fact.severity} - ${fact.severityReason}
Details: ${fact.detail}
Source of truth: ${fact.evidence.file}:${fact.evidence.line} - "${fact.evidence.quote}"

# Items to repair

${list}

Return one repair per item, using \`ref\` for the ITEM number.`;

    let results: RawRepair[] = [];
    try {
      const res = await generateJSON<{ repairs: RawRepair[] }>(prompt, SCHEMA, {
        system: SYSTEM,
        temperature: 0.2,
      });
      results = res.repairs ?? [];
    } catch {
      results = [];
    }

    for (const r of results) {
      const f = items[r.ref];
      if (!f || !r.corrected?.trim()) continue;

      if (isNoOp(r.corrected, f.staleSentence)) {
        const reason =
          'the rewrite was identical to the original, so nothing on this line ' +
          'actually depended on the change';
        retracted.push(f);
        opts.onRetract?.(f, reason);
        continue;
      }

      const out: Repair = {
        factId: f.factId,
        assetId: f.assetId,
        segmentIdx: f.segmentIdx,
        corrected: r.corrected.trim(),
        pinnedComment: r.pinnedComment.trim(),
      };
      repairs.push(out);
      opts.onRepair?.(out);
    }

    opts.onProgress?.(++done, batches.length);
  });

  return { repairs, retracted };
}
