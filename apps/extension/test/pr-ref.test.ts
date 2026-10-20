import { describe, expect, it } from 'vitest';
import { parsePrUrl, prKey } from '../src/lib/pr-ref';

describe('parsePrUrl', () => {
  const gh = { host: 'github', repo: 'o/r', number: 12 };
  it.each([
    'https://github.com/o/r/pull/12',
    'https://github.com/o/r/pull/12/files#diff-abc',
    'https://github.com/o/r/pull/12/commits',
    'https://github.com/o/r/pull/12/checks?x=1',
  ])('parses GitHub %s', (url) => {
    expect(parsePrUrl(url)).toEqual(gh);
  });

  const gl = { host: 'gitlab', projectPath: 'g/sub/proj', iid: 34 };
  it.each([
    'https://gitlab.com/g/sub/proj/-/merge_requests/34',
    'https://gitlab.com/g/sub/proj/-/merge_requests/34/diffs?commit_id=a#b',
    'https://gitlab.com/g/sub/proj/-/merge_requests/34/pipelines',
  ])('parses GitLab %s', (url) => {
    expect(parsePrUrl(url)).toEqual(gl);
  });

  it.each([
    'https://github.com/o/r/pulls',
    'https://github.com/o/r',
    'https://gitlab.com/g/p/-/merge_requests',
    'https://gitlab.com/g/p/-/merge_requests/new',
    'https://example.com/o/r/pull/1',
  ])('returns null for %s', (url) => {
    expect(parsePrUrl(url)).toBeNull();
  });
});

describe('prKey', () => {
  it('formats both hosts', () => {
    expect(prKey({ host: 'github', repo: 'owner/repo', number: 12 })).toBe('github:owner/repo#12');
    expect(prKey({ host: 'gitlab', projectPath: 'group/sub/proj', iid: 34 })).toBe('gitlab:group/sub/proj!34');
  });
});
