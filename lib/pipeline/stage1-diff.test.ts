/**
 * Tests for the deterministic half of the engine.
 *
 * Everything here runs against the real corpus and makes no network calls -
 * which is the point. If stage 1 ever needs a key to be tested, its invariant
 * has been broken.
 */

import { describe, expect, it } from 'vitest';
import { extractChangedFacts, v4UtilitySurface } from './stage1-diff';
import { containsVerbatim } from './stage3-adjudicate';

const root = process.cwd();
const facts = extractChangedFacts(root);

describe('extractChangedFacts', () => {
  it('extracts facts from all four extractors', () => {
    const sources = new Set(facts.map((f) => f.source));
    expect(sources).toContain('upgrade-guide-rename-table');
    expect(sources).toContain('upgrade-guide-removal-table');
    expect(sources).toContain('upgrade-guide-codeblock');
    expect(sources).toContain('upgrade-guide-prose');
  });

  it('is byte-for-byte reproducible', () => {
    expect(JSON.stringify(extractChangedFacts(root))).toBe(
      JSON.stringify(extractChangedFacts(root)),
    );
  });

  it('grounds every fact in a real quote and line', () => {
    for (const f of facts) {
      expect(f.evidence.file).toBeTruthy();
      expect(f.evidence.line).toBeGreaterThan(0);
      expect(f.evidence.quote.length).toBeGreaterThan(0);
    }
  });

  it('gives every fact a compilable search pattern', () => {
    for (const f of facts) {
      expect(() => new RegExp(f.pattern, 'g')).not.toThrow();
    }
  });
});

describe('severity is derived, not asserted', () => {
  const byOld = (old: string) => facts.find((f) => f.old === old);

  it('marks a rename silent when the old name survives with a new meaning', () => {
    // v3 `shadow` became v4 `shadow-sm`, so `shadow-sm` still resolves.
    const fact = byOld('shadow-sm');
    expect(fact?.severity).toBe('silent');
  });

  it('names which v3 utility displaced the old one', () => {
    // Without this the model describes the change backwards: v4 `shadow-sm`
    // renders what v3 called `shadow`, which is larger, not smaller.
    expect(byOld('shadow-sm')?.severityReason).toContain('`shadow`');
    expect(byOld('blur-sm')?.severityReason).toContain('`blur`');
  });

  it('marks a removal breaking when nothing in v4 answers to the old name', () => {
    const removed = facts.find((f) => f.old.startsWith('bg-opacity'));
    expect(removed?.severity).toBe('breaking');
  });

  it('treats tailwind.config.js as silent, because v4 still reads it on request', () => {
    const config = byOld('tailwind.config.js');
    expect(config).toBeDefined();
    expect(config?.severity).toBe('silent');
  });

  it('finds both silent and breaking changes', () => {
    expect(facts.filter((f) => f.severity === 'silent').length).toBeGreaterThan(5);
    expect(facts.filter((f) => f.severity === 'breaking').length).toBeGreaterThan(5);
  });
});

describe('fact deduplication', () => {
  it('has no duplicate ids', () => {
    expect(new Set(facts.map((f) => f.id)).size).toBe(facts.length);
  });

  it('drops a prose fact subsumed by a more specific one', () => {
    // `@tailwind` is picked up from prose, but the code-block extractor already
    // captured `@tailwind base; @tailwind components; ...` -> `@import`.
    const bare = facts.find((f) => f.source === 'upgrade-guide-prose' && f.old === '@tailwind');
    expect(bare).toBeUndefined();
    expect(facts.some((f) => f.old.includes('@tailwind base;'))).toBe(true);
  });
});

describe('v4UtilitySurface', () => {
  const surface = v4UtilitySurface(root);

  it('reads utility names from the real v4 source', () => {
    expect(surface.size).toBeGreaterThan(50);
    expect(surface.has('outline-none')).toBe(true);
  });

  it('ignores CSS property names that merely appear in the file', () => {
    // `flex-shrink` occurs as a declaration and in a doc comment, but is not a
    // declared utility. Counting it would wrongly make a change look silent.
    expect(surface.has('flex-shrink')).toBe(false);
  });
});

describe('containsVerbatim', () => {
  const passage = 'Run the init command to create a new tailwind.config.js file:';

  it('accepts a quote that is present', () => {
    expect(containsVerbatim(passage, 'create a new tailwind.config.js file')).toBe(true);
  });

  it('ignores differences in whitespace', () => {
    expect(containsVerbatim(passage, 'create   a new\n  tailwind.config.js  file')).toBe(true);
  });

  it('rejects a paraphrase - the check that stops invented evidence', () => {
    expect(containsVerbatim(passage, 'make a fresh tailwind config file')).toBe(false);
  });

  it('rejects a quote too short to be evidence of anything', () => {
    expect(containsVerbatim(passage, 'Run')).toBe(false);
  });
});
