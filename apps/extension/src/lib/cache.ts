import { RULES_VERSION } from '@diffspoiler/core/rules';
import type { Breakdown } from '@diffspoiler/core/types';
import { browser } from 'wxt/browser';

export interface BreakdownCache {
  get(key: string, headSha: string): Promise<Breakdown | null>;
  set(key: string, headSha: string, breakdown: Breakdown): Promise<void>;
}

interface Entry {
  headSha: string;
  at: number;
  breakdown: Breakdown;
}

const PREFIX = 'cache:';
const DEFAULT_MAX = 200;

export function createBreakdownCache(opts: { max?: number } = {}): BreakdownCache {
  const max = opts.max ?? DEFAULT_MAX;
  const storageKey = (key: string) => `${PREFIX}${RULES_VERSION}:${key}`;

  return {
    async get(key, headSha) {
      try {
        const name = storageKey(key);
        const entry = (await browser.storage.local.get(name))[name] as Entry | undefined;
        return entry && entry.headSha === headSha ? entry.breakdown : null;
      } catch {
        return null;
      }
    },

    async set(key, headSha, breakdown) {
      try {
        const name = storageKey(key);
        await browser.storage.local.set({ [name]: { headSha, at: Date.now(), breakdown } satisfies Entry });

        const all = await browser.storage.local.get(null);
        const cached = Object.entries(all)
          .filter(([k]) => k.startsWith(PREFIX))
          .map(([k, v]) => [k, (v as Entry).at] as const)
          .sort((a, b) => a[1] - b[1]);
        const excess = cached.length - max;
        if (excess > 0) {
          await browser.storage.local.remove(cached.slice(0, excess).map(([k]) => k));
        }
      } catch {
        // A cache failure must never reach the caller.
      }
    },
  };
}
