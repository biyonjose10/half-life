/**
 * The recorded run the site opens on.
 *
 * Written by `npm run snapshot` and committed, so a visitor sees a real result
 * immediately without triggering ~75 model calls of spend. The live run is one
 * button away and clearly distinguished - what is shown is always labelled with
 * how it was produced.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Asset, ChangedFact, Finding, Repair } from './pipeline/types';

export interface RunSnapshot {
  generatedAt: string;
  elapsedMs: number;
  facts: ChangedFact[];
  assets: Asset[];
  findings: Finding[];
  repairs: Repair[];
}

export const SNAPSHOT_PATH = 'corpus/library/last-run.json';

/** Returns null when no snapshot is committed - the console then starts idle. */
export function loadSnapshot(root: string = process.cwd()): RunSnapshot | null {
  const path = join(root, SNAPSHOT_PATH);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as RunSnapshot;
  } catch {
    return null;
  }
}
