/**
 * Running the engine against a document it has never seen.
 *
 * The corpus path loads a committed library and a cached vector index. A live
 * page has neither, so its segments are embedded on the spot into a transient
 * index. Everything downstream is unchanged: the same four stages, the same
 * facts, the same verbatim-quote enforcement. A page the extension is looking
 * at is treated exactly like a corpus article, which is the point - there is no
 * second, weaker code path to audit.
 */

import { embedTexts, EMBED_DIM, EMBED_MODEL } from '../gemini';
import { VectorIndex, type IndexEntry } from '../vector';
import { documentToAsset, type DocumentInput } from '../segment';
import type { Asset } from './types';

/** Segments beyond this are ignored, to keep one check inside its time budget. */
const MAX_SEGMENTS = 120;

export interface LiveLibrary {
  assets: Asset[];
  index: VectorIndex | null;
  /**
   * Set when the index could not be built. The caller must surface this: a
   * check that quietly ran on exact matches only has weaker recall, and
   * reporting "nothing stale" without saying so is the failure mode this
   * project exists to avoid.
   */
  warning?: string;
}

/**
 * Builds the one-document library. `semantic: false` skips embedding entirely,
 * which keeps the check working (exact matches only) when the API is
 * unavailable - the same degradation the corpus path already has.
 */
export async function buildLiveLibrary(
  input: DocumentInput,
  opts: { semantic?: boolean } = {},
): Promise<LiveLibrary> {
  const asset = documentToAsset(input);
  if (asset.segments.length > MAX_SEGMENTS) {
    asset.segments = asset.segments.slice(0, MAX_SEGMENTS);
  }

  if (opts.semantic === false || asset.segments.length === 0) {
    return { assets: [asset], index: null };
  }

  const entries: IndexEntry[] = asset.segments.map((s) => ({
    assetId: asset.id,
    segmentIdx: s.idx,
  }));
  const texts = asset.segments.map((s) =>
    s.heading ? `${asset.title}\n${s.heading}\n\n${s.text}` : `${asset.title}\n\n${s.text}`,
  );

  try {
    const vectors = await embedTexts(texts, 'RETRIEVAL_DOCUMENT');
    return {
      assets: [asset],
      index: VectorIndex.build(entries, vectors, EMBED_DIM, EMBED_MODEL),
    };
  } catch (err) {
    // Exact matching alone still carries most of the recall, so the check goes
    // ahead - but never silently. Stage 2 emits nothing here because it was
    // handed a null index rather than failing itself, so the caller reports it.
    return {
      assets: [asset],
      index: null,
      warning: `semantic retrieval unavailable, checked with exact matches only: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}
