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
  /**
   * Library to check. Defaults to the committed corpus. A live document -
   * a page the browser extension is looking at - is passed here instead, so
   * an arbitrary page runs through exactly the same four stages as a corpus
   * article rather than down a parallel code path.
   */
  assets?: Asset[];
  /**
   * Vector index over `assets`. Defaults to the cached corpus index. For a
   * live document the caller builds a transient one, since a page the engine
   * has never seen cannot be in the cache.
   */
  index?: VectorIndex | null;
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
  const assets = opts.assets ?? loadAssets(root);

  // The UI resolves finding ids against this. Segment text is dropped: the
  // corpus is >500KB and nothing in the report reads a segment but its heading.
  emit({
    type: 'assets',
    assets: assets.map((a) => ({
      ...a,
      segments: a.segments.map((s) => ({ ...s, text: '' })),
    })),
  });

  // --- stage 1: deterministic diff ----------------------------------------
  emit({ type: 'stage-start', stage: 'diff' });
  let t = Date.now();
  const facts = extractChangedFacts(root);
  emit({ type: 'facts', facts });
  emit({ type: 'stage-done', stage: 'diff', count: facts.length, ms: Date.now() - t });

  // --- stage 2: cross-corpus retrieval ------------------------------------
  emit({ type: 'stage-start', stage: 'retrieve' });
  t = Date.now();
  const index = opts.index !== undefined ? opts.index : VectorIndex.load(root);
  const onProgress = (done: number, total: number) =>
    emit({ type: 'stage-progress', stage: 'retrieve', done, total });

  let candidates;
  try {
    candidates = await retrieveCandidates(facts, assets, index, {
      semantic: opts.semantic !== false,
      onProgress,
    });
  } catch (err) {
    // Embeddings are the only network call in this stage. If they fail, exact
    // matching still works and carries most of the recall - a degraded report
    // beats no report, as long as the degradation is stated rather than hidden.
    emit({
      type: 'error',
      stage: 'retrieve',
      message: `semantic retrieval unavailable, falling back to exact matches only: ${
        err instanceof Error ? err.message : String(err)
      }`,
    });
    candidates = await retrieveCandidates(facts, assets, index, {
      semantic: false,
      onProgress,
    });
  }
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
      // Partial failure must never read as "nothing is stale".
      onFailures: (failedCount, total, sample) =>
        emit({
          type: 'error',
          stage: 'adjudicate',
          message: `${failedCount}/${total} batches failed - findings are incomplete. First error: ${sample}`,
        }),
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
      const outcome = await repair(findings, facts, assets, {
        onRepair: (r) => emit({ type: 'repair', repair: r }),
        onRetract: (f, reason) =>
          emit({
            type: 'retracted',
            factId: f.factId,
            assetId: f.assetId,
            segmentIdx: f.segmentIdx,
            reason,
          }),
        onProgress: (done, total) =>
          emit({ type: 'stage-progress', stage: 'repair', done, total }),
      });
      repairs = outcome.repairs;
      // A retracted finding is not a finding. Dropping it here keeps the
      // returned report, the snapshot and the UI counts in agreement.
      const dropped = new Set(
        outcome.retracted.map((f) => `${f.assetId}|${f.segmentIdx}|${f.factId}`),
      );
      if (dropped.size) {
        findings = findings.filter(
          (f) => !dropped.has(`${f.assetId}|${f.segmentIdx}|${f.factId}`),
        );
      }
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
