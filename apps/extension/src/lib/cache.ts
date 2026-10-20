import { RULES_VERSION } from '@diffspoiler/core/rules';
import type { Breakdown } from '@diffspoiler/core/types';
import { browser } from 'wxt/browser';
import type { PrHead } from './sources/types';

export interface BreakdownCache {
  get(key: string, head: PrHead): Promise<Breakdown | null>;
  set(key: string, head: PrHead, breakdown: Breakdown): Promise<void>;
}

// The head totals are part of the key: a retargeted PR/MR keeps its head SHA but changes its diff.
interface Entry extends PrHead {
  at: number;
  breakdown: Breakdown;
}

const PREFIX = 'cache:';
const DEFAULT_MAX = 200;

export function createBreakdownCache(opts: { max?: number } = {}): BreakdownCache {
  const max = opts.max ?? DEFAULT_MAX;
  const storageKey = (key: string) => `${PREFIX}${RULES_VERSION}:${key}`;

  return {
    async get(key, head) {
      try {
        const name = storageKey(key);
        const entry = (await browser.storage.local.get(name))[name] as Entry | undefined;
        const hit =
          entry &&
          entry.headSha === head.headSha &&
          entry.additions === head.additions &&
          entry.deletions === head.deletions &&
          entry.fileCount === head.fileCount;
        return hit ? entry.breakdown : null;
      } catch {
        return null;
      }
    },

    async set(key, head, breakdown) {
      try {
        const name = storageKey(key);
        await browser.storage.local.set({ [name]: { ...head, at: Date.now(), breakdown } satisfies Entry });

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
