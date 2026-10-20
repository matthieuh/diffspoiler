import { describe, expect, it } from 'vitest';
import { computeBreakdown } from '../src/breakdown.ts';
import { BUCKET_ORDER } from '../src/rules.ts';
import type { FileStat } from '../src/types.ts';

function mulberry32(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PATH_POOL = [
  'src/a.ts',
  'src/a.test.ts',
  'evals/x.json',
  'pnpm-lock.yaml',
  'img/logo.png',
  'src/migration/1700-add.ts',
  'packages/x/eval/fixtures/a.json',
  'e2e/login.ts',
  'README.md',
  'src/api.generated.ts',
];

describe('computeBreakdown', () => {
  it('sums lines and files per bucket', () => {
    const files: FileStat[] = [
      { path: 'src/a.ts', additions: 10, deletions: 2 },
      { path: 'src/a.test.ts', additions: 5, deletions: 1 },
      { path: 'evals/x.json', additions: 100, deletions: 0 },
      { path: 'pnpm-lock.yaml', additions: 40, deletions: 40 },
    ];

    const breakdown = computeBreakdown(files);

    expect(breakdown.buckets).toEqual([
      { id: 'runtime', additions: 10, deletions: 2, fileCount: 1 },
      { id: 'tests', additions: 5, deletions: 1, fileCount: 1 },
      { id: 'evals', additions: 100, deletions: 0, fileCount: 1 },
      { id: 'other', additions: 40, deletions: 40, fileCount: 1 },
    ]);
    expect(breakdown.total).toEqual({ additions: 155, deletions: 43, fileCount: 4 });
  });

  it('total equals the sum of buckets', () => {
    const random = mulberry32(42);
    const files: FileStat[] = Array.from({ length: 500 }, () => ({
      path: PATH_POOL[Math.floor(random() * PATH_POOL.length)] ?? '',
      additions: Math.floor(random() * 1000),
      deletions: Math.floor(random() * 1000),
    }));

    const { buckets, total } = computeBreakdown(files);
    const sum = (key: 'additions' | 'deletions' | 'fileCount') =>
      buckets.reduce((acc, bucket) => acc + bucket[key], 0);

    expect(total.additions).toBe(sum('additions'));
    expect(total.deletions).toBe(sum('deletions'));
    expect(total.fileCount).toBe(sum('fileCount'));
    expect(total.fileCount).toBe(files.length);
  });

  it('keeps empty buckets in fixed order', () => {
    const breakdown = computeBreakdown([]);

    expect(breakdown.buckets.map((bucket) => bucket.id)).toEqual([...BUCKET_ORDER]);
    expect(breakdown.buckets.every((bucket) => bucket.additions === 0 && bucket.deletions === 0 && bucket.fileCount === 0)).toBe(true);
    expect(breakdown.total).toEqual({ additions: 0, deletions: 0, fileCount: 0 });
  });

  it('binary file counts as a file with 0 lines', () => {
    const breakdown = computeBreakdown([{ path: 'img/logo.png', additions: 0, deletions: 0 }]);

    expect(breakdown.buckets[0]).toEqual({ id: 'runtime', additions: 0, deletions: 0, fileCount: 1 });
  });

  it('passes uncountedFiles through, clamped', () => {
    expect(computeBreakdown([], 3).uncountedFiles).toBe(3);
    expect(computeBreakdown([], -2).uncountedFiles).toBe(0);
  });
});
