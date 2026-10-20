import type { Breakdown } from '@diffspoiler/core/types';
import { describe, expect, it } from 'vitest';
import { footnote, parsePageCounter } from '../../src/lib/ui/page-counter';

const b = (a: number, d: number): Breakdown => ({
  buckets: [],
  total: { additions: a, deletions: d, fileCount: 1 },
  uncountedFiles: 0,
});

describe('parsePageCounter', () => {
  it('parses comma separators', () => {
    expect(parsePageCounter('+1,234 −56')).toEqual({ additions: 1234, deletions: 56, capped: false });
  });
  it('parses narrow no-break space separators and ASCII minus', () => {
    expect(parsePageCounter('+1 234 -56')).toEqual({ additions: 1234, deletions: 56, capped: false });
  });
  it('detects capped counters', () => {
    expect(parsePageCounter('1000+')).toEqual({ additions: null, deletions: null, capped: true });
  });
  it('handles empty text', () => {
    expect(parsePageCounter('')).toEqual({ additions: null, deletions: null, capped: false });
  });
});

describe('footnote', () => {
  it('is null without a page counter or when equal', () => {
    expect(footnote(b(5, 2), null)).toBeNull();
    expect(footnote(b(5, 2), { additions: 5, deletions: 2, capped: false })).toBeNull();
  });
  it('explains a capped counter', () => {
    expect(footnote(b(5, 2), { additions: null, deletions: null, capped: true })).toBe(
      'The page shows a capped count; diffspoiler counted every changed file.',
    );
  });
  it('explains differing numbers', () => {
    expect(footnote(b(3285, 75478), { additions: 3000, deletions: 49876, capped: false })).toBe(
      'The page shows +3,000 −49,876; diffspoiler counted +3,285 −75,478 across all files.',
    );
  });
});
