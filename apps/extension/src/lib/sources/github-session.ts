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
  filesChangedCountLimitExceeded?: unknown;
}

interface FileTreeResponse {
  // Zero counts are omitted from each entry.
  diffs?: { path?: unknown; linesAdded?: unknown; linesDeleted?: unknown; linesChanged?: unknown }[];
}

const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

function shapeError(): Error {
  return new Error('Unexpected GitHub page_data shape');
}

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

  async function loadHead(): Promise<PrHead> {
    const [header, diffstat, tabCounts] = await Promise.all([
      get<HeaderResponse>('header'),
      get<DiffstatResponse>('diffstat'),
      get<TabCountsResponse>('tab_counts'),
    ]);
    const headSha = header.pullRequest?.headSha;
    const additions = diffstat.diffstat?.linesAdded;
    const deletions = diffstat.diffstat?.linesDeleted;
    const fileCount = tabCounts.filesChangedCount;
    if (typeof headSha !== 'string' || !isCount(additions) || !isCount(deletions) || !isCount(fileCount)) {
      throw shapeError();
    }
    // A capped count would under-report the "not counted" files.
    if (tabCounts.filesChangedCountLimitExceeded === true) throw new Error('GitHub file count is capped');
    return { headSha, additions, deletions, fileCount };
  }

  // Shared by fetchHead and fetchFiles, which checks the file sums against the diffstat totals.
  let head: Promise<PrHead> | null = null;
  const fetchHeadOnce = () => {
    head ??= loadHead();
    return head;
  };

  return {
    fetchHead: fetchHeadOnce,
    async fetchFiles(signal?: AbortSignal): Promise<FileStat[]> {
      // One request; GitHub stops listing at 3,000 files, the rest shows as "not counted" via head.fileCount.
      const [pr, { diffs }] = await Promise.all([fetchHeadOnce(), get<FileTreeResponse>('file_tree', signal)]);
      signal?.throwIfAborted();
      if (!Array.isArray(diffs)) throw shapeError();

      // Omitted keys mean zero, so a renamed key would read as zero: linesChanged and the totals catch that.
      if (diffs.length > 0 && !diffs.some((d) => 'linesAdded' in d || 'linesDeleted' in d || 'linesChanged' in d)) {
        throw shapeError();
      }
      const files = diffs.map((d) => {
        const additions = d.linesAdded ?? 0;
        const deletions = d.linesDeleted ?? 0;
        const changed = d.linesChanged ?? 0;
        const consistent = isCount(additions) && isCount(deletions) && changed === additions + deletions;
        if (typeof d.path !== 'string' || !consistent) throw shapeError();
        return { path: d.path, additions, deletions };
      });

      if (files.length === pr.fileCount) {
        const additions = files.reduce((sum, f) => sum + f.additions, 0);
        const deletions = files.reduce((sum, f) => sum + f.deletions, 0);
        if (additions !== pr.additions || deletions !== pr.deletions) {
          throw new Error('GitHub file sums differ from totals');
        }
      }
      return files;
    },
  };
}
