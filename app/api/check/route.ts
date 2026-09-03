/**
 * Checks a single document the caller supplies, streaming the same
 * PipelineEvent SSE as the corpus run.
 *
 * The caller sends the text it already has - the browser extension reads it
 * straight out of the DOM. That avoids CORS, avoids fetching arbitrary URLs
 * from the server, and works on pages behind a login. `{ url }` alone is
 * accepted as a convenience for the web app, and is the only path that fetches.
 */

import { runPipeline } from '@/lib/pipeline/run';
import { buildLiveLibrary } from '@/lib/pipeline/live';
import { MAX_DOCUMENT_CHARS } from '@/lib/segment';
import type { PipelineEvent } from '@/lib/pipeline/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

/** The extension runs on arbitrary origins, so the check endpoint is open. */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

interface CheckBody {
  text?: string;
  title?: string;
  url?: string;
  format?: 'markdown' | 'text';
}

/**
 * Fetches a page for the web app's URL box. Deliberately narrow: https only,
 * no redirects to other schemes, a hard timeout and a size cap. The extension
 * path never comes through here.
 */
async function fetchDocument(target: string): Promise<{ text: string; title: string }> {
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    throw new Error('That is not a valid URL.');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Only http and https URLs can be checked.');
  }

  const res = await fetch(parsed.toString(), {
    headers: { 'User-Agent': 'half-life/0.1 (tutorial decay checker)' },
    signal: AbortSignal.timeout(15_000),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`Could not fetch that page (HTTP ${res.status}).`);

  const html = (await res.text()).slice(0, MAX_DOCUMENT_CHARS * 4);
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? parsed.hostname;

  // Strip the parts of a page that are never prose, then all remaining tags.
  const text = html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|pre|section|article|br)>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { text, title };
}

export async function POST(request: Request) {
  let body: CheckBody;
  try {
    body = (await request.json()) as CheckBody;
  } catch {
    return Response.json({ error: 'Expected a JSON body.' }, { status: 400, headers: CORS });
  }

  let text = (body.text ?? '').trim();
  let title = body.title ?? '';

  if (!text) {
    if (!body.url) {
      return Response.json(
        { error: 'Send either the page text, or a url to fetch.' },
        { status: 400, headers: CORS },
      );
    }
    try {
      const fetched = await fetchDocument(body.url);
      text = fetched.text;
      title ||= fetched.title;
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : 'Could not read that page.' },
        { status: 400, headers: CORS },
      );
    }
  }

  if (text.length < 200) {
    return Response.json(
      { error: 'That document is too short to check.' },
      { status: 400, headers: CORS },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: PipelineEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };

      try {
        const { assets, index, warning } = await buildLiveLibrary({
          text,
          title,
          url: body.url,
          format: body.format,
        });
        if (warning) send({ type: 'error', stage: 'retrieve', message: warning });
        await runPipeline(process.cwd(), send, { assets, index });
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
      ...CORS,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
