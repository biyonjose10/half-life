/**
 * Builds the vector index over the published-content corpus.
 *
 * Run once after the library corpus changes:  npm run index
 * The result is cached to corpus/library/index.json and committed, so a clone
 * can run the engine without re-embedding (and without an API key for the
 * retrieval half of the pipeline).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv } from '../lib/load-env';
import { embedTexts, EMBED_DIM, EMBED_MODEL } from '../lib/gemini';
import { VectorIndex, type IndexEntry } from '../lib/vector';
import type { Asset } from '../lib/pipeline/types';

const root = process.cwd();
loadEnv(root);

async function main() {
  const assets = JSON.parse(
    readFileSync(join(root, 'corpus/library/assets.json'), 'utf8'),
  ) as Asset[];

  const entries: IndexEntry[] = [];
  const texts: string[] = [];

  for (const asset of assets) {
    for (const seg of asset.segments) {
      entries.push({ assetId: asset.id, segmentIdx: seg.idx });
      // Heading gives the segment context it otherwise lacks - a bare code
      // block embeds poorly without knowing which step it belongs to.
      texts.push(seg.heading ? `${asset.title}\n${seg.heading}\n\n${seg.text}` : `${asset.title}\n\n${seg.text}`);
    }
  }

  console.log(`embedding ${texts.length} segments from ${assets.length} assets...`);
  const vectors = await embedTexts(texts, 'RETRIEVAL_DOCUMENT', (done, total) => {
    process.stdout.write(`\r  ${done}/${total}`);
  });
  process.stdout.write('\n');

  const index = VectorIndex.build(entries, vectors, EMBED_DIM, EMBED_MODEL);
  index.save(root);
  console.log(`indexed ${index.size} segments, dim ${index.dim}, model ${index.model}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
