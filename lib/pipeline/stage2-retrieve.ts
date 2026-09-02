/**
 * Stage 2 - cross-corpus retrieval.
 *
 * Connects the two corpora: for each fact extracted from the source of truth,
 * find the published segments that depend on it.
 *
 * Two methods, because neither alone is enough:
 *
 *   exact    - the fact's pattern literally appears in the segment. These are
 *              certainties, not guesses, and they carry the bulk of the recall.
 *   semantic - vector similarity against the fact. Catches passages that
 *              *describe* the old behaviour without naming it ("add a subtle
 *              shadow to the card"), which a regex can never reach.
 *
 * Both feed Stage 3, which decides whether a candidate is actually stale.
 * Over-retrieving here is cheap; missing a segment is not recoverable.
 */

import { embedTexts } from '../gemini';
import type { VectorIndex } from '../vector';
import type { Asset, Candidate, ChangedFact, Segment } from './types';

/** Semantic hits below this cosine score are noise for this corpus. */
const MIN_SEMANTIC_SCORE = 0.62;
/**
 * Semantic hits kept per fact, after exact matches are excluded. Held at 3
 * deliberately: every extra candidate becomes a Stage 3 model call, and the
 * whole run has to finish inside a serverless function's time budget. Exact
 * matches are uncapped because they are certainties.
 */
const SEMANTIC_TOP_K = 3;
/** Characters of context kept either side of a match. */
const SNIPPET_PAD = 220;

function snippetAround(text: string, at: number, len: number): string {
  const start = Math.max(0, at - SNIPPET_PAD);
  const end = Math.min(text.length, at + len + SNIPPET_PAD);
  return (start > 0 ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '');
}

/** The text we embed to represent a fact when searching the library. */
function factQuery(fact: ChangedFact): string {
  const target = fact.new ? ` It is replaced by ${fact.new}.` : '';
  return `${fact.old}${target} ${fact.detail}`.replace(/\s+/g, ' ').slice(0, 1200);
}

export interface RetrieveOptions {
  onProgress?: (done: number, total: number) => void;
  /** Set false to skip embedding entirely (exact matches only). */
  semantic?: boolean;
}

export async function retrieveCandidates(
  facts: ChangedFact[],
  assets: Asset[],
  index: VectorIndex | null,
  opts: RetrieveOptions = {},
): Promise<Candidate[]> {
  const semanticEnabled = opts.semantic !== false && index !== null;
  const candidates: Candidate[] = [];
  const taken = new Set<string>(); // `${factId}|${assetId}|${segmentIdx}`

  const segmentOf = new Map<string, { asset: Asset; seg: Segment }>();
  for (const asset of assets) {
    for (const seg of asset.segments) {
      segmentOf.set(`${asset.id}|${seg.idx}`, { asset, seg });
    }
  }

  // --- exact ---------------------------------------------------------------
  for (const fact of facts) {
    let re: RegExp;
    try {
      re = new RegExp(fact.pattern, 'g');
    } catch {
      continue; // verify-stage1 guards this, but never let one bad pattern stop a run
    }
    for (const asset of assets) {
      for (const seg of asset.segments) {
        re.lastIndex = 0;
        const m = re.exec(seg.text);
        if (!m) continue;
        const key = `${fact.id}|${asset.id}|${seg.idx}`;
        taken.add(key);
        candidates.push({
          factId: fact.id,
          assetId: asset.id,
          segmentIdx: seg.idx,
          method: 'exact',
          score: 1,
          snippet: snippetAround(seg.text, m.index, m[0].length),
        });
      }
    }
  }

  // --- semantic ------------------------------------------------------------
  if (semanticEnabled) {
    const queries = facts.map(factQuery);
    const vectors = await embedTexts(queries, 'RETRIEVAL_QUERY', opts.onProgress);

    facts.forEach((fact, i) => {
      for (const hit of index!.search(vectors[i], SEMANTIC_TOP_K * 3, MIN_SEMANTIC_SCORE)) {
        const key = `${fact.id}|${hit.assetId}|${hit.segmentIdx}`;
        if (taken.has(key)) continue; // already a certainty
        const found = segmentOf.get(`${hit.assetId}|${hit.segmentIdx}`);
        if (!found) continue;
        taken.add(key);
        candidates.push({
          factId: fact.id,
          assetId: hit.assetId,
          segmentIdx: hit.segmentIdx,
          method: 'semantic',
          score: hit.score,
          snippet: snippetAround(found.seg.text, 0, Math.min(found.seg.text.length, 400)),
        });
        if (candidates.filter((c) => c.factId === fact.id && c.method === 'semantic').length >= SEMANTIC_TOP_K) break;
      }
    });
  }

  // Exact first, then by score - Stage 3 spends its budget on certainties.
  candidates.sort((a, b) => {
    if (a.method !== b.method) return a.method === 'exact' ? -1 : 1;
    return b.score - a.score;
  });
  return candidates;
}
