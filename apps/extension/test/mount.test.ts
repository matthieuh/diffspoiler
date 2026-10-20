import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FileStat } from '@diffspoiler/core/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BreakdownCache } from '../src/lib/cache';
import { startMount } from '../src/lib/mount';
import { type PrRef, prKey } from '../src/lib/pr-ref';
import { AuthRequiredError, type PrHead, type StatsSource } from '../src/lib/sources/types';

const githubHeader = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'fixtures/github-overview.html'),
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

function setup(url: string, body = githubHeader) {
  setUrl(url);
  document.body.innerHTML = new DOMParser().parseFromString(body, 'text/html').body.innerHTML;
  const sources = fakeSources();
  const listeners = new Set<() => void>();
  const mount = startMount({
    win: window,
    doc: document,
    getSource: sources.getSource,
    cache: memoryCache(),
    onLocationChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  });
  const navigate = (next: string) => {
    setUrl(next);
    for (const cb of listeners) cb();
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

  function start(url: string, body?: string) {
    const ctx = setup(url, body);
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

  it('stops observing and removes the widget on stop()', () => {
    const { mount, listeners } = start('https://github.com/o/r/pull/1');

    mount.stop();

    expect(observers[0]!.disconnect).toHaveBeenCalled();
    expect(badge()).toBeNull();
    expect(listeners.size).toBe(0);
  });
});
