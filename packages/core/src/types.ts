export type BucketId = 'runtime' | 'tests' | 'evals' | 'other';

export interface FileStat {
  path: string;
  additions: number;
  deletions: number;
}
