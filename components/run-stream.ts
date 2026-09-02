'use client';

/**
 * Transport for a pipeline run.
 *
 * The console never talks to `EventSource` directly. It asks for a stream and
 * gets one of two things back:
 *
 *   - `live`: a real SSE connection to `/api/run`
 *   - `mock`: a timed replay of `lib/mock-events.ts`
 *
 * The mock is used when `NEXT_PUBLIC_MOCK=1`, and also as an automatic
 * fallback when the live stream errors before delivering its first event -
 * which is what happens today, because the route does not exist yet. Once the
 * route lands, nothing in the UI has to change.
 */

import { mockEvents } from '@/lib/mock-events';
import type { PipelineEvent } from '@/lib/pipeline/types';

export type StreamSource = 'live' | 'mock';
export type EndReason = 'complete' | 'aborted' | 'error';

export interface RunStreamCallbacks {
  onEvent: (event: PipelineEvent) => void;
  /** Fires once, as soon as we know which transport is actually in use. */
  onSource: (source: StreamSource) => void;
  onEnd: (reason: EndReason, message?: string) => void;
}

export interface RunStreamHandle {
  cancel: () => void;
}

export const RUN_ENDPOINT = '/api/run';

/** Build-time flag, inlined by Next. */
export const MOCK_FORCED = process.env.NEXT_PUBLIC_MOCK === '1';

/**
 * Inter-event delay, in ms. Substantive events land in the 200-700ms band the
 * demo is paced around; the progress ticks that accompany them are quicker so
 * a counter and its bar move together rather than lagging.
 */
function delayFor(event: PipelineEvent): number {
  switch (event.type) {
    case 'stage-progress':
      return 70 + Math.random() * 90;
    case 'stage-start':
      return 320 + Math.random() * 280;
    case 'stage-done':
      return 300 + Math.random() * 260;
    case 'facts':
    case 'candidates':
      return 240 + Math.random() * 300;
    case 'finding':
      return 200 + Math.random() * 500;
    case 'repair':
      return 200 + Math.random() * 340;
    case 'done':
      return 420;
    default:
      return 300;
  }
}

function replayMock(cb: RunStreamCallbacks, speed: number): RunStreamHandle {
  const events = mockEvents();
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let i = 0;

  const step = () => {
    if (cancelled) return;
    const event = events[i++];
    cb.onEvent(event);
    if (i >= events.length) {
      cb.onEnd('complete');
      return;
    }
    timer = setTimeout(step, delayFor(events[i]) / speed);
  };

  timer = setTimeout(step, 300 / speed);

  return {
    cancel: () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    },
  };
}

export interface OpenRunStreamOptions {
  /** Replay multiplier for the mock transport. 1 = real-time. */
  speed?: number;
}

export function openRunStream(
  cb: RunStreamCallbacks,
  { speed = 1 }: OpenRunStreamOptions = {},
): RunStreamHandle {
  if (MOCK_FORCED || typeof EventSource === 'undefined') {
    cb.onSource('mock');
    return replayMock(cb, speed);
  }

  let inner: RunStreamHandle | null = null;
  let settled = false;
  let received = false;
  let cancelled = false;

  let source: EventSource;
  try {
    source = new EventSource(RUN_ENDPOINT);
  } catch {
    cb.onSource('mock');
    return replayMock(cb, speed);
  }

  const close = () => {
    try {
      source.close();
    } catch {
      /* already closed */
    }
  };

  source.onopen = () => {
    if (!settled && !received) cb.onSource('live');
  };

  source.onmessage = (message: MessageEvent<string>) => {
    if (cancelled || settled) return;
    if (!received) {
      received = true;
      cb.onSource('live');
    }
    let parsed: PipelineEvent;
    try {
      parsed = JSON.parse(message.data) as PipelineEvent;
    } catch {
      return;
    }
    cb.onEvent(parsed);
    if (parsed.type === 'done') {
      settled = true;
      close();
      cb.onEnd('complete');
    }
  };

  source.onerror = () => {
    if (cancelled || settled) return;
    close();
    if (!received) {
      // The route is not there (or died on connect): fall back to the mock so
      // the console is always demoable.
      cb.onSource('mock');
      inner = replayMock(cb, speed);
      return;
    }
    settled = true;
    cb.onEnd('error', 'The run stream disconnected before finishing.');
  };

  return {
    cancel: () => {
      cancelled = true;
      settled = true;
      close();
      inner?.cancel();
    },
  };
}
