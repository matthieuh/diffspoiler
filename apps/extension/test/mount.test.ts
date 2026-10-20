import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FileStat } from '@diffspoiler/core/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BreakdownCache } from '../src/lib/cache';
import { type MountDeps, startMount } from '../src/lib/mount';
import { type PrRef, prKey } from '../src/lib/pr-ref';
import { AuthRequiredError, type PrHead, type StatsSource } from '../src/lib/sources/types';

const githubHeader = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'fixtures/github-overview.html'),
  'utf8',
);

const gitlabHeader = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'fixtures/gitlab-overview.html'),
  'utf8',
);

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A source per PR whose fetchHead promise the test settles by hand. */
function fakeSources() {
  const heads = new Map<string, Deferred<PrHead>>();
  const fetchHead = vi.fn();
  const getSource = vi.fn(async (ref: PrRef): Promise<StatsSource> => {
    const key = prKey(ref);
    const head = deferred<PrHead>();
    heads.set(key, head);
    const additions = ref.host === 'github' ? ref.number * 111 : ref.iid * 111;
    const files: FileStat[] = [{ path: 'src/app.ts', additions, deletions: 0 }];
    return {
      fetchHead: () => {
        fetchHead(key);
        return head.promise;
      },
      fetchFiles: async () => files,
    };
  });
  const head = (key: string) => {
    const d = heads.get(key);
    if (!d) throw new Error(`no source requested for ${key}`);
    return d;
  };
  const resolve = (key: string) => head(key).resolve({ headSha: `sha-${key}`, additions: 0, deletions: 0, fileCount: 1 });
  const reject = (key: string, error: unknown) => head(key).reject(error);
  return { getSource, fetchHead, resolve, reject, requested: (key: string) => heads.has(key) };
}

const memoryCache = (): BreakdownCache => ({ get: async () => null, set: async () => {} });

function setUrl(url: string): void {
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(url);
}

const badge = () => document.querySelector('diffspoiler-badge') as HTMLElement | null;
const badgeText = () => badge()?.shadowRoot?.textContent ?? '';
const barClass = () => badge()?.shadowRoot?.querySelector('.bar')?.className ?? '';
const counter = () =>
  document.querySelector('[data-component="PH_Navigation"] [data-testid$=" diffstat"]')!.parentElement!.parentElement!;

const observers: { disconnect: ReturnType<typeof vi.fn> }[] = [];

function setup(url: string, body = githubHeader, getSource?: MountDeps['getSource'], extra: Partial<MountDeps> = {}) {
  setUrl(url);
  document.body.innerHTML = new DOMParser().parseFromString(body, 'text/html').body.innerHTML;
  const sources = fakeSources();
  const listeners = new Set<(url: string) => void>();
  const mount = startMount({
    win: window,
    doc: document,
    getSource: getSource ?? sources.getSource,
    cache: memoryCache(),
    onLocationChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    ...extra,
  });
  // Fires before updating location.href so tests prove the controller routes on the URL it is given.
  const navigate = (next: string) => {
    for (const cb of listeners) cb(next);
    setUrl(next);
  };
  return { mount, sources, navigate, listeners };
}

