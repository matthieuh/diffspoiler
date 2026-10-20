import { BUCKET_ORDER, BUCKETS } from '@diffspoiler/core/rules';
import type { Breakdown } from '@diffspoiler/core/types';
import { browser } from 'wxt/browser';
import { footnote, type PageCounter } from './page-counter';
import css from './widget.css?inline';

export type WidgetState =
  | { kind: 'loading' }
  | { kind: 'ready'; breakdown: Breakdown; page: PageCounter | null }
  | { kind: 'auth-required'; host: 'github' | 'gitlab'; hasToken?: boolean }
  | { kind: 'hidden' };

// Mirrors .pop min-width; fallback when the popover has no layout box (non-rendering environments).
const POPOVER_MIN_WIDTH = 250;
// Lets the pointer cross the gap between the page counter, the trigger and the popover.
const CLOSE_DELAY_MS = 120;
const DEFAULT_HINT = 'Hover a row to see what it counts.';

const fmt = (n: number): string => n.toLocaleString('en-US');

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function isDark(doc: Document): boolean {
  const view = doc.defaultView;
  if (!view) return false;
  for (const node of [doc.body, doc.documentElement]) {
    if (!node) continue;
    const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/.exec(view.getComputedStyle(node).backgroundColor);
    if (!m || (m[4] !== undefined && Number(m[4]) === 0)) continue;
    const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5;
  }
  return false;
}

function statRow(doc: Document, className: string, label: HTMLElement | string, add: number, del: number): HTMLElement {
  const row = el(doc, 'div', `row ${className}`);
  const lbl = el(doc, 'span', 'lbl');
  if (typeof label === 'string') lbl.textContent = label;
  else lbl.append(label);
  row.append(lbl, el(doc, 'span', 'add', `+${fmt(add)}`), el(doc, 'span', 'del', `−${fmt(del)}`));
  return row;
}

function renderReady(doc: Document, bar: HTMLElement, pop: HTMLElement, breakdown: Breakdown, page: PageCounter | null) {
  const hint = el(doc, 'div', 'hint', DEFAULT_HINT);
  for (const id of BUCKET_ORDER) {
    const s = breakdown.buckets.find((x) => x.id === id);
    if (!s) continue;
    const lines = s.additions + s.deletions;
    if (lines > 0) {
      const seg = el(doc, 'div', 'seg');
      seg.style.flexGrow = String(lines);
      seg.style.background = BUCKETS[id].color;
      bar.append(seg);
    }
    const meta = BUCKETS[id];
    const label = el(doc, 'span');
    const sw = el(doc, 'span', 'sw');
    sw.style.background = meta.color;
    sw.style.display = 'inline-block';
    sw.style.marginRight = '8px';
    const info = el(doc, 'span', 'info', 'ⓘ');
    info.title = `${meta.description} ${s.fileCount} ${s.fileCount === 1 ? 'file' : 'files'}.`;
    label.append(sw, meta.label, info);
    const row = statRow(doc, '', label, s.additions, s.deletions);
    row.dataset.desc = info.title;
    row.addEventListener('mouseenter', () => {
      hint.textContent = info.title;
    });
    row.addEventListener('mouseleave', () => {
      hint.textContent = DEFAULT_HINT;
    });
    pop.append(row);
  }
  pop.append(el(doc, 'div', 'sep'));
  if (breakdown.uncountedFiles > 0) {
    const n = breakdown.uncountedFiles;
    pop.append(el(doc, 'div', 'row muted', `not counted: ${fmt(n)} ${n === 1 ? 'file' : 'files'}`));
  }
  pop.append(statRow(doc, 'total', 'Total', breakdown.total.additions, breakdown.total.deletions));
  const note = footnote(breakdown, page);
  if (note) pop.append(el(doc, 'div', 'note', note));
  pop.append(hint);
}

