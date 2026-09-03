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

export const CHECK_ENDPOINT = '/api/check';

export interface CheckPayload {
  url?: string;
  text?: string;
  title?: string;
}

/**
 * Streams a check of one caller-supplied document.
 *
 * `EventSource` cannot POST, so this reads the response body directly. There is
 * deliberately no mock fallback: if a check of a real page fails, saying so is
 * the only honest outcome - quietly replaying canned events would be a lie
 * about a document the user chose.
 */
export function openCheckStream(
  payload: CheckPayload,
  cb: RunStreamCallbacks,
): RunStreamHandle {
  const controller = new AbortController();
  let settled = false;

  const finish = (reason: EndReason, message?: string) => {
    if (settled) return;
    settled = true;
    cb.onEnd(reason, message);
  };

  void (async () => {
    let res: Response;
    try {
      res = await fetch(CHECK_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      finish('error', err instanceof Error ? err.message : 'Could not reach the engine.');
      return;
    }

    if (!res.ok || !res.body) {
      let message = `The engine returned HTTP ${res.status}.`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body.error) message = body.error;
      } catch {
        /* keep the status message */
      }
      finish('error', message);
      return;
    }

    cb.onSource('live');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by a blank line; a frame may arrive split
        // across chunks, so only complete ones are consumed.
        let split = buffer.indexOf('\n\n');
        while (split !== -1) {
          const frame = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          const line = frame.split('\n').find((l) => l.startsWith('data: '));
          if (line) {
            try {
              const event = JSON.parse(line.slice(6)) as PipelineEvent;
              cb.onEvent(event);
              if (event.type === 'done') {
                finish('complete');
                controller.abort();
                return;
              }
            } catch {
              /* skip an unparseable frame rather than killing the run */
            }
          }
          split = buffer.indexOf('\n\n');
        }
      }
      finish('complete');
    } catch (err) {
      if (controller.signal.aborted) finish('aborted');
      else finish('error', err instanceof Error ? err.message : 'The check stream failed.');
    }
  })();

  return {
    cancel: () => {
      controller.abort();
      finish('aborted');
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
