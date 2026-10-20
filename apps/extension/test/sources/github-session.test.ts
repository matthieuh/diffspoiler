import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { createGitHubSessionSource } from '../../src/lib/sources/github-session';
import { AuthRequiredError } from '../../src/lib/sources/types';

// Captured logged out from github.com/DefinitelyTyped/DefinitelyTyped/pull/75475 (header trimmed to what we read).
const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/github-session');
const fixture = (name: string): unknown => JSON.parse(readFileSync(join(fixtureDir, `${name}.json`), 'utf8'));

const ref = { host: 'github', repo: 'o/r', number: 12 } as const;
const base = 'https://github.com/o/r/pull/12/page_data';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function fakeFetch(respond: (name: string) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return respond(url.slice(base.length + 1));
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

const fixtures = (name: string) => json(fixture(name));

describe('github session source', () => {
  it('fetchHead combines header, diffstat and tab_counts', async () => {
    const { calls, fetchFn } = fakeFetch(fixtures);
    const head = await createGitHubSessionSource(ref, { fetchFn }).fetchHead();

    expect(head).toEqual({
      headSha: '2e717a6870fc46768a5c4590e97ab206407b7bcd',
      additions: 22,
      deletions: 1,
      fileCount: 3,
    });
    expect(calls.map((c) => c.url).sort()).toEqual([`${base}/diffstat`, `${base}/header`, `${base}/tab_counts`]);
  });

  it('sends the headers the page_data endpoints require (406 without them)', async () => {
    const { calls, fetchFn } = fakeFetch(fixtures);
    const source = createGitHubSessionSource(ref, { fetchFn });
    await Promise.all([source.fetchHead(), source.fetchFiles()]);

    for (const call of calls) {
      expect(call.init.headers).toEqual({
        Accept: 'application/json',
        'GitHub-Verified-Fetch': 'true',
        'X-Requested-With': 'XMLHttpRequest',
      });
      expect(call.init.credentials).toBe('same-origin');
    }
  });

  it('fetchFiles maps file_tree diffs, treating omitted zero counts as 0', async () => {
    const { calls, fetchFn } = fakeFetch(fixtures);
    const files = await createGitHubSessionSource(ref, { fetchFn }).fetchFiles();

    expect(files).toEqual([
      { path: 'types/chrome/test/index.ts', additions: 9, deletions: 0 },
      { path: 'types/chrome/index.d.ts', additions: 12, deletions: 0 },
      { path: 'types/chrome/package.json', additions: 1, deletions: 1 },
    ]);
    expect(calls.map((c) => c.url)).toContain(`${base}/file_tree`);
  });

  it('a fetchHead + fetchFiles pair requests each endpoint once', async () => {
    const { calls, fetchFn } = fakeFetch(fixtures);
    const source = createGitHubSessionSource(ref, { fetchFn });
    await Promise.all([source.fetchHead(), source.fetchFiles()]);

    expect(calls.map((c) => c.url).sort()).toEqual(
      ['diffstat', 'file_tree', 'header', 'tab_counts'].map((name) => `${base}/${name}`),
    );
  });

  it('returns what file_tree lists, leaving the uncounted rest to head.fileCount', async () => {
    // file_tree stops at 3,000 entries (observed on a 6,369-file PR); tab_counts still reports the real count.
    const diffs = Array.from({ length: 3000 }, (_, i) => ({ path: `f${i}.ts`, linesAdded: 1, linesChanged: 1 }));
    const { fetchFn } = fakeFetch((name) =>
      name === 'file_tree'
        ? json({ diffs })
        : name === 'tab_counts'
          ? json({ filesChangedCount: 6369 })
          : fixtures(name),
    );
    const source = createGitHubSessionSource(ref, { fetchFn });
    const [head, files] = await Promise.all([source.fetchHead(), source.fetchFiles()]);

    expect(files).toHaveLength(3000);
    expect(head.fileCount).toBe(6369);
  });

  it('passes the signal to the file_tree request', async () => {
    const controller = new AbortController();
    const { calls, fetchFn } = fakeFetch(fixtures);
    await createGitHubSessionSource(ref, { fetchFn }).fetchFiles(controller.signal);
    expect(calls.find((c) => c.url.endsWith('/file_tree'))!.init.signal).toBe(controller.signal);
  });

  it('rejects an aborted fetchFiles even if the response still arrives', async () => {
    const controller = new AbortController();
    const { fetchFn } = fakeFetch((name) => {
      controller.abort();
      return fixtures(name);
    });
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);

    await expect(createGitHubSessionSource(ref, { fetchFn }).fetchFiles(controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it.each([401, 403, 404])('throws AuthRequiredError on %s (logged out or no access)', async (status) => {
    const { fetchFn } = fakeFetch(() => json({ error: 'Not Found' }, status));
    const source = createGitHubSessionSource(ref, { fetchFn });
    await expect(source.fetchHead()).rejects.toBeInstanceOf(AuthRequiredError);
    await expect(source.fetchFiles()).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it('throws a plain Error on other failures', async () => {
    const { fetchFn } = fakeFetch(() => json({}, 406));
    const err = await createGitHubSessionSource(ref, { fetchFn }).fetchFiles().catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(AuthRequiredError);
  });

  it('throws when the payload shape changed instead of reporting wrong numbers', async () => {
    const { fetchFn: headFetch } = fakeFetch((name) =>
      name === 'header' ? json({ pullRequest: {} }) : fixtures(name),
    );
    await expect(createGitHubSessionSource(ref, { fetchFn: headFetch }).fetchHead()).rejects.toThrow();

    const { fetchFn: filesFetch } = fakeFetch(() => json({ files: [] }));
    await expect(createGitHubSessionSource(ref, { fetchFn: filesFetch }).fetchFiles()).rejects.toThrow();
  });

  const withFileTree = (diffs: unknown[]) => (name: string) =>
    name === 'file_tree' ? json({ diffs }) : fixtures(name);

  it('rejects file_tree entries whose count keys were renamed', async () => {
    const { fetchFn } = fakeFetch(
      withFileTree([
        { path: 'a.ts', added: 20, deleted: 1, changed: 21 },
        { path: 'b.ts', added: 2, deleted: 0, changed: 2 },
      ]),
    );
    await expect(createGitHubSessionSource(ref, { fetchFn }).fetchFiles()).rejects.toThrow();
  });

  it('rejects an entry whose linesChanged is not linesAdded + linesDeleted', async () => {
    const { fetchFn } = fakeFetch(withFileTree([{ path: 'a.ts', linesChanged: 23 }]));
    await expect(createGitHubSessionSource(ref, { fetchFn }).fetchFiles()).rejects.toThrow();
  });

  it('rejects when the file sums of a complete list differ from the diffstat totals', async () => {
    const { fetchFn } = fakeFetch(
      withFileTree([
        { path: 'a.ts', linesAdded: 21, linesChanged: 21 },
        { path: 'b.ts', linesDeleted: 1, linesChanged: 1 },
        { path: 'c.ts', linesAdded: 2, linesChanged: 2 },
      ]),
    );
    await expect(createGitHubSessionSource(ref, { fetchFn }).fetchFiles()).rejects.toThrow();
  });

  it('rejects a head whose diffstat lacks a count', async () => {
    const { fetchFn } = fakeFetch((name) =>
      name === 'diffstat' ? json({ diffstat: { linesAdded: 22 } }) : fixtures(name),
    );
    await expect(createGitHubSessionSource(ref, { fetchFn }).fetchHead()).rejects.toThrow();
  });

  it('rejects a head whose file count is itself capped', async () => {
    const { fetchFn } = fakeFetch((name) =>
      name === 'tab_counts' ? json({ filesChangedCount: 3000, filesChangedCountLimitExceeded: true }) : fixtures(name),
    );
    await expect(createGitHubSessionSource(ref, { fetchFn }).fetchHead()).rejects.toThrow();
  });
});
