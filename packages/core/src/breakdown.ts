import { classifyPath } from './classify.ts';
import { BUCKET_ORDER } from './rules.ts';
import type { Breakdown, BucketId, BucketSummary, FileStat } from './types.ts';

export function computeBreakdown(files: FileStat[], uncountedFiles = 0): Breakdown {
  const byId = new Map<BucketId, BucketSummary>(
    BUCKET_ORDER.map((id) => [id, { id, additions: 0, deletions: 0, fileCount: 0 }]),
  );

  for (const file of files) {
    const bucket = byId.get(classifyPath(file.path));
    if (!bucket) continue;
    bucket.additions += file.additions;
    bucket.deletions += file.deletions;
    bucket.fileCount += 1;
  }

  const buckets = BUCKET_ORDER.map((id) => byId.get(id) as BucketSummary);
  const total = buckets.reduce(
    (acc, bucket) => ({
      additions: acc.additions + bucket.additions,
      deletions: acc.deletions + bucket.deletions,
      fileCount: acc.fileCount + bucket.fileCount,
    }),
    { additions: 0, deletions: 0, fileCount: 0 },
  );

  return { buckets, total, uncountedFiles: Math.max(0, uncountedFiles) };
}
