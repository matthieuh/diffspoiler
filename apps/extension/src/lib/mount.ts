import type { BreakdownCache } from './cache';
import { type Loaded, loadBreakdown } from './load-breakdown';
import { type PrRef, parsePrUrl, prKey } from './pr-ref';
import { AuthRequiredError, type StatsSource } from './sources/types';
import { findAnchor } from './ui/anchors';
import { parsePageCounter } from './ui/page-counter';
import { createWidget } from './ui/widget';

export interface MountDeps {
  win: Window;
  doc: Document;
  getSource: (ref: PrRef) => Promise<StatsSource>;
  cache: BreakdownCache;
  /** Fires with the new URL once a navigation has committed. */
  onLocationChange: (cb: (url: string) => void) => () => void;
  /** Whether the user saved a GitHub token; only used to word the auth-required state. */
  hasGitHubToken?: () => Promise<boolean>;
  /** False once the extension was reloaded/updated under this page; the mount then stops itself. */
  isContextValid?: () => boolean;
}

type View =
  | { kind: 'loading' }
  | { kind: 'auth-required'; host: PrRef['host']; hasToken?: boolean }
  | { kind: 'hidden' }
  | { kind: 'ready'; loaded: Loaded };

// The host page must never break because of us.
function guard(fn: () => void): void {
  try {
    fn();
  } catch {}
}

export function startMount(deps: MountDeps): { stop(): void } {
  const { win, doc, getSource, cache } = deps;
  const results = new Map<string, Loaded>();
  const inflight = new Map<string, Promise<Loaded>>();
  const reportedMissing = new Set<string>();

  let current: { ref: PrRef; key: string; url: string } | null = null;
  let view: View = { kind: 'loading' };
  let widget: ReturnType<typeof createWidget> | null = null;
  let counter: Element | null = null;
  let counterText: string | null = null;
  let observer: MutationObserver | null = null;
  let frame = 0;
  let unsubscribe: (() => void) | null = null;

  function paint(): void {
    if (!widget) return;
    if (view.kind === 'ready') {
      const page = counter ? parsePageCounter(counter.textContent ?? '') : null;
      widget.setState({ kind: 'ready', breakdown: view.loaded.breakdown, page });
    } else {
      widget.setState(view);
    }
  }

  function setView(next: View): void {
    view = next;
    paint();
  }

  function place(): void {
    if (!current) return;
    const found = findAnchor(current.ref.host, doc);
    if (!found) {
      widget?.host.remove();
      if (!reportedMissing.has(current.url)) {
        reportedMissing.add(current.url);
        console.debug('diffspoiler: no anchor');
      }
      return;
    }

    const created = widget === null;
    widget ??= createWidget(doc);
    const { host } = widget;
    if (found.counter) {
      if (found.counter.nextSibling !== host) found.counter.after(host);
    } else if (host.parentNode !== found.anchor) {
      found.anchor.append(host);
    }

    const text = found.counter?.textContent ?? null;
    const counterChanged = found.counter !== counter || text !== counterText;
    counter = found.counter;
    counterText = text;
    if (created || counterChanged) paint();
  }

  // Catches a navigation the location event missed or reported before it committed.
  function locationMoved(): boolean {
    const ref = parsePrUrl(win.location.href);
    return (ref ? prKey(ref) : null) !== (current?.key ?? null);
  }

  function stop(): void {
    unsubscribe?.();
    unsubscribe = null;
    current = null;
    teardown();
  }

  const contextValid = () => deps.isContextValid?.() ?? true;

  function schedulePlace(): void {
    if (frame) return;
    frame = win.requestAnimationFrame(() => {
      frame = 0;
      if (!contextValid()) return stop();
      guard(() => (locationMoved() ? route(win.location.href) : place()));
    });
  }

  function observe(): void {
    if (observer) return;
    observer = new MutationObserver(schedulePlace);
    // The root, not the body: the host page can replace the whole body.
    observer.observe(doc.documentElement, { childList: true, subtree: true });
  }

  function teardown(): void {
    observer?.disconnect();
    observer = null;
    if (frame) win.cancelAnimationFrame(frame);
    frame = 0;
    widget?.host.remove();
    counter = null;
    counterText = null;
  }

  async function authRequiredView(ref: PrRef): Promise<View> {
    if (ref.host === 'gitlab') return { kind: 'auth-required', host: 'gitlab' };
    const hasToken = await deps.hasGitHubToken?.().catch(() => false);
    return { kind: 'auth-required', host: 'github', hasToken: hasToken ?? false };
  }

  // Never rejects: it is fired and forgotten.
  async function load(ref: PrRef, key: string): Promise<void> {
    try {
      if (!contextValid()) return stop();
      let pending = inflight.get(key);
      if (!pending) {
        pending = (async () => loadBreakdown(ref, await getSource(ref), cache))();
        inflight.set(key, pending);
      }
      let next: View;
      try {
        const loaded = await pending;
        results.set(key, loaded);
        next = { kind: 'ready', loaded };
      } catch (error) {
        next = error instanceof AuthRequiredError ? await authRequiredView(ref) : { kind: 'hidden' };
      } finally {
        inflight.delete(key);
      }
      if (current?.key === key) setView(next);
    } catch {}
  }

  function route(url: string): void {
    const ref = parsePrUrl(url);
    if (!ref) {
      current = null;
      teardown();
      return;
    }

    const key = prKey(ref);
    const samePr = current?.key === key;
    current = { ref, key, url };
    observe();
    if (!samePr) {
      const loaded = results.get(key);
      view = loaded ? { kind: 'ready', loaded } : { kind: 'loading' };
      paint();
      if (!loaded) void load(ref, key);
    }
    place();
  }

  unsubscribe = deps.onLocationChange((url) => guard(() => route(url)));
  guard(() => route(win.location.href));

  return { stop };
}
