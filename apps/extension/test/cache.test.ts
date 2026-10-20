import { RULES_VERSION } from '@diffspoiler/core/rules';
import type { Breakdown } from '@diffspoiler/core/types';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBreakdownCache } from '../src/lib/cache';

const head = (headSha: string, additions = 1, deletions = 0, fileCount = 1) => ({
  headSha,
  additions,
  deletions,
  fileCount,
});

const breakdown = (additions: number): Breakdown => ({
  buckets: [],
  total: { additions, deletions: 0, fileCount: 1 },
  uncountedFiles: 0,
});

describe('breakdown cache', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    vi.restoreAllMocks();
  });

  it('misses when empty, hits on the same SHA, misses on another SHA', async () => {
    const cache = createBreakdownCache();
    expect(await cache.get('k', head('sha1'))).toBeNull();
    await cache.set('k', head('sha1'), breakdown(1));
    expect(await cache.get('k', head('sha1'))).toEqual(breakdown(1));
    expect(await cache.get('k', head('sha2'))).toBeNull();
  });

  it('misses when the head totals differ under the same SHA (base changed)', async () => {
    const cache = createBreakdownCache();
    await cache.set('k', head('sha1', 10, 5, 3), breakdown(1));
    expect(await cache.get('k', head('sha1', 11, 5, 3))).toBeNull();
    expect(await cache.get('k', head('sha1', 10, 6, 3))).toBeNull();
    expect(await cache.get('k', head('sha1', 10, 5, 4))).toBeNull();
    expect(await cache.get('k', head('sha1', 10, 5, 3))).toEqual(breakdown(1));
  });

  it('evicts the oldest entry when exceeding max', async () => {
    const cache = createBreakdownCache({ max: 200 });
    for (let i = 0; i < 201; i++) {
      await cache.set(`k${i}`, head('s'), breakdown(i));
    }
    expect(await cache.get('k0', head('s'))).toBeNull();
    expect(await cache.get('k1', head('s'))).toEqual(breakdown(1));
    expect(await cache.get('k200', head('s'))).toEqual(breakdown(200));
  });

  it('only evicts cache: keys', async () => {
    await fakeBrowser.storage.local.set({ 'github.token': 'ghp_x' });
    const cache = createBreakdownCache({ max: 1 });
    await cache.set('a', head('s'), breakdown(1));
    await cache.set('b', head('s'), breakdown(2));
    expect((await fakeBrowser.storage.local.get('github.token'))['github.token']).toBe('ghp_x');
  });

  it('never reads entries stored under another RULES_VERSION', async () => {
    await fakeBrowser.storage.local.set({
      [`cache:${RULES_VERSION + 1}:k`]: { headSha: 's', additions: 1, deletions: 0, fileCount: 1, at: 1, breakdown: breakdown(9) },
    });
    expect(await createBreakdownCache().get('k', head('s'))).toBeNull();
  });

  it('treats storage failures as a miss and ignores write failures', async () => {
    vi.spyOn(browser.storage.local, 'get').mockRejectedValue(new Error('boom'));
    vi.spyOn(browser.storage.local, 'set').mockRejectedValue(new Error('boom'));
    const cache = createBreakdownCache();
    expect(await cache.get('k', head('s'))).toBeNull();
    await expect(cache.set('k', head('s'), breakdown(1))).resolves.toBeUndefined();
  });
});
