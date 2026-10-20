import type { FileStat } from '@diffspoiler/core/types';
import { describe, expect, it, vi } from 'vitest';
import type { BreakdownCache } from '../src/lib/cache';
import { loadBreakdown } from '../src/lib/load-breakdown';
import type { PrRef } from '../src/lib/pr-ref';
import type { PrHead, StatsSource } from '../src/lib/sources/types';

const ref: PrRef = { host: 'github', repo: 'o/r', number: 1 };

function memoryCache(): BreakdownCache & { set: ReturnType<typeof vi.fn> } {
  const store = new Map<string, any>();
  return {
    get: vi.fn(async (key: string, sha: string) => {
      const e = store.get(key);
      return e && e.sha === sha ? e.b : null;
    }),
    set: vi.fn(async (key: string, sha: string, b) => {
      store.set(key, { sha, b });
    }),
  };
}

function source(head: PrHead, files: FileStat[]) {
  return { fetchHead: vi.fn(async () => head), fetchFiles: vi.fn(async (_signal?: AbortSignal) => files) } satisfies StatsSource;
}

const files = (n: number): FileStat[] =>
  Array.from({ length: n }, (_, i) => ({ path: `src/f${i}.ts`, additions: 2, deletions: 1 }));

describe('loadBreakdown', () => {
  it('returns the cached breakdown on a hit without awaiting files', async () => {
    const cache = memoryCache();
    const head = { headSha: 'a', additions: 6, deletions: 3, fileCount: 3 };
    await loadBreakdown(ref, source(head, files(3)), cache);
    const second = source(head, files(3));
    second.fetchFiles.mockImplementation(() => new Promise<FileStat[]>(() => {}));
    const loaded = await loadBreakdown(ref, second, cache);
    expect(second.fetchHead).toHaveBeenCalledTimes(1);
    expect(loaded.breakdown.total.additions).toBe(6);
    expect(loaded.head).toEqual(head);
  });

  it('aborts the files fetch on a cache hit', async () => {
    const cache = memoryCache();
    const head = { headSha: 'a', additions: 6, deletions: 3, fileCount: 3 };
    await loadBreakdown(ref, source(head, files(3)), cache);
    const second = source(head, files(3));
    await loadBreakdown(ref, second, cache);
    const signal = second.fetchFiles.mock.calls[0]![0]!;
    expect(signal.aborted).toBe(true);
  });

  it('does not abort the files fetch on a miss', async () => {
    const src = source({ headSha: 'a', additions: 0, deletions: 0, fileCount: 2 }, files(2));
    await loadBreakdown(ref, src, memoryCache());
    expect(src.fetchFiles.mock.calls[0]![0]!.aborted).toBe(false);
  });

  it('a rejecting fetchFiles on a cache hit causes no unhandled rejection', async () => {
    const cache = memoryCache();
    const head = { headSha: 'a', additions: 6, deletions: 3, fileCount: 3 };
    await loadBreakdown(ref, source(head, files(3)), cache);
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const second = source(head, files(3));
    second.fetchFiles.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 5));
      throw new Error('boom');
    });
    const loaded = await loadBreakdown(ref, second, cache);
    await new Promise((r) => setTimeout(r, 30));
    process.off('unhandledRejection', unhandled);
    expect(loaded.breakdown.total.additions).toBe(6);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('starts fetchHead and fetchFiles before either resolves', async () => {
    const started: string[] = [];
    const src: StatsSource = {
      fetchHead: vi.fn(async () => {
        started.push('head');
        await new Promise((r) => setTimeout(r, 5));
        return { headSha: 'a', additions: 0, deletions: 0, fileCount: 2 };
      }),
      fetchFiles: vi.fn(async () => {
        started.push('files');
        await new Promise((r) => setTimeout(r, 5));
        return files(2);
      }),
    };
    const pending = loadBreakdown(ref, src, memoryCache());
    expect(started).toEqual(['head', 'files']);
    await pending;
  });

  it('computes and stores on a miss, fetching each once', async () => {
    const cache = memoryCache();
    const src = source({ headSha: 'a', additions: 0, deletions: 0, fileCount: 2 }, files(2));
    const { breakdown } = await loadBreakdown(ref, src, cache);
    expect(src.fetchHead).toHaveBeenCalledTimes(1);
    expect(src.fetchFiles).toHaveBeenCalledTimes(1);
    expect(breakdown.total).toEqual({ additions: 4, deletions: 2, fileCount: 2 });
    expect(cache.set).toHaveBeenCalledWith('github:o/r#1', 'a', breakdown);
  });

  it('reports uncounted files when the page counter exceeds the files fetched', async () => {
    const src = source({ headSha: 'a', additions: 0, deletions: 0, fileCount: 3500 }, files(3000));
    const { breakdown } = await loadBreakdown(ref, src, memoryCache());
    expect(breakdown.uncountedFiles).toBe(500);
  });

  it('clamps uncountedFiles to 0 and sums totals from files when the head is capped lower', async () => {
    const src = source({ headSha: 'a', additions: 1, deletions: 1, fileCount: 3000 }, files(3285));
    const { breakdown } = await loadBreakdown(ref, src, memoryCache());
    expect(breakdown.uncountedFiles).toBe(0);
    expect(breakdown.total).toEqual({ additions: 3285 * 2, deletions: 3285, fileCount: 3285 });
  });
});
