import type { Breakdown } from '@diffspoiler/core/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { createWidget } from '../../src/lib/ui/widget';

const breakdown: Breakdown = {
  buckets: [
    { id: 'runtime', additions: 1200, deletions: 30, fileCount: 4 },
    { id: 'tests', additions: 300, deletions: 0, fileCount: 1 },
    { id: 'evals', additions: 0, deletions: 0, fileCount: 0 },
    { id: 'other', additions: 5, deletions: 5, fileCount: 2 },
  ],
  total: { additions: 1505, deletions: 35, fileCount: 7 },
  uncountedFiles: 500,
};

const zero: Breakdown = {
  buckets: (['runtime', 'tests', 'evals', 'other'] as const).map((id) => ({
    id,
    additions: 0,
    deletions: 0,
    fileCount: 0,
  })),
  total: { additions: 0, deletions: 0, fileCount: 0 },
  uncountedFiles: 0,
};

function make() {
  const w = createWidget(document);
  document.body.append(w.host);
  const root = w.host.shadowRoot!;
  return { ...w, root, text: () => root.querySelector('.pop')!.textContent ?? '' };
}

describe('widget', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    document.body.replaceChildren();
    document.body.style.backgroundColor = '';
  });

  it('is a focusable element with an open shadow root', () => {
    const { host } = make();
    expect(host.tagName.toLowerCase()).toBe('diffspoiler-badge');
    expect(host.getAttribute('tabindex')).toBe('0');
    expect(host.shadowRoot).not.toBeNull();
  });

  it('keeps the bar at a fixed 56px width in every state', () => {
    const { setState, root } = make();
    const css = root.querySelector('style')!.textContent ?? '';
    expect(/\.bar\s*\{[^}]*width:\s*56px/.test(css)).toBe(true);
    for (const s of [
      { kind: 'loading' },
      { kind: 'ready', breakdown, page: null },
      { kind: 'auth-required', host: 'github' },
    ] as const) {
      setState(s);
      expect(root.querySelector('.trigger .bar')).not.toBeNull();
    }
  });

  it('shows its own dotted-underlined +/− total when the page has no counter', () => {
    const { setState, root } = make();
    setState({ kind: 'ready', breakdown, page: null });
    expect(root.querySelector('.trigger .nums')!.textContent).toBe('+1,505 −35');
    const css = root.querySelector('style')!.textContent ?? '';
    expect(/\.nums\s*\{[^}]*underline dotted/.test(css)).toBe(true);
  });

  it('shows no numbers of its own next to a page counter, nor while loading', () => {
    const { setState, root } = make();
    setState({ kind: 'ready', breakdown, page: { additions: 1505, deletions: 35, capped: false } });
    expect(root.querySelector('.nums')!.textContent).toBe('');
    setState({ kind: 'loading' });
    expect(root.querySelector('.nums')!.textContent).toBe('');
  });

  it('opens from an attached trigger and stops after detaching', () => {
    vi.useFakeTimers();
    const { host, attachTrigger } = make();
    const counterEl = document.createElement('span');
    document.body.append(counterEl);
    const detach = attachTrigger(counterEl);
    counterEl.dispatchEvent(new MouseEvent('mouseenter'));
    expect(host.hasAttribute('open')).toBe(true);
    counterEl.dispatchEvent(new MouseEvent('mouseleave'));
    host.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(500);
    expect(host.hasAttribute('open')).toBe(true);
    host.dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(500);
    expect(host.hasAttribute('open')).toBe(false);
    detach();
    counterEl.dispatchEvent(new MouseEvent('mouseenter'));
    expect(host.hasAttribute('open')).toBe(false);
    vi.useRealTimers();
  });

  it('shows the hovered row description in the hint line', () => {
    const { setState, root } = make();
    setState({ kind: 'ready', breakdown, page: null });
    const hint = root.querySelector('.hint')!;
    const first = root.querySelector<HTMLElement>('.row[data-desc]')!;
    first.dispatchEvent(new MouseEvent('mouseenter'));
    expect(hint.textContent).toBe(first.dataset.desc);
    expect(hint.textContent).toContain('4 files.');
    first.dispatchEvent(new MouseEvent('mouseleave'));
    expect(hint.textContent).toBe('Hover a row to see what it counts.');
  });

  it('renders one segment per non-empty bucket sized by lines changed', () => {
    const { setState, root } = make();
    setState({ kind: 'ready', breakdown, page: null });
    const segs = [...root.querySelectorAll<HTMLElement>('.seg')];
    expect(segs.map((s) => s.style.flexGrow)).toEqual(['1230', '300', '10']);
  });

  it('renders no segments and no NaN when everything is zero', () => {
    const { setState, root, host } = make();
    setState({ kind: 'ready', breakdown: zero, page: null });
    expect(root.querySelectorAll('.seg')).toHaveLength(0);
    expect(root.innerHTML).not.toContain('NaN');
    expect(host.style.cssText).not.toContain('NaN');
  });

  it('lists rows in order with separators, uncounted row and total', () => {
    const { setState, text } = make();
    setState({ kind: 'ready', breakdown, page: null });
    const t = text();
    expect(t).toContain('+1,200');
    expect(t).toContain('−30');
    const order = ['Runtime', 'Tests', 'Evals', 'Other', 'not counted: 500 files', 'Total'].map((s) => t.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(t).toContain('+1,505');
  });

  it('omits the uncounted row when nothing is uncounted', () => {
    const { setState, text } = make();
    setState({ kind: 'ready', breakdown: { ...breakdown, uncountedFiles: 0 }, page: null });
    expect(text()).not.toContain('not counted');
  });

  it('shows the footnote when the page counter differs', () => {
    const { setState, text } = make();
    setState({ kind: 'ready', breakdown, page: { additions: 3000, deletions: 49876, capped: false } });
    expect(text()).toContain('The page shows +3,000 −49,876; diffspoiler counted +1,505 −35 across 7 counted files.');
  });

  it('puts the description and file count in each info title', () => {
    const { setState, root } = make();
    setState({ kind: 'ready', breakdown, page: null });
    const titles = [...root.querySelectorAll<HTMLElement>('.info')].map((i) => i.title);
    expect(titles).toHaveLength(4);
    expect(titles[1]).toBe(
      'Tests: *.spec.*, *.test.*, *.e2e-spec.*, __tests__/, test(s)/, e2e/, *_test.go, test_*.py, *_spec.rb. 1 file.',
    );
    expect(titles[0]).toMatch(/ 4 files\.$/);
  });

  it('auth-required (GitHub, no token) shows a dashed bar, the message and an options button', async () => {
    const { setState, root, text } = make();
    const spy = vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue(undefined);
    setState({ kind: 'auth-required', host: 'github' });
    expect(root.querySelector('.bar')!.classList.contains('auth')).toBe(true);
    expect(text()).toContain('Private repo: add a GitHub token in diffspoiler options.');
    root.querySelector('button')!.click();
    expect(spy).toHaveBeenCalledWith({ type: 'open-options' });
  });

  it('auth-required (GitHub, with a token) says the token cannot read the repo and offers options', () => {
    const { setState, root, text } = make();
    setState({ kind: 'auth-required', host: 'github', hasToken: true });
    expect(text()).toContain("Your GitHub token can't read this repo.");
    expect(text()).not.toContain('Private repo');
    expect(root.querySelector('button')).not.toBeNull();
  });

  it('auth-required (GitLab) suggests reloading and has no options button', () => {
    const { setState, root, text } = make();
    setState({ kind: 'auth-required', host: 'gitlab' });
    expect(root.querySelector('.bar')!.classList.contains('auth')).toBe(true);
    expect(text()).toContain("Couldn't read this merge request with your GitLab session. Try reloading the page.");
    expect(text()).not.toContain('GitHub');
    expect(root.querySelector('button')).toBeNull();
  });

  it('does not throw when sendMessage throws synchronously', () => {
    const { setState, root } = make();
    vi.spyOn(browser.runtime, 'sendMessage').mockImplementation(() => {
      throw new Error('Extension context invalidated.');
    });
    setState({ kind: 'auth-required', host: 'github' });
    expect(() => root.querySelector('button')!.click()).not.toThrow();
  });

  it('hides with display none', () => {
    const { host, setState } = make();
    setState({ kind: 'hidden' });
    expect(host.style.display).toBe('none');
    setState({ kind: 'loading' });
    expect(host.style.display).toBe('');
  });

  it('opens on mouseenter/focusin and closes shortly after mouseleave, or on focusout', () => {
    vi.useFakeTimers();
    const { host } = make();
    host.dispatchEvent(new Event('mouseenter'));
    expect(host.hasAttribute('open')).toBe(true);
    host.dispatchEvent(new Event('mouseleave'));
    expect(host.hasAttribute('open')).toBe(true);
    vi.advanceTimersByTime(200);
    expect(host.hasAttribute('open')).toBe(false);
    vi.useRealTimers();
    host.dispatchEvent(new Event('focusin'));
    expect(host.hasAttribute('open')).toBe(true);
    host.dispatchEvent(new Event('focusout'));
    expect(host.hasAttribute('open')).toBe(false);
  });

  it('picks the theme from the page background luminance', () => {
    document.body.style.backgroundColor = 'rgb(13, 17, 23)';
    const dark = make();
    expect(dark.host.getAttribute('data-theme')).toBe('dark');
    document.body.style.backgroundColor = 'rgb(255, 255, 255)';
    const light = make();
    expect(light.host.getAttribute('data-theme')).toBe('light');
  });

  it('leaves no pointer gap between the host and the popover', () => {
    const { root } = make();
    const css = root.querySelector('style')!.textContent ?? '';
    expect(css).not.toBe('');
    const pop = /\.pop\s*\{([^}]*)\}/.exec(css)![1]!;
    const bridge = /\.pop::before\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    const px = (src: string, prop: string) => Number(new RegExp(`(?:^|[\\s;])${prop}:\\s*(-?\\d+)px`).exec(src)?.[1]);
    expect(/(?:^|[\s;])top:\s*100%/.test(pop)).toBe(true);
    expect(bridge).not.toBe('');
    expect(px(bridge, 'height')).toBeGreaterThanOrEqual(px(pop, 'margin-top'));
  });

  it('keeps the popover open when focus moves inside it, closes when it leaves', () => {
    const { host, setState, root } = make();
    setState({ kind: 'auth-required', host: 'github' });
    const button = root.querySelector('button')!;
    host.dispatchEvent(new Event('focusin'));
    host.dispatchEvent(new FocusEvent('focusout', { relatedTarget: button }));
    expect(host.hasAttribute('open')).toBe(true);
    const outside = document.createElement('input');
    document.body.append(outside);
    host.dispatchEvent(new FocusEvent('focusout', { relatedTarget: outside }));
    expect(host.hasAttribute('open')).toBe(false);
  });

  it('does not surface an unhandled rejection when sendMessage fails', async () => {
    const { setState, root } = make();
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    vi.spyOn(browser.runtime, 'sendMessage').mockRejectedValue(new Error('Extension context invalidated.'));
    setState({ kind: 'auth-required', host: 'github' });
    root.querySelector('button')!.click();
    await new Promise((r) => setTimeout(r, 10));
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  describe('popover alignment', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    const setViewport = (width: number) =>
      vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(width);
    const stubHost = (host: HTMLElement, left: number) =>
      vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({
        left,
        right: left + 56,
        top: 0,
        bottom: 6,
        width: 56,
        height: 6,
        x: left,
        y: 0,
        toJSON: () => ({}),
      });
    const hover = (host: HTMLElement) => host.dispatchEvent(new MouseEvent('mouseenter'));

    it('right-aligns the popover when left-aligned would overflow the viewport', () => {
      const { host } = make();
      setViewport(1440);
      stubHost(host, 1360);
      hover(host);
      expect(host.hasAttribute('open')).toBe(true);
      expect(host.getAttribute('data-align')).toBe('end');
    });

    it('keeps the default alignment near the left edge', () => {
      const { host } = make();
      setViewport(1440);
      stubHost(host, 100);
      hover(host);
      expect(host.hasAttribute('data-align')).toBe(false);
    });

    it('measures against the viewport without the scrollbar', () => {
      const { host } = make();
      setViewport(1425);
      vi.stubGlobal('innerWidth', 1440);
      stubHost(host, 1200);
      hover(host);
      vi.unstubAllGlobals();
      expect(host.getAttribute('data-align')).toBe('end');
    });

    it('clears the alignment when reopened near the left edge', () => {
      vi.useFakeTimers();
      const { host } = make();
      setViewport(1440);
      stubHost(host, 1360);
      hover(host);
      expect(host.getAttribute('data-align')).toBe('end');
      host.dispatchEvent(new MouseEvent('mouseleave'));
      vi.advanceTimersByTime(200);
      stubHost(host, 100);
      hover(host);
      expect(host.hasAttribute('data-align')).toBe(false);
      vi.useRealTimers();
    });

    it('realigns when the content grows while the popover is open', () => {
      const { host, root, setState } = make();
      setViewport(1440);
      stubHost(host, 1150);
      const pop = root.querySelector('.pop')!;
      const width = vi.spyOn(pop, 'getBoundingClientRect');
      width.mockReturnValue({ width: 250 } as DOMRect);
      hover(host);
      expect(host.hasAttribute('data-align')).toBe(false);
      width.mockReturnValue({ width: 306 } as DOMRect);
      setState({ kind: 'ready', breakdown, page: null });
      expect(host.getAttribute('data-align')).toBe('end');
    });
  });
});
