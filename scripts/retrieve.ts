/** Dev harness for stage 2 - shows what the retrieval layer surfaces. */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv } from '../lib/load-env';
import { extractChangedFacts } from '../lib/pipeline/stage1-diff';
import { retrieveCandidates } from '../lib/pipeline/stage2-retrieve';
import { VectorIndex } from '../lib/vector';
import type { Asset } from '../lib/pipeline/types';

const root = process.cwd();
loadEnv(root);

async function main() {
  const assets = JSON.parse(
    readFileSync(join(root, 'corpus/library/assets.json'), 'utf8'),
  ) as Asset[];
  const facts = extractChangedFacts(root);
  const index = VectorIndex.load(root);

  const t0 = Date.now();
  const candidates = await retrieveCandidates(facts, assets, index, {
    semantic: !process.argv.includes('--no-semantic'),
  });
  const ms = Date.now() - t0;

  const exact = candidates.filter((c) => c.method === 'exact');
  const semantic = candidates.filter((c) => c.method === 'semantic');
  const assetsHit = new Set(candidates.map((c) => c.assetId));

  console.log(
    `\ncandidates: ${candidates.length}  (exact ${exact.length}, semantic ${semantic.length})`,
  );
  console.log(`assets touched: ${assetsHit.size}/${assets.length}   ${ms}ms\n`);

  const byFact = new Map<string, number>();
  for (const c of candidates) byFact.set(c.factId, (byFact.get(c.factId) ?? 0) + 1);
  const top = [...byFact.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);

  console.log('top facts by candidate count:');
  for (const [factId, n] of top) {
    const f = facts.find((x) => x.id === factId)!;
    console.log(`  ${String(n).padStart(3)}  [${f.severity}] ${factId.slice(0, 64)}`);
  }

  const zero = facts.filter((f) => !byFact.has(f.id));
  console.log(`\nfacts with no candidates (self-filtered out of the report): ${zero.length}`);

  const clean = assets.filter((a) => !assetsHit.has(a.id));
  console.log(`assets with zero candidates (clean controls): ${clean.length}`);
  for (const a of clean) console.log(`  ${a.id}  ${a.title.slice(0, 60)}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
