import { computeBreakdown } from '@diffspoiler/core/breakdown';
import type { Breakdown } from '@diffspoiler/core/types';
import type { BreakdownCache } from './cache';
import { type PrRef, prKey } from './pr-ref';
import type { PrHead, StatsSource } from './sources/types';

export interface Loaded {
  breakdown: Breakdown;
  head: PrHead;
}

export async function loadBreakdown(ref: PrRef, source: StatsSource, cache: BreakdownCache): Promise<Loaded> {
  const head = await source.fetchHead();
  const key = prKey(ref);

  const cached = await cache.get(key, head.headSha);
  if (cached) return { breakdown: cached, head };

  const files = await source.fetchFiles();
  // GitLab's page counter is capped at 3000 files and can be lower than what we fetched.
  const breakdown = computeBreakdown(files, Math.max(0, head.fileCount - files.length));
  await cache.set(key, head.headSha, breakdown);
  return { breakdown, head };
}
