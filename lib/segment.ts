/**
 * Splitting a document into addressable blocks.
 *
 * A segment is the unit Half-Life can point a creator at and say "this line is
 * now wrong" - the article analogue of a video timestamp. Retrieval, the
 * verbatim-quote check and the UI all key off the same blocks, so this is the
 * single definition of how a document is divided.
 *
 * Two shapes of input:
 *
 *   markdown  - the corpus path. Mirrors `scripts/corpus/build_library.py`, so
 *               a document segmented here is segmented identically there.
 *   text      - the live path. The browser extension sends `innerText`, which
 *               has no fences and no `#` markers, so headings are inferred.
 */

import type { Asset, Segment } from './pipeline/types';

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;

/**
 * A heading in extracted page text.
 *
 * Short and unpunctuated is not enough on its own: "after installing tailwind
 * there is configuration needed" is a 53-character sentence with no full stop,
 * and `npm install tailwindcss postcss autoprefixer` is a command. Both were
 * being swallowed as headings and disappearing from the checked text.
 *
 * Requiring few words and an initial capital separates a real heading from a
 * lowercase sentence fragment or a shell command.
 */
const LOOKS_LIKE_HEADING = (line: string) => {
  const text = line.trim();
  if (!text || text.length >= 60) return false;
  if (/[.,;:!?]$/.test(text)) return false;
  if (text.split(/\s+/).length > 8) return false;
  return /^[A-Z0-9]/.test(text);
};

function push(segments: Segment[], heading: string, kind: Segment['kind'], buf: string[]): void {
  const text = buf.join('\n').trim();
  if (text) segments.push({ idx: segments.length, heading, kind, text });
  buf.length = 0;
}

/**
 * Markdown segmentation. Fenced code blocks become their own `code` segments;
 * prose is split on blank lines; `#` headings become the context carried by
 * every following segment.
 */
export function segmentMarkdown(body: string): Segment[] {
  const source = body.replace(FRONTMATTER, '');
  const segments: Segment[] = [];
  const buf: string[] = [];
  let heading = '';
  let inCode = false;

  for (const line of source.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      if (inCode) {
        buf.push(line);
        push(segments, heading, 'code', buf);
        inCode = false;
      } else {
        push(segments, heading, 'prose', buf);
        buf.push(line);
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      buf.push(line);
      continue;
    }
    if (line.startsWith('#')) {
      push(segments, heading, 'prose', buf);
      heading = line.replace(/^#+/, '').trim();
      continue;
    }
    if (!line.trim()) {
      push(segments, heading, 'prose', buf);
      continue;
    }
    buf.push(line);
  }
  push(segments, heading, 'prose', buf);
  return segments;
}

/**
 * Plain-text segmentation for extracted page text.
 *
 * Blank lines separate blocks. A short unpunctuated block is treated as a
 * heading for what follows rather than as content of its own. Blocks that look
 * like code - indented, or dense with the punctuation of markup and config -
 * are marked `code`, because the adjudicator reads that context differently.
 */
export function segmentText(text: string): Segment[] {
  const segments: Segment[] = [];
  let heading = '';

  for (const raw of text.replace(/\r\n/g, '\n').split(/\n\s*\n/)) {
    const block = raw.replace(/[ \t]+$/gm, '').trim();
    if (!block) continue;

    const lines = block.split('\n');
    if (lines.length === 1 && LOOKS_LIKE_HEADING(block)) {
      heading = block;
      continue;
    }

    const codeish =
      /^[ \t]{2,}/m.test(raw) ||
      /[{}<>;]|^\s*[$#>]\s|npm |npx |yarn /m.test(block);

    segments.push({
      idx: segments.length,
      heading,
      kind: codeish ? 'code' : 'prose',
      text: block,
    });
  }
  return segments;
}

export interface DocumentInput {
  text: string;
  title?: string;
  url?: string;
  /** Defaults to plain text - the extension path. */
  format?: 'markdown' | 'text';
}

/** Longest a submitted document may be. Keeps one run inside its time budget. */
export const MAX_DOCUMENT_CHARS = 200_000;

/**
 * Builds a one-document library for the engine to run against. The result is
 * an ordinary `Asset`, so every stage treats a live page exactly as it treats
 * a corpus article - there is no second code path.
 */
export function documentToAsset(input: DocumentInput): Asset {
  const text = input.text.slice(0, MAX_DOCUMENT_CHARS);
  const segments =
    input.format === 'markdown' ? segmentMarkdown(text) : segmentText(text);

  return {
    // Stable for the same URL so repeat checks of a page line up.
    id: input.url ? `live-${hash(input.url)}` : `live-${hash(text.slice(0, 2000))}`,
    title: input.title?.trim() || input.url || 'Untitled document',
    url: input.url ?? '',
    publishedAt: '',
    type: 'article',
    segments,
  };
}

/** Small stable non-cryptographic hash, for ids only. */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