function renderNumbers(doc: Document, nums: HTMLElement, breakdown: Breakdown): void {
  nums.append(
    el(doc, 'span', 'add', `+${fmt(breakdown.total.additions)}`),
    ' ',
    el(doc, 'span', 'del', `−${fmt(breakdown.total.deletions)}`),
  );
}

export interface Widget {
  host: HTMLElement;
  setState(s: WidgetState): void;
  /** Makes another element (the page's own +/− counter) open the popover on hover; returns a detach function. */
  attachTrigger(target: Element): () => void;
}

export function createWidget(doc: Document): Widget {
  const host = doc.createElement('diffspoiler-badge');
  host.tabIndex = 0;
  const root = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = css;
  const trigger = el(doc, 'span', 'trigger');
  const nums = el(doc, 'span', 'nums');
  const bar = el(doc, 'div', 'bar');
  trigger.append(nums, bar);
  const pop = el(doc, 'div', 'pop');
  root.append(style, trigger, pop);

  // Measured while open (a display:none popover has no width); clientWidth excludes the scrollbar.
  const align = () => {
    host.removeAttribute('data-align');
    const popWidth = pop.getBoundingClientRect().width || POPOVER_MIN_WIDTH;
    const viewportWidth = doc.documentElement.clientWidth || Infinity;
    if (host.getBoundingClientRect().left + popWidth > viewportWidth) host.setAttribute('data-align', 'end');
  };
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  const cancelClose = () => {
    clearTimeout(closeTimer);
    closeTimer = undefined;
  };
  const open = () => {
    cancelClose();
    if (host.hasAttribute('open')) return;
    host.setAttribute('open', '');
    align();
  };
  const close = () => {
    cancelClose();
    host.removeAttribute('open');
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer = setTimeout(close, CLOSE_DELAY_MS);
  };
  host.addEventListener('mouseenter', open);
  host.addEventListener('focusin', open);
  host.addEventListener('mouseleave', scheduleClose);
  host.addEventListener('focusout', (e) => {
    const next = e.relatedTarget;
    if (next instanceof Node && (next === host || host.contains(next) || root.contains(next))) return;
    close();
  });

  function attachTrigger(target: Element): () => void {
    target.addEventListener('mouseenter', open);
    target.addEventListener('mouseleave', scheduleClose);
    return () => {
      target.removeEventListener('mouseenter', open);
      target.removeEventListener('mouseleave', scheduleClose);
    };
  }

  function setState(s: WidgetState): void {
    bar.replaceChildren();
    pop.replaceChildren();
    nums.replaceChildren();
    bar.className = 'bar';
    host.style.display = s.kind === 'hidden' ? 'none' : '';
    host.setAttribute('data-theme', isDark(doc) ? 'dark' : 'light');
    if (s.kind === 'loading') {
      bar.classList.add('loading');
      pop.append(el(doc, 'div', 'muted', 'Counting changed lines…'));
    } else if (s.kind === 'auth-required') {
      bar.classList.add('auth');
      if (s.host === 'gitlab') {
        pop.append(
          el(doc, 'div', '', "Couldn't read this merge request with your GitLab session. Try reloading the page."),
        );
      } else {
        const message = s.hasToken
          ? "Your GitHub token can't read this repo."
          : 'Private repo: add a GitHub token in diffspoiler options.';
        pop.append(el(doc, 'div', '', message));
        const btn = el(doc, 'button', '', 'Open options');
        btn.type = 'button';
        btn.addEventListener('click', () => {
          try {
            browser.runtime.sendMessage({ type: 'open-options' }).catch(() => {});
          } catch {
            // The extension was reloaded under this page; there is nothing left to message.
          }
        });
        pop.append(btn);
      }
    } else if (s.kind === 'ready') {
      renderReady(doc, bar, pop, s.breakdown, s.page);
      // Where the page shows its own +/− counter, that counter is the trigger; elsewhere we show ours.
      if (!s.page) renderNumbers(doc, nums, s.breakdown);
    }
    if (host.hasAttribute('open')) align();
  }

  setState({ kind: 'loading' });
  return { host, setState, attachTrigger };
}
