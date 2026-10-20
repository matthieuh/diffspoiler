import { parsePageCounter } from './page-counter';

// Selectors come from the fixtures in test/fixtures (public pages, captured 2026-10-20).
// GitHub (React header): meta line = PageHeader.Description; counter = the "+N -N" box holding the
//   diffstat squares (data-testid), two levels above them. Legacy header (logged-out Files tab): .gh-header-meta + #diffstat.
// GitLab: meta line = .detail-page-description ("X requested to merge…"); the only +/− counter is
//   .diff-stats on the Changes tab, whose pane stays in the DOM (hidden) on the other tabs.

type Host = 'github' | 'gitlab';

interface CounterCandidate {
  selector: string;
  /** How many parents to climb from the match to reach the element holding the "+N −N" text. */
  up?: number;
}

const ANCHORS: Record<Host, string[]> = {
  github: ['[data-component="PageHeader"] [data-component="PageHeader.Description"]', '#partial-discussion-header .gh-header-meta'],
  gitlab: ['.merge-request-details .detail-page-description', '.detail-page-header'],
};

const COUNTERS: Record<Host, CounterCandidate[]> = {
  github: [{ selector: '[data-component="PH_Navigation"] [data-testid$=" diffstat"]', up: 2 }, { selector: '#diffstat' }],
  gitlab: [{ selector: '.diff-stats' }],
};

// checkVisibility is missing outside real browsers; treat everything as rendered there.
const rendered = (el: Element): boolean => typeof el.checkVisibility !== 'function' || el.checkVisibility();

// Guards against markup drift (e.g. a climb landing on the wrong level): only a real "+N −N" text counts.
function showsCounts(el: Element): boolean {
  const page = parsePageCounter(el.textContent ?? '');
  return page.additions !== null || page.capped;
}

function climb(el: Element, levels: number): Element | null {
  let node: Element | null = el;
  for (let i = 0; i < levels && node; i++) node = node.parentElement;
  return node;
}

export function findAnchor(host: Host, doc: Document): { anchor: Element; counter: Element | null } | null {
  const anchor = ANCHORS[host].map((s) => doc.querySelector(s)).find((el) => el !== null && rendered(el));
  if (!anchor) return null;

  let counter: Element | null = null;
  for (const { selector, up = 0 } of COUNTERS[host]) {
    const match = doc.querySelector(selector);
    const el = match && climb(match, up);
    if (el && rendered(el) && showsCounts(el)) {
      counter = el;
      break;
    }
  }
  return { anchor, counter };
}
