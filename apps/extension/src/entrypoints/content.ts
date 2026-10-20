import { browser } from 'wxt/browser';
import { createBreakdownCache } from '../lib/cache';
import { committedLocationChanges } from '../lib/location';
import { startMount } from '../lib/mount';
import type { PrRef } from '../lib/pr-ref';
import { getGitHubToken } from '../lib/settings';
import { withFallback } from '../lib/sources/fallback';
import { createGitHubSource } from '../lib/sources/github';
import { createGitHubSessionSource } from '../lib/sources/github-session';
import { createGitLabSource } from '../lib/sources/gitlab';
import type { StatsSource } from '../lib/sources/types';

export default defineContentScript({
  matches: ['https://github.com/*', 'https://gitlab.com/*'],
  runAt: 'document_idle',
  main(ctx) {
    // Sources call deps.fetchFn(...), which an unbound native fetch rejects with "Illegal invocation".
    const fetchFn = globalThis.fetch.bind(globalThis);

    async function getSource(ref: PrRef): Promise<StatsSource> {
      if (ref.host === 'gitlab') {
        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') ?? null;
        return createGitLabSource(ref, { fetchFn, csrfToken });
      }
      const token = await getGitHubToken();
      const rest = createGitHubSource(ref, { fetchFn, token });
      // Auth required (e.g. a token scoped to another owner) reads the PR page's own data; only a tokenless run also
      // falls back when the anonymous quota is spent, since a token has its own quota.
      return withFallback(rest, () => createGitHubSessionSource(ref, { fetchFn }), { onRateLimit: token === null });
    }

    const mount = startMount({
      win: window,
      doc: document,
      getSource,
      cache: createBreakdownCache(),
      hasGitHubToken: async () => (await getGitHubToken()) !== null,
      isContextValid: () => Boolean(browser.runtime?.id),
      onLocationChange: committedLocationChanges(window, (listener) =>
        ctx.addEventListener(window, 'wxt:locationchange', listener),
      ),
    });
    ctx.onInvalidated(() => mount.stop());
  },
});
