import type { FileStat } from '@diffspoiler/core/types';

export interface PrHead {
  headSha: string;
  additions: number;
  deletions: number;
  fileCount: number;
}

export interface StatsSource {
  fetchHead(): Promise<PrHead>;
  fetchFiles(signal?: AbortSignal): Promise<FileStat[]>;
}

export class AuthRequiredError extends Error {
  constructor(message = 'Authentication required') {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

export class RateLimitedError extends Error {
  constructor() {
    super('rate-limited');
    this.name = 'RateLimitedError';
  }
}