describe('startMount', () => {
  let stop: (() => void) | null = null;

  beforeEach(() => {
    observers.length = 0;
    class CountingObserver extends MutationObserver {
      constructor(cb: MutationCallback) {
        super(cb);
        const disconnect = vi.fn(() => super.disconnect());
        this.disconnect = disconnect;
        observers.push({ disconnect });
      }
    }
    vi.stubGlobal('MutationObserver', CountingObserver);
  });

  afterEach(() => {
    stop?.();
    stop = null;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  function start(url: string, body?: string, getSource?: MountDeps['getSource'], extra?: Partial<MountDeps>) {
    const ctx = setup(url, body, getSource, extra);
    stop = ctx.mount.stop;
    return ctx;
  }

  it('paints loading right after the page counter, then the breakdown', async () => {
    const { sources } = start('https://github.com/o/r/pull/1');

    expect(badge()).not.toBeNull();
    expect(badge()!.previousElementSibling).toBe(counter());
    expect(barClass()).toContain('loading');

    await vi.waitFor(() => expect(sources.requested('github:o/r#1')).toBe(true));
    sources.resolve('github:o/r#1');
    await vi.waitFor(() => expect(badgeText()).toContain('+111'));
    expect(barClass()).not.toContain('loading');
  });

  it('discards the result of a PR the user already navigated away from', async () => {
    const { sources, navigate } = start('https://github.com/o/r/pull/1');
    navigate('https://github.com/o/r/pull/2');
    await vi.waitFor(() => expect(sources.requested('github:o/r#2')).toBe(true));
    await vi.waitFor(() => expect(sources.requested('github:o/r#1')).toBe(true));

    sources.resolve('github:o/r#2');
    await vi.waitFor(() => expect(badgeText()).toContain('+222'));
    sources.resolve('github:o/r#1');
    await new Promise((r) => setTimeout(r, 20));

    expect(badgeText()).toContain('+222');
    expect(badgeText()).not.toContain('+111');
  });

  it('reuses the in-memory result when switching tabs of the same PR', async () => {
    const { sources, navigate } = start('https://github.com/o/r/pull/12');
    await vi.waitFor(() => expect(sources.requested('github:o/r#12')).toBe(true));
    sources.resolve('github:o/r#12');
    await vi.waitFor(() => expect(badgeText()).toContain('+1,332'));

    navigate('https://github.com/o/r/pull/12/files');

    expect(barClass()).not.toContain('loading');
    expect(badgeText()).toContain('+1,332');
    expect(sources.fetchHead).toHaveBeenCalledTimes(1);
    expect(sources.getSource).toHaveBeenCalledTimes(1);
  });

  it('re-inserts the widget on the next frame when the page re-renders it away', async () => {
    const { sources } = start('https://github.com/o/r/pull/1');
    await vi.waitFor(() => expect(sources.requested('github:o/r#1')).toBe(true));
    sources.resolve('github:o/r#1');
    await vi.waitFor(() => expect(badgeText()).toContain('+111'));

    badge()!.remove();
    expect(badge()).toBeNull();

    await vi.waitFor(() => expect(badge()).not.toBeNull());
    expect(badge()!.previousElementSibling).toBe(counter());
    expect(badgeText()).toContain('+111');
  });

  it('only observes the DOM while on a PR/MR page', async () => {
    const { sources, navigate } = start('https://github.com/o/r/issues/1');

    expect(observers).toHaveLength(0);
    expect(badge()).toBeNull();
    await new Promise((r) => setTimeout(r, 10));
    expect(sources.getSource).not.toHaveBeenCalled();

    navigate('https://github.com/o/r/pull/1');
    expect(observers).toHaveLength(1);
    expect(badge()).not.toBeNull();

    navigate('https://github.com/o/r');
    expect(observers[0]!.disconnect).toHaveBeenCalled();
    expect(badge()).toBeNull();
  });

  it('logs a missing anchor at most once per URL and never throws', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const { navigate } = start('https://github.com/o/r/pull/1', '<html><body><main></main></body></html>');

    document.querySelector('main')!.append(document.createElement('p'));
    await new Promise((r) => setTimeout(r, 50));
    navigate('https://github.com/o/r/pull/1/commits');
    navigate('https://github.com/o/r/pull/1/commits');

    expect(badge()).toBeNull();
    expect(debug.mock.calls.filter(([msg]) => msg === 'diffspoiler: no anchor')).toHaveLength(2);
  });

  it('shows auth-required for AuthRequiredError and hides on any other error', async () => {
    const { sources, navigate } = start('https://github.com/o/r/pull/1');
    await vi.waitFor(() => expect(sources.requested('github:o/r#1')).toBe(true));
    sources.reject('github:o/r#1', new AuthRequiredError());
    await vi.waitFor(() => expect(barClass()).toContain('auth'));

    navigate('https://github.com/o/r/pull/2');
    await vi.waitFor(() => expect(sources.requested('github:o/r#2')).toBe(true));
    sources.reject('github:o/r#2', new Error('rate-limited'));
    await vi.waitFor(() => expect(badge()!.style.display).toBe('none'));
  });

  const rejectingSource = (error: unknown) => async (): Promise<StatsSource> => ({
    fetchHead: async () => {
      throw error;
    },
    fetchFiles: async () => [],
  });

  it('shows the GitLab session copy without an options button on a GitLab auth error', async () => {
    start('https://gitlab.com/g/p/-/merge_requests/1', gitlabHeader, rejectingSource(new AuthRequiredError()));
    await vi.waitFor(() => expect(barClass()).toContain('auth'));
    expect(badgeText()).toContain("Couldn't read this merge request with your GitLab session.");
    expect(badge()!.shadowRoot!.querySelector('button')).toBeNull();
  });

  it('tells a GitHub token holder that the token cannot read the repo', async () => {
    start('https://github.com/o/r/pull/1', githubHeader, rejectingSource(new AuthRequiredError()), {
      hasGitHubToken: async () => true,
    });
    await vi.waitFor(() => expect(badgeText()).toContain("Your GitHub token can't read this repo."));
    expect(badge()!.shadowRoot!.querySelector('button')).not.toBeNull();
  });

  it('asks a GitHub visitor without a token to add one', async () => {
    start('https://github.com/o/r/pull/1', githubHeader, rejectingSource(new AuthRequiredError()), {
      hasGitHubToken: async () => false,
    });
    await vi.waitFor(() => expect(badgeText()).toContain('add a GitHub token'));
  });

  it('stops itself when the extension context is invalidated', async () => {
    let valid = true;
    const { sources } = start('https://github.com/o/r/pull/1', githubHeader, undefined, {
      isContextValid: () => valid,
    });
    expect(badge()).not.toBeNull();
    valid = false;
    document.body.append(document.createElement('p'));
    await vi.waitFor(() => expect(badge()).toBeNull());
    expect(observers.every((o) => o.disconnect.mock.calls.length > 0)).toBe(true);
    expect(sources.requested('github:o/r#1')).toBe(true);
  });

  it('does not load anything when the context is already invalid', async () => {
    const { sources } = start('https://github.com/o/r/pull/1', githubHeader, undefined, {
      isContextValid: () => false,
    });
    expect(sources.requested('github:o/r#1')).toBe(false);
    expect(badge()).toBeNull();
  });

  it('re-places the widget after the whole body is replaced', async () => {
    start('https://github.com/o/r/pull/1');
    expect(badge()).not.toBeNull();
    const next = document.createElement('body');
    next.innerHTML = new DOMParser().parseFromString(githubHeader, 'text/html').body.innerHTML;
    document.documentElement.replaceChild(next, document.body);
    await vi.waitFor(() => expect(next.querySelector('diffspoiler-badge')).not.toBeNull());
  });

  it('shows the widget after an in-app navigation from a non-PR page to a PR', async () => {
    const { sources, navigate } = start('https://github.com/o/r/pulls');
    expect(badge()).toBeNull();

    navigate('https://github.com/o/r/pull/1');

    expect(badge()).not.toBeNull();
    await vi.waitFor(() => expect(sources.requested('github:o/r#1')).toBe(true));
    sources.resolve('github:o/r#1');
    await vi.waitFor(() => expect(badgeText()).toContain('+111'));
  });

  it("routes on the URL it is given and never shows PR A's breakdown on PR B", async () => {
    const { sources, navigate } = start('https://github.com/o/r/pull/1');
    await vi.waitFor(() => expect(sources.requested('github:o/r#1')).toBe(true));
    sources.resolve('github:o/r#1');
    await vi.waitFor(() => expect(badgeText()).toContain('+111'));

    navigate('https://github.com/o/r/pull/2');

    expect(badgeText()).not.toContain('+111');
    expect(barClass()).toContain('loading');
    await vi.waitFor(() => expect(sources.requested('github:o/r#2')).toBe(true));
    sources.resolve('github:o/r#2');
    await vi.waitFor(() => expect(badgeText()).toContain('+222'));
    expect(badgeText()).not.toContain('+111');
  });

  it('re-routes on the next DOM change when the URL moved without a location event', async () => {
    const { sources } = start('https://github.com/o/r/pull/1');
    await vi.waitFor(() => expect(sources.requested('github:o/r#1')).toBe(true));

    setUrl('https://github.com/o/r/pull/2');
    document.body.append(document.createElement('p'));

    await vi.waitFor(() => expect(sources.requested('github:o/r#2')).toBe(true));
    expect(barClass()).toContain('loading');
  });

  it('hides the widget when getSource throws synchronously, without an unhandled rejection', async () => {
    const getSource = vi.fn((): Promise<StatsSource> => {
      throw new Error('boom');
    });
    start('https://github.com/o/r/pull/1', undefined, getSource);

    await vi.waitFor(() => expect(badge()!.style.display).toBe('none'));
    expect(getSource).toHaveBeenCalledTimes(1);
  });

  it('keeps the widget through a navigation attempt that never commits (download, stop)', async () => {
    const { sources } = start('https://github.com/o/r/pull/1');
    await vi.waitFor(() => expect(sources.requested('github:o/r#1')).toBe(true));
    sources.resolve('github:o/r#1');
    await vi.waitFor(() => expect(badgeText()).toContain('+111'));

    // No location event and no URL change, only page mutations.
    const link = document.createElement('a');
    link.href = '/o/r/pull/1.patch';
    link.download = '';
    document.body.append(link);
    document.body.append(document.createElement('p'));
    await new Promise((r) => setTimeout(r, 50));

    expect(badge()).not.toBeNull();
    expect(badgeText()).toContain('+111');
    expect(observers[0]!.disconnect).not.toHaveBeenCalled();
    expect(sources.getSource).toHaveBeenCalledTimes(1);
  });

  it('stops observing and removes the widget on stop()', () => {
    const { mount, listeners } = start('https://github.com/o/r/pull/1');

    mount.stop();

    expect(observers[0]!.disconnect).toHaveBeenCalled();
    expect(badge()).toBeNull();
    expect(listeners.size).toBe(0);
  });
});
