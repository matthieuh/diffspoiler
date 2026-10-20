import { RULES_VERSION } from '@diffspoiler/core/rules';
import type { Breakdown } from '@diffspoiler/core/types';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBreakdownCache } from '../src/lib/cache';

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
    expect(await cache.get('k', 'sha1')).toBeNull();
    await cache.set('k', 'sha1', breakdown(1));
    expect(await cache.get('k', 'sha1')).toEqual(breakdown(1));
    expect(await cache.get('k', 'sha2')).toBeNull();
  });

  it('evicts the oldest entry when exceeding max', async () => {
    const cache = createBreakdownCache({ max: 200 });
    for (let i = 0; i < 201; i++) {
      await cache.set(`k${i}`, 's', breakdown(i));
    }
    expect(await cache.get('k0', 's')).toBeNull();
    expect(await cache.get('k1', 's')).toEqual(breakdown(1));
    expect(await cache.get('k200', 's')).toEqual(breakdown(200));
  });

  it('only evicts cache: keys', async () => {
    await fakeBrowser.storage.local.set({ 'github.token': 'ghp_x' });
    const cache = createBreakdownCache({ max: 1 });
    await cache.set('a', 's', breakdown(1));
    await cache.set('b', 's', breakdown(2));
    expect((await fakeBrowser.storage.local.get('github.token'))['github.token']).toBe('ghp_x');
  });

  it('never reads entries stored under another RULES_VERSION', async () => {
    await fakeBrowser.storage.local.set({
      [`cache:${RULES_VERSION + 1}:k`]: { headSha: 's', at: 1, breakdown: breakdown(9) },
    });
    expect(await createBreakdownCache().get('k', 's')).toBeNull();
  });

  it('treats storage failures as a miss and ignores write failures', async () => {
    vi.spyOn(browser.storage.local, 'get').mockRejectedValue(new Error('boom'));
    vi.spyOn(browser.storage.local, 'set').mockRejectedValue(new Error('boom'));
    const cache = createBreakdownCache();
    expect(await cache.get('k', 's')).toBeNull();
    await expect(cache.set('k', 's', breakdown(1))).resolves.toBeUndefined();
  });
});
