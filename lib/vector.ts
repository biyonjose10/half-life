/**
 * In-process vector index over the published-content corpus.
 *
 * Why not a hosted vector DB: the library corpus is ~1k segments. A network
 * round-trip per query would add latency and a live failure mode to a demo
 * for a search that is a single pass over a few megabytes of memory. The
 * index is built once, cached to disk, and loaded at startup.
 *
 * The interface is deliberately narrow (build / load / search) so swapping in
 * a hosted store later touches this file only.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const INDEX_PATH = 'corpus/library/index.json';

export interface IndexEntry {
  assetId: string;
  segmentIdx: number;
}

export interface SearchHit extends IndexEntry {
  score: number;
}

interface SerialisedIndex {
  dim: number;
  model: string;
  entries: IndexEntry[];
  /** Float32 vectors, base64 - roughly 4x smaller than JSON numbers. */
  vectors: string;
}

export class VectorIndex {
  private constructor(
    readonly dim: number,
    readonly model: string,
    private readonly entries: IndexEntry[],
    private readonly data: Float32Array,
  ) {}

  get size(): number {
    return this.entries.length;
  }

  static build(
    entries: IndexEntry[],
    vectors: number[][],
    dim: number,
    model: string,
  ): VectorIndex {
    const data = new Float32Array(entries.length * dim);
    vectors.forEach((v, i) => data.set(v, i * dim));
    return new VectorIndex(dim, model, entries, data);
  }

  save(root: string): void {
    const payload: SerialisedIndex = {
      dim: this.dim,
      model: this.model,
      entries: this.entries,
      vectors: Buffer.from(this.data.buffer).toString('base64'),
    };
    writeFileSync(join(root, INDEX_PATH), JSON.stringify(payload));
  }

  static load(root: string): VectorIndex | null {
    const path = join(root, INDEX_PATH);
    if (!existsSync(path)) return null;
    const raw = JSON.parse(readFileSync(path, 'utf8')) as SerialisedIndex;
    const buf = Buffer.from(raw.vectors, 'base64');
    const data = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    return new VectorIndex(raw.dim, raw.model, raw.entries, data);
  }

  /**
   * Cosine similarity against a unit-length query vector. Vectors are stored
   * normalised, so this is a dot product.
   */
  search(query: number[], topK: number, minScore: number): SearchHit[] {
    const hits: SearchHit[] = [];
    for (let i = 0; i < this.entries.length; i++) {
      const base = i * this.dim;
      let dot = 0;
      for (let d = 0; d < this.dim; d++) dot += this.data[base + d] * query[d];
      if (dot >= minScore) hits.push({ ...this.entries[i], score: dot });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, topK);
  }
}
