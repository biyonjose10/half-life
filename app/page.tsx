import type { Metadata } from 'next';

import { Console } from '@/components/Console';
import { loadSnapshot } from '@/lib/snapshot';

export const metadata: Metadata = {
  title: 'Half-Life — tutorial decay engine',
  description:
    'Finds published tutorials that have gone factually stale because the software they teach changed versions. Tailwind CSS v3 → v4.',
};

/**
 * The console.
 *
 * Everything interactive lives in `components/Console.tsx`; this stays a
 * server component so the page can own its metadata.
 *
 * Two notes on the data contract (`lib/pipeline/types.ts`):
 *
 *  1. No `PipelineEvent` carries `Asset` metadata, but the decay report needs
 *     a title, publish date and URL per `assetId`. The console therefore
 *     resolves ids against a local registry (currently the corpus snapshot in
 *     `lib/mock-events.ts`) and falls back to rendering the raw `assetId` when
 *     an id is unknown. If the pipeline later streams assets, swap the
 *     registry in `useEngineRun` for the event data - nothing else changes.
 *
 *  2. `Finding.segmentIdx` is used to look the `Segment` up on the asset, for
 *     the `heading` context shown on each finding.
 */
export default function Page() {
  // A recorded run, so the first view is instant and costs nothing. The live
  // run is one button away and the UI says which of the two you are looking at.
  return <Console snapshot={loadSnapshot()} />;
}
