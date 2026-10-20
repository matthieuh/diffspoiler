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

  async function get<T>(url: string): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
    if (deps.token !== null) headers.Authorization = `Bearer ${deps.token}`;

    const response = await deps.fetchFn(url, { headers });

    // GitHub answers 404 for private repos the token (or lack of one) cannot see.
    if (response.status === 401 || response.status === 404) throw new AuthRequiredError();
    if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
      throw new Error('rate-limited');
    }
    if (!response.ok) throw new Error(`GitHub request failed: ${response.status}`);
    return (await response.json()) as T;
  }

  const fetchPull = () => get<PullResponse>(pullUrl);

  return {
    async fetchHead(): Promise<PrHead> {
      const pr = await fetchPull();
      return { headSha: pr.head.sha, additions: pr.additions, deletions: pr.deletions, fileCount: pr.changed_files };
    },
    async fetchFiles(): Promise<FileStat[]> {
      const pr = await fetchPull();
      const pageCount = Math.ceil(Math.min(pr.changed_files, MAX_FILES) / PER_PAGE);
      const pages: PullFile[][] = new Array(pageCount);
      let next = 0;

      async function worker(): Promise<void> {
        while (next < pageCount) {
          const index = next++;
          pages[index] = await get<PullFile[]>(`${pullUrl}/files?per_page=${PER_PAGE}&page=${index + 1}`);
        }
      }

      await Promise.all(Array.from({ length: Math.min(concurrency, pageCount) }, worker));
      return pages.flat().map((f) => ({ path: f.filename, additions: f.additions, deletions: f.deletions }));
    },
  };
}
