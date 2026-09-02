/**
 * Runs the full engine from the CLI and prints the decay report.
 *
 *   npm run engine              full run
 *   npm run engine -- --no-repairs
 *   npm run engine -- --json    machine-readable output
 */

import { writeFileSync } from 'node:fs';
import { loadEnv } from '../lib/load-env';
import { extractChangedFacts } from '../lib/pipeline/stage1-diff';
import { runPipeline, loadAssets } from '../lib/pipeline/run';
import type { PipelineEvent } from '../lib/pipeline/types';

const root = process.cwd();
loadEnv(root);

const asJson = process.argv.includes('--json');

async function main() {
  const assets = loadAssets(root);
  const facts = extractChangedFacts(root);
  const factById = new Map(facts.map((f) => [f.id, f]));
  const assetById = new Map(assets.map((a) => [a.id, a]));

  const t0 = Date.now();
  const { findings, repairs } = await runPipeline(
    root,
    (e: PipelineEvent) => {
      if (asJson) return;
      if (e.type === 'stage-start') process.stdout.write(`\n[${e.stage}] `);
      if (e.type === 'stage-progress') process.stdout.write('.');
      if (e.type === 'stage-done') process.stdout.write(` ${e.count} in ${e.ms}ms`);
      if (e.type === 'error') process.stdout.write(`\n  ERROR ${e.stage}: ${e.message}`);
    },
    { withRepairs: !process.argv.includes('--no-repairs') },
  );
  const ms = Date.now() - t0;

  if (asJson) {
    writeFileSync('run.json', JSON.stringify({ facts, findings, repairs }, null, 2));
    console.log(`wrote run.json (${findings.length} findings)`);
    return;
  }

  const repairFor = new Map(
    repairs.map((r) => [`${r.assetId}|${r.segmentIdx}|${r.factId}`, r]),
  );

  const byAsset = new Map<string, typeof findings>();
  for (const f of findings) {
    const list = byAsset.get(f.assetId) ?? [];
    list.push(f);
    byAsset.set(f.assetId, list);
  }

  const ranked = [...byAsset.entries()].sort((a, b) => b[1].length - a[1].length);

  console.log(`\n\n${'='.repeat(72)}`);
  console.log(
    `DECAY REPORT - ${findings.length} stale passages across ${byAsset.size} of ` +
      `${assets.length} published tutorials   (${(ms / 1000).toFixed(1)}s)`,
  );
  console.log('='.repeat(72));

  for (const [assetId, list] of ranked) {
    const a = assetById.get(assetId)!;
    console.log(`\n${a.title}`);
    console.log(`  published ${a.publishedAt}  ${a.url}`);
    for (const f of list) {
      const fact = factById.get(f.factId)!;
      const tag = fact.severity === 'silent' ? 'SILENT ' : 'BREAKING';
      console.log(`\n  [${tag}] ${fact.old} -> ${fact.new ?? '(removed)'}`);
      console.log(`     stale: "${f.staleSentence.slice(0, 150)}"`);
      console.log(`     why:   ${f.why.slice(0, 150)}`);
      const r = repairFor.get(`${f.assetId}|${f.segmentIdx}|${f.factId}`);
      if (r) console.log(`     fix:   ${r.corrected.slice(0, 150)}`);
      console.log(`     cite:  ${fact.evidence.file}:${fact.evidence.line}`);
    }
  }

  const clean = assets.filter((a) => !byAsset.has(a.id));
  console.log(`\n${'-'.repeat(72)}`);
  console.log(`clean (no stale passages): ${clean.length} tutorials`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
