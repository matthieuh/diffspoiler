import type { FileStat } from '@diffspoiler/core/types';
import type { PrRef } from '../pr-ref';
import { AuthRequiredError, type PrHead, type StatsSource } from './types';

const API = 'https://api.github.com';
const PER_PAGE = 100;
// GitHub's pulls/files endpoint never returns more than 3,000 files.
const MAX_FILES = 3000;

interface PullResponse {
  head: { sha: string };
  additions: number;
  deletions: number;
  changed_files: number;
}

interface PullFile {
  filename: string;
  additions: number;
  deletions: number;
}

export function createGitHubSource(
  ref: Extract<PrRef, { host: 'github' }>,
  deps: { fetchFn: typeof fetch; token: string | null; concurrency?: number },
): StatsSource {
  const concurrency = Math.max(1, deps.concurrency ?? 6);
  const pullUrl = `${API}/repos/${ref.repo}/pulls/${ref.number}`;

  async function get<T>(url: string, signal?: AbortSignal): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
    if (deps.token !== null) headers.Authorization = `Bearer ${deps.token}`;

    const response = await deps.fetchFn(url, { headers, signal });

    // GitHub answers 404 for private repos the token (or lack of one) cannot see.
    if (response.status === 401 || response.status === 404) throw new AuthRequiredError();
    if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
      throw new Error('rate-limited');
    }
    if (!response.ok) throw new Error(`GitHub request failed: ${response.status}`);
    return (await response.json()) as T;
  }

  // One /pulls/N request per source instance, shared by fetchHead and fetchFiles.
  let pull: Promise<PullResponse> | null = null;
  const fetchPull = () => {
    pull ??= get<PullResponse>(pullUrl);
    return pull;
  };
  const fetchPage = (page: number, signal?: AbortSignal) =>
    get<PullFile[]>(`${pullUrl}/files?per_page=${PER_PAGE}&page=${page}`, signal);

  return {
    async fetchHead(): Promise<PrHead> {
      const pr = await fetchPull();
      return { headSha: pr.head.sha, additions: pr.additions, deletions: pr.deletions, fileCount: pr.changed_files };
    },
    async fetchFiles(signal?: AbortSignal): Promise<FileStat[]> {
      // Page 1 does not depend on changed_files, so it goes out with the head request.
      const [pr, firstPage] = await Promise.all([fetchPull(), fetchPage(1, signal)]);
      const pageCount = Math.ceil(Math.min(pr.changed_files, MAX_FILES) / PER_PAGE);
      const pages: PullFile[][] = new Array(pageCount);
      pages[0] = firstPage;
      let next = 1;

      async function worker(): Promise<void> {
        while (next < pageCount && !signal?.aborted) {
          const index = next++;
          pages[index] = await fetchPage(index + 1, signal);
        }
      }

      await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(0, pageCount - 1)) }, worker));
      // An aborted run may have skipped pages; never resolve with truncated data.
      signal?.throwIfAborted();
      return pages.flat().map((f) => ({ path: f.filename, additions: f.additions, deletions: f.deletions }));
    },
  };
}
