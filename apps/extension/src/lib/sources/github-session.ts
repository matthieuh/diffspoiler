import type { FileStat } from '@diffspoiler/core/types';
import type { PrRef } from '../pr-ref';
import { AuthRequiredError, type PrHead, type StatsSource } from './types';

// The JSON endpoints github.com's own pull request UI reads, authenticated by the page's session cookie.
// Internal and unversioned: any shape change throws, so the widget hides instead of showing wrong numbers.
const HEADERS = {
  Accept: 'application/json',
  'GitHub-Verified-Fetch': 'true',
  'X-Requested-With': 'XMLHttpRequest',
};

interface HeaderResponse {
  pullRequest?: { headSha?: unknown };
}

interface DiffstatResponse {
  diffstat?: { linesAdded?: unknown; linesDeleted?: unknown };
}

interface TabCountsResponse {
  filesChangedCount?: unknown;
}

interface FileTreeResponse {
  // Zero counts are omitted from each entry.
  diffs?: { path?: unknown; linesAdded?: number; linesDeleted?: number }[];
}

const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

export function createGitHubSessionSource(
  ref: Extract<PrRef, { host: 'github' }>,
  deps: { fetchFn: typeof fetch },
): StatsSource {
  const base = `https://github.com/${ref.repo}/pull/${ref.number}/page_data`;

  async function get<T>(name: string, signal?: AbortSignal): Promise<T> {
    const response = await deps.fetchFn(`${base}/${name}`, { headers: HEADERS, credentials: 'same-origin', signal });
    // 404 for logged-out viewers and for PRs the session cannot see.
    if (response.status === 401 || response.status === 403 || response.status === 404) throw new AuthRequiredError();
    if (!response.ok) throw new Error(`GitHub page_data request failed: ${response.status}`);
    return (await response.json()) as T;
  }

  return {
    async fetchHead(): Promise<PrHead> {
      const [header, diffstat, tabCounts] = await Promise.all([
        get<HeaderResponse>('header'),
        get<DiffstatResponse>('diffstat'),
        get<TabCountsResponse>('tab_counts'),
      ]);
      const headSha = header.pullRequest?.headSha;
      const stat = diffstat.diffstat;
      const additions = stat?.linesAdded ?? 0;
      const deletions = stat?.linesDeleted ?? 0;
      const fileCount = tabCounts.filesChangedCount;
      if (typeof headSha !== 'string' || !stat || !isCount(additions) || !isCount(deletions) || !isCount(fileCount)) {
        throw new Error('Unexpected GitHub page_data shape');
      }
      return { headSha, additions, deletions, fileCount };
    },
    async fetchFiles(signal?: AbortSignal): Promise<FileStat[]> {
      // One request; GitHub stops listing at 3,000 files, the rest shows as "not counted" via head.fileCount.
      const { diffs } = await get<FileTreeResponse>('file_tree', signal);
      signal?.throwIfAborted();
      if (!Array.isArray(diffs)) throw new Error('Unexpected GitHub page_data shape');
      return diffs.map((d) => {
        const additions = d.linesAdded ?? 0;
        const deletions = d.linesDeleted ?? 0;
        if (typeof d.path !== 'string' || !isCount(additions) || !isCount(deletions)) {
          throw new Error('Unexpected GitHub page_data shape');
        }
        return { path: d.path, additions, deletions };
      });
    },
  };
}
