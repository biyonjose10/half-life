/**
 * Records one real corpus run and commits it as the page's opening state.
 *
 * Every visit used to trigger a live run: ~75 model calls and real spend, per
 * click, on a key shared with another deployment. A handful of curious visitors
 * could exhaust the month's budget and leave the site looking broken at exactly
 * the moment it is being judged.
 *
 * So the site now opens on a recorded run - instant, free, and honestly
 * labelled with when it was taken - and the live run stays one button away.
 *
 *   npm run snapshot
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv } from '../lib/load-env';
import { extractChangedFacts } from '../lib/pipeline/stage1-diff';
import { runPipeline } from '../lib/pipeline/run';
import type { Asset, PipelineEvent } from '../lib/pipeline/types';

const root = process.cwd();
loadEnv(root);

export const SNAPSHOT_PATH = 'corpus/library/last-run.json';

async function main() {
  const started = Date.now();
  const facts = extractChangedFacts(root);

  let assets: Asset[] = [];
  const { findings, repairs } = await runPipeline(
    root,
    (e: PipelineEvent) => {
      if (e.type === 'assets') assets = e.assets;
      if (e.type === 'stage-start') process.stdout.write(`\n[${e.stage}] `);
      if (e.type === 'stage-progress') process.stdout.write('.');
      if (e.type === 'stage-done') process.stdout.write(` ${e.count} in ${e.ms}ms`);
      if (e.type === 'error') process.stdout.write(`\n  ERROR ${e.stage}: ${e.message}`);
    },
  );

  if (!findings.length) {
    console.error('\nRefusing to record a run with no findings - check the API key.');
    process.exit(1);
  }

  const snapshot = {
    generatedAt: new Date().toISOString(),
    elapsedMs: Date.now() - started,
    facts,
    // Only the segments a finding actually points at survive, and their text is
    // dropped. The report reads nothing from a segment but its heading, and this
    // file is inlined into the first response - 1063 segments would be 90KB of
    // payload nobody reads.
    assets: assets.map((a) => ({
      ...a,
      segments: a.segments
        .filter((s) => findings.some((f) => f.assetId === a.id && f.segmentIdx === s.idx))
        .map((s) => ({ ...s, text: '' })),
    })),
    findings,
    repairs,
  };

  writeFileSync(join(root, SNAPSHOT_PATH), JSON.stringify(snapshot), 'utf8');
  console.log(
    `\n\nrecorded ${findings.length} findings across ` +
      `${new Set(findings.map((f) => f.assetId)).size} assets -> ${SNAPSHOT_PATH}`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
