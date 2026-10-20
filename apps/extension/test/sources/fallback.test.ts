import { describe, expect, it, vi } from 'vitest';
import { withFallback } from '../../src/lib/sources/fallback';
import { AuthRequiredError, RateLimitedError, type StatsSource } from '../../src/lib/sources/types';

const head = (headSha: string) => ({ headSha, additions: 1, deletions: 0, fileCount: 1 });
const files = (path: string) => [{ path, additions: 1, deletions: 0 }];

type SpySource = StatsSource & { fetchHead: ReturnType<typeof vi.fn>; fetchFiles: ReturnType<typeof vi.fn> };

function source(name: string, fail?: Error): SpySource {
  return {
    fetchHead: vi.fn(async () => {
      if (fail) throw fail;
      return head(name);
    }),
    fetchFiles: vi.fn(async () => {
      if (fail) throw fail;
      return files(name);
    }),
  };
}

describe('withFallback', () => {
  it('uses the primary source and never builds the fallback when it succeeds', async () => {
    const create = vi.fn(() => source('session'));
    const combined = withFallback(source('rest'), create);

    expect(await combined.fetchHead()).toEqual(head('rest'));
    expect(await combined.fetchFiles()).toEqual(files('rest'));
    expect(create).not.toHaveBeenCalled();
  });

  it('retries both calls on one fallback when the primary needs auth', async () => {
    const fallback = source('session');
    const create = vi.fn(() => fallback);
    const combined = withFallback(source('rest', new AuthRequiredError()), create);
    const signal = new AbortController().signal;

    const [h, f] = await Promise.all([combined.fetchHead(), combined.fetchFiles(signal)]);

    expect(h).toEqual(head('session'));
    expect(f).toEqual(files('session'));
    expect(create).toHaveBeenCalledTimes(1);
    expect(fallback.fetchFiles).toHaveBeenCalledWith(signal);
  });

  it('falls back once the primary is rate-limited, on a single fallback instance', async () => {
    const create = vi.fn(() => source('session'));
    const combined = withFallback(source('rest', new RateLimitedError()), create);

    const [h, f] = await Promise.all([combined.fetchHead(), combined.fetchFiles()]);

    expect(h).toEqual(head('session'));
    expect(f).toEqual(files('session'));
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('does not fall back on other errors', async () => {
    const create = vi.fn(() => source('session'));
    const combined = withFallback(source('rest', new Error('GitHub request failed: 500')), create);

    await expect(combined.fetchHead()).rejects.toThrow('500');
    expect(create).not.toHaveBeenCalled();
  });

  it('surfaces the fallback AuthRequiredError (logged out of github.com)', async () => {
    const combined = withFallback(source('rest', new AuthRequiredError()), () =>
      source('session', new AuthRequiredError()),
    );
    await expect(combined.fetchHead()).rejects.toBeInstanceOf(AuthRequiredError);
  });
});
