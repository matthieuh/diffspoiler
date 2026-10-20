import { describe, expect, it } from 'vitest';
import { createGitHubSource } from '../../src/lib/sources/github';
import { AuthRequiredError } from '../../src/lib/sources/types';

const ref = { host: 'github', repo: 'o/r', number: 12 } as const;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

const prBody = (changedFiles: number) => ({
  head: { sha: 'abc123' },
  additions: 10,
  deletions: 4,
  changed_files: changedFiles,
});

function fakeFetch(respond: (url: string) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  let inFlight = 0;
  let peak = 0;
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 1));
    inFlight--;
    return respond(url);
  }) as unknown as typeof fetch;
  return { calls, fetchFn, peak: () => peak };
}

const pageNumber = (url: string) => Number(new URL(url).searchParams.get('page'));

function filesResponder(changedFiles: number) {
  return (url: string) => {
    if (!url.includes('/files')) return json(prBody(changedFiles));
    const page = pageNumber(url);
    const start = (page - 1) * 100;
    const count = Math.max(0, Math.min(100, changedFiles - start));
    return json(
      Array.from({ length: count }, (_, i) => ({ filename: `f${start + i}.ts`, additions: 1, deletions: 2 })),
    );
  };
}

describe('github source', () => {
  it('fetchHead maps the pull request payload, with a bearer token when set', async () => {
    const { calls, fetchFn } = fakeFetch(() => json(prBody(3)));
    const head = await createGitHubSource(ref, { fetchFn, token: 'tok' }).fetchHead();

    expect(head).toEqual({ headSha: 'abc123', additions: 10, deletions: 4, fileCount: 3 });
    expect(calls[0]!.url).toBe('https://api.github.com/repos/o/r/pulls/12');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Accept).toBe('application/vnd.github+json');
    expect(headers.Authorization).toBe('Bearer tok');
  });

  it('omits Authorization without a token', async () => {
    const { calls, fetchFn } = fakeFetch(() => json(prBody(3)));
    await createGitHubSource(ref, { fetchFn, token: null }).fetchHead();
    expect(calls[0]!.init.headers as Record<string, string>).not.toHaveProperty('Authorization');
  });

  it('fetchFiles maps filename to path, so a rename uses its new path', async () => {
    const { calls, fetchFn } = fakeFetch((url) =>
      url.includes('/files')
        ? json([{ filename: 'new/name.ts', previous_filename: 'old/name.ts', additions: 5, deletions: 1 }])
        : json(prBody(1)),
    );
    const files = await createGitHubSource(ref, { fetchFn, token: null }).fetchFiles();

    expect(files).toEqual([{ path: 'new/name.ts', additions: 5, deletions: 1 }]);
    expect(calls.map((c) => c.url)).toContain('https://api.github.com/repos/o/r/pulls/12/files?per_page=100&page=1');
  });

  it('fetches ceil(changed_files / 100) pages with at most 6 in flight', async () => {
    const { calls, fetchFn, peak } = fakeFetch(filesResponder(3000));
    const files = await createGitHubSource(ref, { fetchFn, token: null }).fetchFiles();

    expect(files).toHaveLength(3000);
    expect(new Set(files.map((f) => f.path)).size).toBe(3000);
    expect(calls.filter((c) => c.url.includes('/files'))).toHaveLength(30);
    expect(peak()).toBeLessThanOrEqual(6);
    expect(peak()).toBeGreaterThan(1);
  });

  it('honors a custom concurrency', async () => {
    const { fetchFn, peak } = fakeFetch(filesResponder(1000));
    await createGitHubSource(ref, { fetchFn, token: null, concurrency: 2 }).fetchFiles();
    expect(peak()).toBe(2);
  });

  it('caps a 3,500-file PR at 3,000 files', async () => {
    const { calls, fetchFn } = fakeFetch(filesResponder(3500));
    const files = await createGitHubSource(ref, { fetchFn, token: null }).fetchFiles();

    expect(files).toHaveLength(3000);
    expect(calls.filter((c) => c.url.includes('/files'))).toHaveLength(30);
  });

  it.each([
    ['404 without token', 404, null],
    ['401 without token', 401, null],
    ['404 with token', 404, 'tok'],
    ['401 with token', 401, 'tok'],
  ])('throws AuthRequiredError on %s', async (_name, status, token) => {
    const { fetchFn } = fakeFetch(() => json({}, status));
    const source = createGitHubSource(ref, { fetchFn, token });
    await expect(source.fetchHead()).rejects.toBeInstanceOf(AuthRequiredError);
    await expect(source.fetchFiles()).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it('throws rate-limited on 403 with no remaining quota', async () => {
    const { fetchFn } = fakeFetch(() => json({}, 403, { 'x-ratelimit-remaining': '0' }));
    const err = await createGitHubSource(ref, { fetchFn, token: null }).fetchHead().catch((e) => e);
    expect(err).not.toBeInstanceOf(AuthRequiredError);
    expect(err.message).toBe('rate-limited');
  });

  it('throws a plain Error on other failures', async () => {
    const { fetchFn } = fakeFetch(() => json({}, 500));
    const err = await createGitHubSource(ref, { fetchFn, token: null }).fetchHead().catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(AuthRequiredError);
  });
});
