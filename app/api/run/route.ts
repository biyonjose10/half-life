/**
 * Streams a pipeline run to the browser as Server-Sent Events.
 *
 * The UI is meant to show the engine working rather than spin and then dump a
 * result, so every stage event is flushed as it happens. Errors are pushed as
 * events too - a demo that fails visibly is worth far more than one that hangs.
 */

import { runPipeline } from '@/lib/pipeline/run';
import type { PipelineEvent } from '@/lib/pipeline/types';

// Reads the corpus from disk, so this cannot run on the edge runtime.
export const runtime = 'nodejs';

// A full run is ~50s of mostly model latency. Without this the platform's
// default timeout cuts the stream off mid-adjudication.
export const maxDuration = 300;

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: PipelineEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true; // client went away mid-run
        }
      };

      try {
        await runPipeline(process.cwd(), send);
      } catch (err) {
        send({
          type: 'error',
          stage: 'diff',
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        if (!closed) controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      // Stops proxies buffering the stream into one delivery at the end.
      'X-Accel-Buffering': 'no',
    },
  });
}
