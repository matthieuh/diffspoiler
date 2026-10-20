import type { FileStat } from '@diffspoiler/core/types';
import type { PrRef } from '../pr-ref';
import { AuthRequiredError, type PrHead, type StatsSource } from './types';

const GRAPHQL_URL = 'https://gitlab.com/api/graphql';

const HEAD_QUERY = `query($path: ID!, $iid: String!) {
  project(fullPath: $path) {
    mergeRequest(iid: $iid) {
      diffHeadSha
      diffStatsSummary { additions deletions fileCount }
    }
  }
}`;

const FILES_QUERY = `query($path: ID!, $iid: String!) {
  project(fullPath: $path) {
    mergeRequest(iid: $iid) {
      diffStats { path additions deletions }
    }
  }
}`;

interface GraphQlResponse<T> {
  data?: { project?: { mergeRequest?: T | null } | null };
  errors?: unknown[];
}

export function createGitLabSource(
  ref: Extract<PrRef, { host: 'gitlab' }>,
  deps: { fetchFn: typeof fetch; csrfToken: string | null },
): StatsSource {
  async function query<T>(gql: string): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (deps.csrfToken !== null) headers['X-CSRF-Token'] = deps.csrfToken;

    const response = await deps.fetchFn(GRAPHQL_URL, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({ query: gql, variables: { path: ref.projectPath, iid: String(ref.iid) } }),
    });

    if (response.status === 401 || response.status === 403) throw new AuthRequiredError();
    if (!response.ok) throw new Error(`GitLab GraphQL request failed: ${response.status}`);

    const body = (await response.json()) as GraphQlResponse<T>;
    if (body.errors?.length) throw new Error('GitLab GraphQL returned errors');

    // GitLab answers null (not 404) for private MRs the session cannot see.
    const mergeRequest = body.data?.project?.mergeRequest;
    if (!mergeRequest) throw new AuthRequiredError();
    return mergeRequest;
  }

  return {
    async fetchHead(): Promise<PrHead> {
      const mr = await query<{
        diffHeadSha: string;
        diffStatsSummary: { additions: number; deletions: number; fileCount: number };
      }>(HEAD_QUERY);
      const { additions, deletions, fileCount } = mr.diffStatsSummary;
      return { headSha: mr.diffHeadSha, additions, deletions, fileCount };
    },
    async fetchFiles(): Promise<FileStat[]> {
      const mr = await query<{ diffStats: FileStat[] }>(FILES_QUERY);
      return mr.diffStats;
    },
  };
}
