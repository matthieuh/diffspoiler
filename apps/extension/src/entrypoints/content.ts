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
      if (token !== null) return rest;
      // No token: private PRs (auth required) and a spent anonymous quota read the PR page's own data instead.
      return withFallback(rest, () => createGitHubSessionSource(ref, { fetchFn }));
    }

    const mount = startMount({
      win: window,
      doc: document,
      getSource,
      cache: createBreakdownCache(),
      onLocationChange: committedLocationChanges(window, (listener) =>
        ctx.addEventListener(window, 'wxt:locationchange', listener),
      ),
    });
    ctx.onInvalidated(() => mount.stop());
  },
});
