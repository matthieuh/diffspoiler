export type BucketId = 'runtime' | 'tests' | 'evals' | 'other';

export interface FileStat {
  path: string;
  additions: number;
  deletions: number;
}

export interface BucketSummary {
  id: BucketId;
  additions: number;
  deletions: number;
  fileCount: number;
}

export interface Breakdown {
  buckets: BucketSummary[];
  total: { additions: number; deletions: number; fileCount: number };
  uncountedFiles: number;
}
