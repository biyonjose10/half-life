/**
 * The pipeline DAG.
 *
 * Four stages, wired explicitly rather than through an orchestration framework.
 * The dependency graph here is linear and the interesting behaviour is in the
 * stages, so a framework would add indirection without removing any.
 *
 * Every stage emits events as it goes; the API route forwards them to the UI as
 * SSE, and the CLI prints them. The engine being *watchable* is the point.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractChangedFacts } from './stage1-diff';
import { retrieveCandidates } from './stage2-retrieve';
import { adjudicate } from './stage3-adjudicate';
import { repair } from './stage4-repair';
import { VectorIndex } from '../vector';
import type { Asset, Finding, PipelineEvent, Repair } from './types';

export interface RunOptions {
  /** Skip the vector layer (exact matches only). Useful without an API key. */
  semantic?: boolean;
  /** Skip stage 4. */
  withRepairs?: boolean;
}

export function loadAssets(root: string): Asset[] {
  return JSON.parse(
    readFileSync(join(root, 'corpus/library/assets.json'), 'utf8'),
  ) as Asset[];
}

export async function runPipeline(
  root: string,
  emit: (event: PipelineEvent) => void,
  opts: RunOptions = {},
): Promise<{ findings: Finding[]; repairs: Repair[] }> {
  const assets = loadAssets(root);

  // --- stage 1: deterministic diff ----------------------------------------
  emit({ type: 'stage-start', stage: 'diff' });
  let t = Date.now();
  const facts = extractChangedFacts(root);
  emit({ type: 'facts', facts });
  emit({ type: 'stage-done', stage: 'diff', count: facts.length, ms: Date.now() - t });

  // --- stage 2: cross-corpus retrieval ------------------------------------
  emit({ type: 'stage-start', stage: 'retrieve' });
  t = Date.now();
  const index = VectorIndex.load(root);
  const candidates = await retrieveCandidates(facts, assets, index, {
    semantic: opts.semantic !== false,
    onProgress: (done, total) =>
      emit({ type: 'stage-progress', stage: 'retrieve', done, total }),
  });
  emit({ type: 'candidates', candidates });
  emit({
    type: 'stage-done',
    stage: 'retrieve',
    count: candidates.length,
    ms: Date.now() - t,
  });

  // --- stage 3: adjudication ----------------------------------------------
  emit({ type: 'stage-start', stage: 'adjudicate' });
  t = Date.now();
  let findings: Finding[] = [];
  try {
    findings = await adjudicate(candidates, facts, assets, {
      onFinding: (finding) => emit({ type: 'finding', finding }),
      onProgress: (done, total) =>
        emit({ type: 'stage-progress', stage: 'adjudicate', done, total }),
    });
  } catch (err) {
    emit({
      type: 'error',
      stage: 'adjudicate',
      message: err instanceof Error ? err.message : String(err),
    });
  }
  emit({
    type: 'stage-done',
    stage: 'adjudicate',
    count: findings.length,
    ms: Date.now() - t,
  });

  // --- stage 4: repair ----------------------------------------------------
  let repairs: Repair[] = [];
  if (opts.withRepairs !== false && findings.length) {
    emit({ type: 'stage-start', stage: 'repair' });
    t = Date.now();
    try {
      repairs = await repair(findings, facts, assets, {
        onRepair: (r) => emit({ type: 'repair', repair: r }),
        onProgress: (done, total) =>
          emit({ type: 'stage-progress', stage: 'repair', done, total }),
      });
    } catch (err) {
      emit({
        type: 'error',
        stage: 'repair',
        message: err instanceof Error ? err.message : String(err),
      });
    }
    emit({ type: 'stage-done', stage: 'repair', count: repairs.length, ms: Date.now() - t });
  }

  emit({
    type: 'done',
    staleAssets: new Set(findings.map((f) => f.assetId)).size,
    totalFindings: findings.length,
  });

  return { findings, repairs };
}
