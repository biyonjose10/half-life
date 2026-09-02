/**
 * Proves the engine fails *visibly*.
 *
 * A tool that reports "nothing is stale" because its model calls quietly failed
 * is worse than one that crashes: the creator walks away believing their
 * back-catalogue is clean. This runs the pipeline with a deliberately invalid
 * API key and asserts that the failure is surfaced as an error event, and that
 * the deterministic stage still produces its facts regardless.
 *
 *   npm run verify:degraded
 */

import { runPipeline } from '../lib/pipeline/run';
import type { PipelineEvent } from '../lib/pipeline/types';

process.env.GEMINI_API_KEY = 'deliberately-invalid-key';

const events: PipelineEvent[] = [];
let failed = false;

function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
  if (!ok) failed = true;
}

async function main() {
  await runPipeline(process.cwd(), (e) => events.push(e));

  const errors = events.filter((e) => e.type === 'error');
  const diffDone = events.find((e) => e.type === 'stage-done' && e.stage === 'diff');
  const retrieveDone = events.find((e) => e.type === 'stage-done' && e.stage === 'retrieve');
  const done = events.find((e) => e.type === 'done');

  check(
    'the run completes rather than hanging',
    Boolean(done),
    done ? 'done event received' : 'no done event',
  );
  check(
    'the failure is surfaced as an error event',
    errors.length > 0,
    errors.length ? errors.map((e) => (e as { stage: string }).stage).join(', ') : 'silent failure',
  );
  check(
    'stage 1 still produces facts without any API access',
    Boolean(diffDone && (diffDone as { count: number }).count > 0),
    diffDone ? `${(diffDone as { count: number }).count} facts` : 'none',
  );
  check(
    'retrieval degrades to exact matches instead of dying',
    Boolean(retrieveDone && (retrieveDone as { count: number }).count > 0),
    retrieveDone ? `${(retrieveDone as { count: number }).count} candidates` : 'none',
  );

  for (const e of errors) {
    const err = e as { stage: string; message: string };
    console.log(`      [${err.stage}] ${err.message.slice(0, 120)}`);
  }

  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.log('FAIL  the run threw instead of reporting the failure as an event');
  console.log(`      ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
