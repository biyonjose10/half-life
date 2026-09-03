import { describe, expect, it } from 'vitest';
import { documentToAsset, segmentMarkdown, segmentText } from './segment';

describe('segmentMarkdown', () => {
  const doc = `---
title: Ignore me
---

# Install

Run the command below.

\`\`\`sh
npm install tailwindcss
\`\`\`

## Configure

Edit the config file.`;

  const segments = segmentMarkdown(doc);

  it('drops front matter', () => {
    expect(segments.some((s) => s.text.includes('Ignore me'))).toBe(false);
  });

  it('carries the enclosing heading onto each segment', () => {
    expect(segments.find((s) => s.text.includes('Run the command'))?.heading).toBe('Install');
    expect(segments.find((s) => s.text.includes('Edit the config'))?.heading).toBe('Configure');
  });

  it('keeps fenced code as its own segment', () => {
    const code = segments.find((s) => s.kind === 'code');
    expect(code?.text).toContain('npm install tailwindcss');
  });

  it('numbers segments contiguously from zero', () => {
    expect(segments.map((s) => s.idx)).toEqual(segments.map((_, i) => i));
  });
});

describe('segmentText', () => {
  // What the extension actually sends: innerText, with no markdown markers.
  const page = `Setting up Tailwind

after installing tailwind there is configuration needed

Install the package

    npm install tailwindcss postcss autoprefixer`;

  const segments = segmentText(page);

  it('treats a short unpunctuated line as a heading, not content', () => {
    expect(segments.some((s) => s.text === 'Setting up Tailwind')).toBe(false);
    expect(segments[0].heading).toBe('Setting up Tailwind');
  });

  it('detects indented command blocks as code', () => {
    const code = segments.find((s) => s.text.includes('npm install'));
    expect(code?.kind).toBe('code');
  });

  it('keeps ordinary prose as prose', () => {
    const prose = segments.find((s) => s.text.includes('after installing'));
    expect(prose?.kind).toBe('prose');
  });
});

describe('documentToAsset', () => {
  const text = 'Some heading\n\nA passage long enough to survive segmentation checks.';

  it('produces the same id for the same url, so repeat checks line up', () => {
    const a = documentToAsset({ text, url: 'https://example.com/a' });
    const b = documentToAsset({ text: `${text} plus more`, url: 'https://example.com/a' });
    expect(a.id).toBe(b.id);
  });

  it('distinguishes different urls', () => {
    const a = documentToAsset({ text, url: 'https://example.com/a' });
    const b = documentToAsset({ text, url: 'https://example.com/b' });
    expect(a.id).not.toBe(b.id);
  });

  it('falls back to the url when a page has no title', () => {
    const asset = documentToAsset({ text, url: 'https://example.com/a' });
    expect(asset.title).toBe('https://example.com/a');
  });

  it('honours the markdown format when asked', () => {
    const asset = documentToAsset({
      text: '# Heading\n\nBody text here.',
      format: 'markdown',
    });
    expect(asset.segments[0].heading).toBe('Heading');
  });
});
