import { BUCKET_ORDER, BUCKETS } from '@diffspoiler/core/rules';
import type { Breakdown } from '@diffspoiler/core/types';
import { browser } from 'wxt/browser';
import { footnote, type PageCounter } from './page-counter';
import css from './widget.css?inline';

export type WidgetState =
  | { kind: 'loading' }
  | { kind: 'ready'; breakdown: Breakdown; page: PageCounter | null }
  | { kind: 'auth-required' }
  | { kind: 'hidden' };

// Mirrors .pop min-width; fallback when the popover has no layout box (non-rendering environments).
const POPOVER_MIN_WIDTH = 250;

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
    pop.append(statRow(doc, '', label, s.additions, s.deletions));
  }
  pop.append(el(doc, 'div', 'sep'));
  if (breakdown.uncountedFiles > 0) {
    const n = breakdown.uncountedFiles;
    pop.append(el(doc, 'div', 'row muted', `not counted: ${fmt(n)} ${n === 1 ? 'file' : 'files'}`));
  }
  pop.append(statRow(doc, 'total', 'Total', breakdown.total.additions, breakdown.total.deletions));
  const note = footnote(breakdown, page);
  if (note) pop.append(el(doc, 'div', 'note', note));
}

export function createWidget(doc: Document): { host: HTMLElement; setState(s: WidgetState): void } {
  const host = doc.createElement('diffspoiler-badge');
  host.tabIndex = 0;
  host.style.width = '56px';
  const root = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = css;
  const bar = el(doc, 'div', 'bar');
  const pop = el(doc, 'div', 'pop');
  root.append(style, bar, pop);

  const open = () => {
    host.setAttribute('open', '');
    // Measured after opening: a display:none popover has no width.
    host.removeAttribute('data-align');
    const popWidth = pop.getBoundingClientRect().width || POPOVER_MIN_WIDTH;
    const overflows = host.getBoundingClientRect().left + popWidth > (doc.defaultView?.innerWidth ?? Infinity);
    if (overflows) host.setAttribute('data-align', 'end');
  };
  const close = () => host.removeAttribute('open');
  host.addEventListener('mouseenter', open);
  host.addEventListener('focusin', open);
  host.addEventListener('mouseleave', close);
  host.addEventListener('focusout', (e) => {
    const next = e.relatedTarget;
    if (next instanceof Node && (next === host || host.contains(next) || root.contains(next))) return;
    close();
  });

  function setState(s: WidgetState): void {
    bar.replaceChildren();
    pop.replaceChildren();
    bar.className = 'bar';
    host.style.display = s.kind === 'hidden' ? 'none' : '';
    host.setAttribute('data-theme', isDark(doc) ? 'dark' : 'light');
    if (s.kind === 'loading') {
      bar.classList.add('loading');
      pop.append(el(doc, 'div', 'muted', 'Counting changed lines…'));
    } else if (s.kind === 'auth-required') {
      bar.classList.add('auth');
      pop.append(el(doc, 'div', '', 'Private repo: add a GitHub token in diffspoiler options.'));
      const btn = el(doc, 'button', '', 'Open options');
      btn.type = 'button';
      btn.addEventListener('click', () => {
        browser.runtime.sendMessage({ type: 'open-options' }).catch(() => {});
      });
      pop.append(btn);
    } else if (s.kind === 'ready') {
      renderReady(doc, bar, pop, s.breakdown, s.page);
    }
  }

  setState({ kind: 'loading' });
  return { host, setState };
}
