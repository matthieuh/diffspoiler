import { describe, expect, it } from 'vitest';
import { createGitLabSource } from '../../src/lib/sources/gitlab';
import { AuthRequiredError } from '../../src/lib/sources/types';

const ref = { host: 'gitlab', projectPath: 'g/sub/proj', iid: 34 } as const;

function fakeFetch(respond: () => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return respond();
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('gitlab source', () => {
  it('fetchHead posts the summary query with session credentials and csrf', async () => {
    const { calls, fetchFn } = fakeFetch(() =>
      json({
        data: {
          project: {
            mergeRequest: {
              diffHeadSha: 'abc',
              diffStatsSummary: { additions: 10, deletions: 4, fileCount: 3 },
            },
          },
        },
      }),
    );
    const head = await createGitLabSource(ref, { fetchFn, csrfToken: 'tok' }).fetchHead();

    expect(head).toEqual({ headSha: 'abc', additions: 10, deletions: 4, fileCount: 3 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://gitlab.com/api/graphql');
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.init.credentials).toBe('include');
    expect((calls[0]!.init.headers as Record<string, string>)['X-CSRF-Token']).toBe('tok');
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.variables).toEqual({ path: 'g/sub/proj', iid: '34' });
    expect(body.query).toContain('diffHeadSha');
    expect(body.query).toContain('diffStatsSummary');
  });

  it('omits the csrf header when there is no token', async () => {
    const { calls, fetchFn } = fakeFetch(() => json({ data: { project: { mergeRequest: null } } }));
    await createGitLabSource(ref, { fetchFn, csrfToken: null }).fetchHead().catch(() => {});
    expect(calls[0]!.init.headers as Record<string, string>).not.toHaveProperty('X-CSRF-Token');
  });

  it('fetchFiles returns diffStats unchanged', async () => {
    const diffStats = [
      { path: 'a.ts', additions: 1, deletions: 2 },
      { path: 'b.ts', additions: 3, deletions: 0 },
    ];
    const { calls, fetchFn } = fakeFetch(() => json({ data: { project: { mergeRequest: { diffStats } } } }));
    const files = await createGitLabSource(ref, { fetchFn, csrfToken: null }).fetchFiles();

    expect(files).toEqual(diffStats);
    expect(JSON.parse(calls[0]!.init.body as string).query).toContain('diffStats');
  });

  it.each([
    ['null mergeRequest', () => json({ data: { project: { mergeRequest: null } } })],
    ['401', () => json({}, 401)],
    ['403', () => json({}, 403)],
  ])('throws AuthRequiredError on %s', async (_name, respond) => {
    const { fetchFn } = fakeFetch(respond);
    const source = createGitLabSource(ref, { fetchFn, csrfToken: null });
    await expect(source.fetchHead()).rejects.toBeInstanceOf(AuthRequiredError);
    await expect(source.fetchFiles()).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it.each([
    ['500', () => json({}, 500)],
    ['graphql errors', () => json({ errors: [{ message: 'boom' }] })],
  ])('throws a plain Error on %s', async (_name, respond) => {
    const { fetchFn } = fakeFetch(respond);
    const source = createGitLabSource(ref, { fetchFn, csrfToken: null });
    const err = await source.fetchHead().catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(AuthRequiredError);
  });
});
